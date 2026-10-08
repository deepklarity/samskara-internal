import {
  copyFile,
  mkdtemp as defaultMkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import {
  type AiReviewPayload,
  type AiReviewPayloadV2,
  buildReviewPrompt,
  buildReviewPromptV2,
  buildSessionExport,
  captureGitCodeState,
  fingerprintOf,
  type GroundingProblem,
  type LearningCategory,
  type NormalizedMessage,
  parseReviewXml,
  parseReviewXmlV2,
  reviewContractMd,
  reviewContractMdV2,
  reviewXmlTemplate,
  reviewXmlTemplateV2,
  sessionIndexFrom,
  toolFailuresOf,
  validateGrounding,
  validateGroundingV2,
} from "@samskara/core"
import type pino from "pino"
import type { Db } from "../../db/client.js"
import type { Env } from "../../lib/env.js"
import {
  getLatestEndCodeState,
  getStartCodeState,
  saveReviewCodeState,
} from "../../repositories/code-states.repo.js"
import { canWrite } from "../../repositories/projects.repo.js"
import * as reviewsRepo from "../../repositories/reviews.repo.js"
import { getDetail } from "../../repositories/sessions.repo.js"
import { capAgentLog } from "./agentlog.js"
import { validateCodeGroundingV2 } from "./code-grounding.js"
import { getReviewEvidence, type ReviewEvidenceManifest, stageReviewEvidence } from "./evidence.js"
import type { HarnessRunner } from "./runner.js"
import { transcriptFromClaudeConfigDir, transcriptFromOpencodeDataDir } from "./transcript.js"

/** Per-run reviewer choice: absent fields fall back to the env-driven defaults. */
export type AiReviewOptions = {
  readonly analyzer?: "ai-v1" | "ai-v2"
  readonly harness?: "opencode" | "claude"
  readonly model?: string
}

export type AiReviewDeps = {
  readonly db: Db
  readonly runner: HarnessRunner
  readonly env: Env
  readonly log: pino.Logger
  readonly now?: () => Date
  readonly mkdtemp?: typeof defaultMkdtemp
  /**
   * Optional hook the registry installs so the CLI's progress line can name the latest
   * pipeline phase. The pipeline still logs every milestone with `elapsedMs` — this is the
   * second consumer, the one a watching human sees without tailing the server log.
   */
  readonly onMilestone?: (name: string) => void
}

/** Every way an AI review run can refuse to persist, named for the API surface above it. */
export type AiReviewErrorCode =
  | "sessionNotFound"
  | "notEditable"
  | "harnessFailed"
  | "deliverableMissing"
  | "unparseable"
  | "invalidSchema"
  | "ungrounded"

export type AiReviewResult =
  | {
      readonly kind: "ok"
      readonly reviewId: string
      readonly payload: AiReviewPayload | AiReviewPayloadV2
    }
  | { readonly kind: "error"; readonly code: AiReviewErrorCode; readonly detail?: unknown }

export type AiReviewRun = typeof runAiReview

/** Stdout excerpt length carried on an `unparseable` result — enough to debug, not to leak. */
const STDOUT_EXCERPT_CHARS = 400

/** A review root anywhere in stdout — the legacy v1 delivery this pipeline still accepts. */
const STDOUT_REVIEW_RE = /<review(?=[\s/>])/

/**
 * One AI review, end to end: gate on visibility + edit rights, export the session into a
 * throwaway workspace, stage the pre-written review.xml template, run the harness, read the
 * filled-in file back (falling back to the legacy fenced-stdout delivery), then parse →
 * ground-check before anything persists. LLM output is untrusted at every step; numbers and
 * durations are computed here from the export and the session row, never taken from the
 * model's claims.
 *
 * Re-analysis is allowed and supersedes: the (sessionId, "ai-v1") row is upserted, so the
 * newest run's verdict is the verdict, exactly like the static analyzer's replace semantics.
 */
export const runAiReview = async (
  deps: AiReviewDeps,
  userId: string,
  sessionId: string,
  options: AiReviewOptions = {},
): Promise<AiReviewResult> => {
  const { db, runner, env, log } = deps
  const analyzer = options.analyzer ?? "ai-v1"
  const harness = options.harness ?? env.aiReviewHarness
  const model = options.model ?? env.aiReviewModel
  const mkdtemp = deps.mkdtemp ?? defaultMkdtemp
  const now = deps.now ?? (() => new Date())
  if (analyzer === "ai-v2" && harness !== "opencode") {
    return {
      kind: "error",
      code: "harnessFailed",
      detail: { message: "ai-v2 read-only code evidence requires the MSB Opencode runner" },
    }
  }
  // The milestone ledger: every phase boundary is logged with elapsedMs for the server-log
  // watcher, pushed to this tracker for the persisted run record, and forwarded to the
  // registry's hook for the CLI's progress line.
  const milestones: Array<{ name: string; at: string; elapsedMs: number }> = []
  const milestone = (name: string, extra: Record<string, unknown> = {}): void => {
    const at = now()
    milestones.push({ name, at: at.toISOString(), elapsedMs: at.getTime() - startedAt.getTime() })
    deps.onMilestone?.(name)
    log.info(
      { sessionId, milestone: name, elapsedMs: at.getTime() - startedAt.getTime(), ...extra },
      "ai review milestone",
    )
  }

  const detail = await getDetail(db, userId, sessionId)
  if (detail === null) return { kind: "error", code: "sessionNotFound" }

  // Starting a review writes learnings, so it is editor-gated — reading the session is not
  // enough (a viewer can read reviews but cannot create them).
  const editable = await canWrite(db, userId, detail.session.projectId)
  if (!editable) return { kind: "error", code: "notEditable" }

  const startedAt = now()
  // The stored rows carry content/details jsonb exactly as captured, so the projection
  // treats them as NormalizedMessage — the same cast services/review.ts makes.
  const messages = detail.messages as unknown as ReadonlyArray<NormalizedMessage>
  // The reviewer agent never sees the real sessionId: it is the one key an agent could use
  // to find this session in its own database and cite foreign message ids — the exact
  // failure this alias prevents. Persistence below uses the real id; the workspace does not.
  const REVIEW_SESSION_ALIAS = "session-under-review"
  const sessionExport = buildSessionExport({
    sessionId: REVIEW_SESSION_ALIAS,
    title: detail.session.title ?? detail.session.id,
    source: detail.session.source,
    ...(detail.session.startedAt === null ? {} : { startedAt: detail.session.startedAt }),
    // sessions have no true endedAt column; lastActiveAt is the honest approximation.
    endedAt: detail.session.lastActiveAt,
    messages,
  })

  let workspaceDir: string | undefined
  let codeDir: string | undefined
  let evidenceManifest: ReviewEvidenceManifest | undefined
  try {
    // os.tmpdir workspace, never the repo. The pipeline writes the export, the review.xml
    // template, and stages auth.json into xdg-data/opencode/ — both runners read the same
    // workspace, the soft runner (XDG redirect inside the same process) and the hard runner
    // (msb microVM with the workspace bind-mounted at /work) find everything at the same
    // path either way.
    workspaceDir = await mkdtemp(join(tmpdir(), "samskara-ai-review-"))
    milestone("workspace_ready")
    if (analyzer === "ai-v2") {
      // Keep historical bytes outside /work: MSB mounts this second directory at /code:ro.
      // The writable workspace still holds reviewer auth, harness state, and review.xml.
      codeDir = await mkdtemp(join(tmpdir(), "samskara-ai-code-"))
      const evidence = await getReviewEvidence(db, userId, sessionId)
      if (evidence === null) return { kind: "error", code: "sessionNotFound" }
      const startState = await getStartCodeState(db, sessionId)
      const capturedEnd = await getLatestEndCodeState(db, sessionId, startedAt.toISOString())
      const latestSessionMessageMs = messages.reduce(
        (latest, message) =>
          Math.max(latest, message.timestamp ? Date.parse(message.timestamp) : 0),
        0,
      )
      // A resumed session may have messages after an earlier SessionEnd. In that case the
      // earlier capture cannot represent its latest state, so use this review's watermark.
      const endState =
        capturedEnd && Date.parse(capturedEnd.completedAt) >= latestSessionMessageMs
          ? capturedEnd
          : null
      let reviewState = null
      if (evidence.origin.cwd) {
        try {
          reviewState = await captureGitCodeState(evidence.origin.cwd, "review", sessionId)
          await saveReviewCodeState(db, reviewState)
        } catch (error) {
          log.warn(
            { sessionId, error: error instanceof Error ? error.message : String(error) },
            "review-time code state unavailable",
          )
        }
      }
      // The reviewer sees the same alias in every staged source. Revealing the real id in
      // the manifest would undo session.json's foreign-session lookup protection.
      const staged = await stageReviewEvidence(
        { ...evidence, sessionId: REVIEW_SESSION_ALIAS, startState, endState, reviewState },
        codeDir,
      )
      codeDir = staged.codeDir
      evidenceManifest = staged.manifest
      // OpenCode treats /code as outside its /work project. Its headless permission
      // request is auto-rejected, so approve guest tool calls without prompting.
      // MSB's /code:ro mount still enforces immutable evidence bytes.
      await writeFile(
        join(workspaceDir, "opencode.json"),
        `${JSON.stringify(
          {
            $schema: "https://opencode.ai/config.json",
            permission: "allow",
          },
          null,
          2,
        )}\n`,
      )
      milestone("code_staged", {
        files: evidenceManifest.tree.files.length,
        artifacts: evidenceManifest.artifacts.length,
        commits: evidenceManifest.commits.length,
        available: evidenceManifest.tree.available,
      })
    }
    await writeFile(
      join(workspaceDir, "session.json"),
      `${JSON.stringify(sessionExport, null, 2)}\n`,
    )
    milestone("export_written")
    // The deliverable is a FILE: the pipeline pre-writes the template (core's
    // reviewXmlTemplate, the exact skeleton the contract describes) beside the export, and the
    // agent fills it in incrementally rather than emitting one giant reply.
    const templateXml = analyzer === "ai-v2" ? reviewXmlTemplateV2() : reviewXmlTemplate()
    await writeFile(join(workspaceDir, "review.xml"), templateXml)
    milestone("template_staged")
    // The contract lives in the workspace, not the prompt: the agent re-reads any rule on
    // demand instead of spending starting context on the whole spec.
    await writeFile(
      join(workspaceDir, "CONTRACT.md"),
      analyzer === "ai-v2" ? reviewContractMdV2() : reviewContractMd(),
    )
    milestone("contract_staged")
    // Best-effort auth staging, one shape per harness: if the host has no credentials yet
    // (first run), the model call fails downstream — same failure either way, the surface
    // just changes. Both runners read the same workspace, so a single copy there covers the
    // soft runner (env redirect inside the same process) and the msb runner (workspace
    // bind-mounted at /work).
    if (harness === "opencode") {
      // The xdg-data/opencode/ dir has to exist before copyFile; without it the call rejects
      // and the `.catch` swallows the error and opencode runs without auth and hangs.
      const authTargetDir = join(workspaceDir, "xdg-data", "opencode")
      await mkdir(authTargetDir, { recursive: true })
      await copyFile(
        join(homedir(), ".local", "share", "opencode", "auth.json"),
        join(authTargetDir, "auth.json"),
      ).catch(() => undefined)
    } else {
      // Claude Code reads credentials from CLAUDE_CONFIG_DIR, which the runner points at
      // claude-config/ inside the workspace. Same best-effort contract: missing credentials
      // surface as the harness's own auth failure, never a pipeline crash.
      const claudeConfigDir = join(workspaceDir, "claude-config")
      await mkdir(claudeConfigDir, { recursive: true })
      await copyFile(
        join(homedir(), ".claude", ".credentials.json"),
        join(claudeConfigDir, ".credentials.json"),
      ).catch(() => undefined)
    }
    milestone("auth_staged")

    const promptOptions = {
      sessionMeta: {
        sessionId: REVIEW_SESSION_ALIAS,
        title: sessionExport.meta.title,
        source: sessionExport.meta.source,
        ...(sessionExport.meta.startedAt === undefined
          ? {}
          : { startedAt: sessionExport.meta.startedAt }),
        ...(sessionExport.meta.endedAt === undefined
          ? {}
          : { endedAt: sessionExport.meta.endedAt }),
      },
    }
    const prompt =
      analyzer === "ai-v2" ? buildReviewPromptV2(promptOptions) : buildReviewPrompt(promptOptions)

    milestone("harness_spawning")
    let stdout: string
    let firstByteMs: number | null = null
    let runnerAgentLog: string | undefined
    let harnessExitWarning: string | undefined
    try {
      const run = await runner.run({
        prompt,
        workspaceDir,
        harness,
        model,
        ...(codeDir === undefined ? {} : { codeDir }),
      })
      stdout = run.stdout
      firstByteMs = run.firstByteMs
      runnerAgentLog = run.agentLog
      if (run.logPath !== undefined) {
        log.info({ sessionId, logPath: run.logPath }, "ai review agent log captured from sandbox")
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const stderr = (error as { stderr?: string }).stderr
      const agentLog = (error as { agentLog?: string }).agentLog
      const logPath = (error as { logPath?: string }).logPath
      // MSB can return a nonzero status during guest shutdown after the reviewer has
      // finished writing its file. Accept that file only when the XML is complete, counts
      // are present, and the full schema parses without recovery. An interrupted draft
      // still reports the original harness failure.
      const candidate = await readFile(join(workspaceDir, "review.xml"), "utf8").catch(() => "")
      const completed =
        candidate !== templateXml && candidate.trimEnd().endsWith("</review>")
          ? analyzer === "ai-v2"
            ? parseReviewXmlV2(candidate)
            : parseReviewXml(candidate)
          : null
      if (
        completed?.ok === true &&
        completed.recovered.length === 0 &&
        completed.selfCounts !== undefined
      ) {
        stdout = ""
        runnerAgentLog = agentLog
        harnessExitWarning = message
        log.warn(
          { sessionId, message, stderr, logPath, workspaceDir },
          "ai review harness exited after a complete deliverable; continuing validation",
        )
        milestone("harness_exit_recovered")
      } else {
        log.warn(
          { sessionId, message, stderr, agentLog, logPath, workspaceDir },
          "ai review harness run failed",
        )
        milestone("harness_failed")
        return {
          kind: "error",
          code: "harnessFailed",
          detail: { message, stderr, agentLog, logPath, workspaceDir },
        }
      }
    }
    if (firstByteMs !== null) {
      log.info(
        { sessionId, firstByteMs, workspaceDir },
        "ai review harness produced first stdout byte",
      )
      milestone("harness_first_byte")
    }
    milestone("harness_complete")

    // The reviewer's own session, lifted out of the workspace before cleanup: claude writes
    // a full transcript under its redirected config dir, opencode keeps one in its sqlite
    // database under the redirected XDG dir (the msb guest's XDG lands in the same mounted
    // workspace). It becomes evidence beside the review. A missing transcript degrades to
    // nothing — never a failed review.
    const reviewerTranscript =
      harness === "claude"
        ? await transcriptFromClaudeConfigDir(join(workspaceDir, "claude-config"))
        : await transcriptFromOpencodeDataDir(join(workspaceDir, "xdg-data"))

    // The deliverable is the file the agent filled in. The workspace is a local dir that
    // survives until cleanup, so it is read back directly; byte count is logged on the
    // milestone. A missing or emptied file falls back to the legacy v1 contract (the fenced
    // XML block in stdout, still supported by the parser); neither source holding a review
    // root at all is `deliverableMissing`, named with the last milestone so the next person
    // knows where the run got stuck.
    const deliverablePath = join(workspaceDir, "review.xml")
    const file = await readFile(deliverablePath).catch(() => null)
    let source: string
    let xmlBytes: number
    if (file !== null && file.toString("utf8") === templateXml && !STDOUT_REVIEW_RE.test(stdout)) {
      const deniedCodeRead =
        runnerAgentLog?.includes("permission requested: external_directory") &&
        runnerAgentLog.includes("auto-rejecting")
      const message = deniedCodeRead
        ? "Reviewer could not read /code because OpenCode rejected permission."
        : "Reviewer left the review.xml template unchanged."
      const lastMilestone = milestones.at(-1)?.name ?? null
      milestone("deliverable_missing")
      return {
        kind: "error",
        code: "deliverableMissing",
        detail: { message, lastMilestone },
      }
    }
    if (file !== null && file.byteLength > 0 && file.toString("utf8") !== templateXml) {
      source = file.toString("utf8")
      xmlBytes = file.byteLength
      milestone("deliverable_read", { bytes: xmlBytes })
    } else if (STDOUT_REVIEW_RE.test(stdout)) {
      source = stdout
      xmlBytes = Buffer.byteLength(stdout)
      log.info({ sessionId }, "ai review deliverable fell back to legacy stdout XML")
    } else {
      const lastMilestone = milestones.at(-1)?.name ?? null
      log.warn(
        { sessionId, lastMilestone, workspaceDir },
        "ai review deliverable missing: no review.xml and no XML in stdout",
      )
      return {
        kind: "error",
        code: "deliverableMissing",
        detail: { lastMilestone, stdoutStart: stdout.slice(0, STDOUT_EXCERPT_CHARS) },
      }
    }

    // The model-facing contract is XML: locally repairable, salvageable per entry. The
    // parser heals (balancing, escaping, truncation, dropping malformed entries), runs the
    // zod contract, and reports every repair it made in `recovered`.
    const parsed = analyzer === "ai-v2" ? parseReviewXmlV2(source) : parseReviewXml(source)
    if (!parsed.ok) {
      log.warn(
        {
          sessionId,
          error: parsed.error,
          recovered: parsed.recovered,
          stdoutStart: source.slice(0, 200),
        },
        "ai review unparseable: harness XML could not be recovered",
      )
      milestone("xml_unparseable")
      return {
        kind: "error",
        code: "unparseable",
        detail: {
          error: parsed.error,
          recovered: parsed.recovered,
          stdoutStart: source.slice(0, STDOUT_EXCERPT_CHARS),
        },
      }
    }
    if (parsed.recovered.length > 0) {
      log.info({ sessionId, recovered: parsed.recovered }, "ai review XML healed")
    }
    milestone("xml_parsed")
    // The model cannot know these reliably; the runner is the authority. The cast is safe:
    // parseReviewXml already ran the full zod contract on this exact object.
    const payload = {
      ...parsed.value,
      model,
      harness,
    } as AiReviewPayload | AiReviewPayloadV2

    const grounding =
      analyzer === "ai-v2"
        ? validateGroundingV2(payload as AiReviewPayloadV2, sessionIndexFrom(sessionExport.index))
        : validateGrounding(payload as AiReviewPayload, sessionIndexFrom(sessionExport.index))
    if (!grounding.ok) {
      log.warn(
        { sessionId, problems: grounding.problems.slice(0, 10) },
        "ai review ungrounded: claims reference records the session does not have",
      )
      milestone("ungrounded")
      return {
        kind: "error",
        code: "ungrounded",
        detail: { problems: grounding.problems.slice(0, 10) as GroundingProblem[] },
      }
    }
    if (analyzer === "ai-v2" && evidenceManifest !== undefined) {
      const codeGrounding = validateCodeGroundingV2(payload as AiReviewPayloadV2, evidenceManifest)
      if (!codeGrounding.ok) {
        milestone("ungrounded")
        return {
          kind: "error",
          code: "ungrounded",
          detail: { problems: codeGrounding.problems.slice(0, 10) },
        }
      }
    }
    milestone("grounded")

    // Numbers the model never gets to claim: session span and token totals from the detail
    // row, record/tool-call counts from the export the reviewer actually saw. The span SQL
    // yields ::bigint, which the driver hands back as a string — coerce, like the repo's
    // `countedTokens` does for token sums.
    const numbers = {
      durationMs: detail.session.durationMs === null ? null : Number(detail.session.durationMs),
      recordCount: sessionExport.records.length,
      toolCallCount: sessionExport.records.filter((record) => record.msgType === "toolCall").length,
      // Deterministic failure census from the same export: per-tool failure counts the
      // reviewer cites instead of recounting (real sessions fail Bash ~5% of calls and
      // almost nothing else — mined from 188 transcripts, 8511 calls, 2026-10-08).
      toolFailures: toolFailuresOf(sessionExport.records),
      inputTokens: detail.tokenUsage.inputTokens,
      outputTokens: detail.tokenUsage.outputTokens,
      cachedTokens: detail.tokenUsage.cachedTokens,
      thinkingTokens: detail.tokenUsage.thinkingTokens,
    }
    // Timeline durations derive from export record ts (epoch ms) at each entry's from/to
    // seq — attached server-side to the persisted copy only; the parsed payload stays
    // contract-pure.
    const tsAt = (seq: number): number | undefined => sessionExport.records[seq]?.ts
    const tsRecords = sessionExport.records.filter((record) => record.ts !== undefined)
    const firstTs = tsRecords[0]?.ts
    const lastTs = tsRecords.at(-1)?.ts
    const totalDurationMs =
      firstTs !== undefined && lastTs !== undefined && lastTs >= firstTs
        ? lastTs - firstTs
        : undefined
    const persistedLenses = payload.lenses.map((lens) =>
      lens.lens === "timeline"
        ? {
            ...lens,
            entries: lens.entries.map((entry) => {
              const startMs = tsAt(entry.fromSeq)
              const endMs = tsAt(entry.toSeq)
              return {
                ...entry,
                ...(startMs === undefined ? {} : { startMs }),
                ...(startMs !== undefined && endMs !== undefined
                  ? { durationMs: endMs - startMs }
                  : {}),
              }
            }),
          }
        : lens,
    )

    // The run record: how the review came to be, for later inspection. The milestone ledger
    // ends at `grounded` — everything after this line is the persistence itself.
    const finishedAt = now()
    const run = {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      milestones: [...milestones],
      recovered: [...parsed.recovered],
      ...(parsed.selfCounts === undefined ? {} : { selfCounts: parsed.selfCounts }),
      xmlBytes,
      agentLog: capAgentLog(runnerAgentLog ?? stdout),
      ...(harnessExitWarning === undefined ? {} : { harnessExitWarning }),
      ...(reviewerTranscript === null ? {} : { transcript: reviewerTranscript }),
      // seq → the captured message's real id. Evidence citations use export aliases (msg-N);
      // the conversation tab resolves real ids, so the web needs this bridge to build links
      // that actually scroll.
      recordIds: sessionExport.records.map((record) => record.sourceId ?? null),
    }

    // Persist: review first (its id keys the learnings), then every human/agent learning as
    // a candidate — human-check-only curation, same rule as the static path. Harness
    // learnings stay in signals for display: they name what the tooling broke, not advice
    // to re-attribute to a person or the agent.
    const reviewRow = await reviewsRepo.upsertReview(db, {
      sessionId,
      projectId: detail.session.projectId,
      analyzer,
      outcome: payload.outcome,
      friction: payload.friction,
      summary: payload.summary,
      signals: {
        model: payload.model,
        harness: payload.harness,
        lenses: persistedLenses,
        ...(analyzer === "ai-v2"
          ? {
              improvements: (payload as AiReviewPayloadV2).improvements,
              evidence: evidenceManifest,
            }
          : {}),
        ...(payload.partial === undefined ? {} : { partial: payload.partial }),
        numbers,
        ...(totalDurationMs === undefined ? {} : { totalDurationMs }),
        run,
      } as unknown as object,
    })
    await persistLearnings(db, detail.session.projectId, reviewRow.id, payload)

    log.info(
      { sessionId, reviewId: reviewRow.id, elapsedMs: now().getTime() - startedAt.getTime() },
      "ai review persisted",
    )
    milestone("persisted")
    return { kind: "ok", reviewId: reviewRow.id, payload }
  } finally {
    if (workspaceDir !== undefined) {
      await rm(workspaceDir, { recursive: true, force: true })
    }
    if (codeDir !== undefined) {
      await rm(codeDir, { recursive: true, force: true })
    }
  }
}

const persistLearnings = async (
  db: Db,
  projectId: string,
  reviewId: string,
  payload: Pick<AiReviewPayload, "lenses">,
): Promise<void> => {
  for (const lens of payload.lenses) {
    if (lens.lens !== "humanLearnings" && lens.lens !== "agentLearnings") continue
    const audience = lens.lens === "humanLearnings" ? "human" : "agent"
    for (const learning of lens.learnings) {
      await reviewsRepo.upsertLearning(db, {
        projectId,
        audience,
        category: learning.category,
        title: learning.title,
        detail: learning.detail,
        evidence: learning.evidence as unknown as object,
        // Same hash core's extractor fingerprints with (audience:category:subject); the AI
        // lens categories are wider than the extractor's closed enum, but the hash only
        // concatenates strings, so the cast narrows a type, not a behavior.
        fingerprint: fingerprintOf(audience, learning.category as LearningCategory, learning.title),
        status: "candidate",
        occurrenceCount: 1,
        sourceReviewId: reviewId,
      })
    }
  }
}
