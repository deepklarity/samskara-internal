import { createHash } from "node:crypto"
import { isAbsolute, relative } from "node:path"
import {
  codeStateSnapshotSchema,
  MAX_CODE_STATE_FILE_BYTES,
  MAX_CODE_STATE_PATHS,
  MAX_CODE_STATE_TOTAL_BYTES,
} from "@samskara/core"
import { eq } from "drizzle-orm"
import { type Context, Hono } from "hono"
import type { Db } from "../db/client.js"
import { sessions } from "../db/schema.js"
import type { Env } from "../lib/env.js"
import { type AuthVariables, requireAuth } from "../lib/require-auth.js"
import { saveEndCodeState, saveStartCodeState } from "../repositories/code-states.repo.js"

const MAX_WIRE_BYTES = Math.ceil(MAX_CODE_STATE_TOTAL_BYTES * 1.5) + 1024 * 1024
const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const within = (root: string, path: string): boolean => {
  if (!isAbsolute(path)) return false
  const rel = relative(root, path)
  return rel === "" || (rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel))
}
const safePath = (path: string): boolean =>
  !path.startsWith("/") &&
  !path.split("/").some((part) => part === "" || part === "." || part === "..")

/** Validate decoded bytes as well as metadata; JSON syntax alone cannot establish integrity. */
export const codeStateBytesProblem = (snapshot: {
  readonly files: ReadonlyArray<{
    readonly kind: string
    readonly contentBase64?: string
    readonly sha256?: string
  }>
}): "invalid" | "tooLarge" | null => {
  let total = 0
  for (const file of snapshot.files) {
    if (file.kind === "deletion") {
      if (file.contentBase64 !== undefined || file.sha256 !== undefined) return "invalid"
      continue
    }
    if (file.contentBase64 === undefined || !file.sha256 || !BASE64.test(file.contentBase64))
      return "invalid"
    const bytes = Buffer.from(file.contentBase64, "base64")
    if (bytes.byteLength > MAX_CODE_STATE_FILE_BYTES) return "tooLarge"
    total += bytes.byteLength
    if (total > MAX_CODE_STATE_TOTAL_BYTES) return "tooLarge"
    if (createHash("sha256").update(bytes).digest("hex") !== file.sha256.toLowerCase())
      return "invalid"
  }
  return null
}

const upload =
  (db: Db, phase: "start" | "end") => async (context: Context<{ Variables: AuthVariables }>) => {
    const contentLength = Number(context.req.header("content-length") ?? 0)
    if (contentLength > MAX_WIRE_BYTES)
      return context.json({ error: "captureTooLarge" } as const, 413)
    const raw = await context.req.text()
    if (Buffer.byteLength(raw) > MAX_WIRE_BYTES)
      return context.json({ error: "captureTooLarge" } as const, 413)
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return context.json({ error: "invalidCapture" } as const, 400)
    }
    const result = codeStateSnapshotSchema.safeParse(parsed)
    if (!result.success || result.data.phase !== phase || !SHA.test(result.data.headSha))
      return context.json({ error: "invalidCapture" } as const, 400)
    const snapshot = result.data
    const layerPaths = new Set<string>()
    if (
      snapshot.completedAt < snapshot.capturedAt ||
      (snapshot.complete && snapshot.omissions.length > 0) ||
      snapshot.files.length > MAX_CODE_STATE_PATHS ||
      !within(snapshot.repoRoot, snapshot.cwd) ||
      snapshot.files.some((file) => {
        const key = `${file.layer}\0${file.path}`
        if (
          !safePath(file.path) ||
          (file.previousPath !== undefined && !safePath(file.previousPath)) ||
          layerPaths.has(key)
        )
          return true
        layerPaths.add(key)
        return false
      })
    )
      return context.json({ error: "invalidCapture" } as const, 400)
    const bytesProblem = codeStateBytesProblem(snapshot)
    if (bytesProblem)
      return context.json(
        { error: bytesProblem === "tooLarge" ? "captureTooLarge" : "invalidCapture" } as const,
        bytesProblem === "tooLarge" ? 413 : 400,
      )
    const [session] = await db
      .select({ userId: sessions.userId, cwd: sessions.cwd })
      .from(sessions)
      .where(eq(sessions.id, snapshot.sessionId))
      .limit(1)
    if (!session || session.userId !== context.get("user").id)
      return context.json({ error: "sessionNotFound" } as const, 409)
    if (session.cwd !== null && !within(snapshot.repoRoot, session.cwd))
      return context.json({ error: "originMismatch" } as const, 400)
    const stored =
      phase === "start"
        ? await saveStartCodeState(db, snapshot)
        : await saveEndCodeState(db, snapshot)
    return context.json(stored, stored.stored ? 201 : 200)
  }

export const codeStateRoutes = ({ db, env }: { readonly db: Db; readonly env: Env }) =>
  new Hono<{ Variables: AuthVariables }>()
    .post("/start", requireAuth({ db, env }, ["cli"]), upload(db, "start"))
    .post("/end", requireAuth({ db, env }, ["cli"]), upload(db, "end"))
