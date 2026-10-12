import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { createLogger } from "@samskara/core"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { buildApp } from "../app.js"
import { createDb, type Db } from "../db/client.js"
import { projects, sessions, users } from "../db/schema.js"
import type { Env } from "../lib/env.js"
import { signToken } from "../lib/jwt.js"
import {
  dockerAvailable,
  localServerUrl,
  packageDir,
  throwawayOnLocalServer,
} from "../lib/test-db.js"
import {
  getLatestEndCodeState,
  getStartCodeState,
  listReviewCodeStates,
} from "../repositories/code-states.repo.js"

const env: Env = {
  githubClientId: "id",
  githubClientSecret: "secret",
  publicBaseUrl: "http://localhost:3000",
  webBaseUrl: "http://localhost:8000",
  cookieSecure: false,
  jwtSecret: "test-secret-value",
  jwtExpiresIn: "7d",
  superAdminLogins: [],
  localLoginSecret: "",
  localLoginLogin: "samskara-dev",
  aiReviewModel: "fake",
  aiReviewEffort: "standard",
  aiReviewHarness: "opencode",
  aiReviewTimeoutMs: 600000,
}
const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex")
const sha = "a".repeat(40)
const snapshot = (sessionId: string, captureId: string, content = "before\n") => ({
  version: 1 as const,
  sessionId,
  phase: "start" as const,
  captureId,
  capturedAt: "2026-09-28T00:00:00.000Z",
  completedAt: "2026-09-28T00:00:01.000Z",
  cwd: "/work/repo",
  repoRoot: "/work/repo",
  headSha: sha,
  complete: true,
  files: [
    {
      path: "src/a.ts",
      layer: "worktree" as const,
      kind: "file" as const,
      contentBase64: Buffer.from(content).toString("base64"),
      sha256: hash(content),
    },
  ],
  omissions: [],
})

describe.skipIf(localServerUrl() === undefined && !dockerAvailable())("code state uploads", () => {
  let container: StartedPostgreSqlContainer | undefined
  let db: Db
  let close: () => Promise<void>
  let app: ReturnType<typeof buildApp>
  let ownerToken: string
  let strangerToken: string
  const sessionId = "code-state-session"

  beforeAll(async () => {
    const local = localServerUrl()
    if (local) {
      const handle = await throwawayOnLocalServer(local)
      db = handle.db
      close = handle.stop
    } else {
      container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start()
      const url = container.getConnectionUri()
      execFileSync("bun", ["run", "db:migrate"], {
        cwd: packageDir,
        env: { ...process.env, DATABASE_URL: url },
        stdio: "inherit",
      })
      const handle = createDb(url)
      db = handle.db
      close = async () => {
        await handle.client.end()
        await container?.stop()
      }
    }
    const [owner, stranger] = await db
      .insert(users)
      .values([
        { githubId: 88181, githubLogin: "code-owner" },
        { githubId: 88182, githubLogin: "code-stranger" },
      ])
      .returning()
    if (!owner || !stranger) throw new Error("seed failed")
    const [project] = await db
      .insert(projects)
      .values({
        name: "code",
        slug: "code",
        ownerUserId: owner.id,
      })
      .returning()
    if (!project) throw new Error("project seed failed")
    await db.insert(sessions).values({
      id: sessionId,
      source: "claude_code",
      userId: owner.id,
      projectId: project.id,
      cwd: "/work/repo",
      startCommit: sha,
    })
    ownerToken = await signToken(env, { sub: owner.id, aud: "cli" })
    strangerToken = await signToken(env, { sub: stranger.id, aud: "cli" })
    app = buildApp(db, env, { rootLog: createLogger({ service: "code-state-test" }) })
  }, 60_000)
  afterAll(async () => {
    await close?.()
  })

  const post = (body: unknown, token?: string) =>
    app.request("/api/code-states/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token ?? ownerToken}`,
      },
      body: JSON.stringify(body),
    })

  const postEnd = (body: unknown, token?: string) =>
    app.request("/api/code-states/end", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token ?? ownerToken}`,
      },
      body: JSON.stringify(body),
    })

  test("stores the first complete start capture immutably", async () => {
    // The exact start hook can run before the first polling ingest; HEAD may move in between.
    const first = {
      ...snapshot(sessionId, "11111111-1111-4111-8111-111111111111"),
      headSha: "b".repeat(40),
    }
    expect((await post(first)).status).toBe(201)
    expect(
      (await post(snapshot(sessionId, "22222222-2222-4222-8222-222222222222", "later\n"))).status,
    ).toBe(200)
    expect((await getStartCodeState(db, sessionId))?.files[0]?.sha256).toBe(hash("before\n"))
  })

  test("rejects a foreign session and a corrupt file hash", async () => {
    expect(
      (await post(snapshot(sessionId, "33333333-3333-4333-8333-333333333333"), strangerToken))
        .status,
    ).toBe(409)
    const corrupt = snapshot(sessionId, "44444444-4444-4444-8444-444444444444")
    expect(
      (await post({ ...corrupt, files: [{ ...corrupt.files[0], sha256: hash("wrong") }] })).status,
    ).toBe(400)
    expect(await listReviewCodeStates(db, sessionId)).toEqual([])
  })

  test("retains successive end captures and selects only those complete by a watermark", async () => {
    const first = {
      ...snapshot(sessionId, "55555555-5555-4555-8555-555555555555", "first end\n"),
      phase: "end" as const,
      capturedAt: "2026-09-28T00:05:00.000Z",
      completedAt: "2026-09-28T00:05:01.000Z",
    }
    const second = {
      ...snapshot(sessionId, "66666666-6666-4666-8666-666666666666", "second end\n"),
      phase: "end" as const,
      capturedAt: "2026-09-28T00:10:00.000Z",
      completedAt: "2026-09-28T00:10:01.000Z",
    }
    expect((await postEnd(first)).status).toBe(201)
    expect((await postEnd(second)).status).toBe(201)
    expect((await postEnd(second)).status).toBe(200)
    expect((await getLatestEndCodeState(db, sessionId))?.captureId).toBe(second.captureId)
    expect(
      (await getLatestEndCodeState(db, sessionId, "2026-09-28T00:07:00.000Z"))?.captureId,
    ).toBe(first.captureId)
    expect((await postEnd(first, strangerToken)).status).toBe(409)
  })
})
