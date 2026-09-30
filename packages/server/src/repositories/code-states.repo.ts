import type { CodeStateSnapshot } from "@samskara/core"
import { and, asc, desc, eq, lte } from "drizzle-orm"
import type { Querier } from "../db/client.js"
import { codeStateSnapshots } from "../db/schema.js"

/** The first start capture wins, even if it was incomplete. Its timing is part of the evidence. */
export const saveStartCodeState = async (
  db: Querier,
  snapshot: CodeStateSnapshot,
): Promise<{ readonly captureId: string; readonly stored: boolean }> => {
  if (snapshot.phase !== "start") throw new Error("expected start code state")
  const [created] = await db
    .insert(codeStateSnapshots)
    .values({
      captureId: snapshot.captureId,
      sessionId: snapshot.sessionId,
      phase: snapshot.phase,
      capturedAt: new Date(snapshot.capturedAt),
      completedAt: new Date(snapshot.completedAt),
      snapshot,
    })
    .onConflictDoNothing()
    .returning({ captureId: codeStateSnapshots.captureId })
  if (created) return { captureId: created.captureId, stored: true }
  const existing = await getStartCodeState(db, snapshot.sessionId)
  if (!existing) throw new Error("start capture conflict without a stored start")
  return { captureId: existing.captureId, stored: false }
}

/** A review capture is immutable and uniquely identified by captureId. */
export const saveReviewCodeState = async (
  db: Querier,
  snapshot: CodeStateSnapshot,
): Promise<{ readonly captureId: string; readonly stored: boolean }> => {
  if (snapshot.phase !== "review") throw new Error("expected review code state")
  const [created] = await db
    .insert(codeStateSnapshots)
    .values({
      captureId: snapshot.captureId,
      sessionId: snapshot.sessionId,
      phase: snapshot.phase,
      capturedAt: new Date(snapshot.capturedAt),
      completedAt: new Date(snapshot.completedAt),
      snapshot,
    })
    .onConflictDoNothing()
    .returning({ captureId: codeStateSnapshots.captureId })
  if (created) return { captureId: created.captureId, stored: true }
  const [row] = await db
    .select({ sessionId: codeStateSnapshots.sessionId, phase: codeStateSnapshots.phase })
    .from(codeStateSnapshots)
    .where(eq(codeStateSnapshots.captureId, snapshot.captureId))
  if (row?.sessionId !== snapshot.sessionId || row.phase !== "review")
    throw new Error("capture id already belongs to a different session or phase")
  return { captureId: snapshot.captureId, stored: false }
}

/** Every end capture is retained, including later continuations of the same session. */
export const saveEndCodeState = async (
  db: Querier,
  snapshot: CodeStateSnapshot,
): Promise<{ readonly captureId: string; readonly stored: boolean }> => {
  if (snapshot.phase !== "end") throw new Error("expected end code state")
  const [created] = await db
    .insert(codeStateSnapshots)
    .values({
      captureId: snapshot.captureId,
      sessionId: snapshot.sessionId,
      phase: snapshot.phase,
      capturedAt: new Date(snapshot.capturedAt),
      completedAt: new Date(snapshot.completedAt),
      snapshot,
    })
    .onConflictDoNothing()
    .returning({ captureId: codeStateSnapshots.captureId })
  if (created) return { captureId: created.captureId, stored: true }
  const [row] = await db
    .select({ sessionId: codeStateSnapshots.sessionId, phase: codeStateSnapshots.phase })
    .from(codeStateSnapshots)
    .where(eq(codeStateSnapshots.captureId, snapshot.captureId))
  if (row?.sessionId !== snapshot.sessionId || row.phase !== "end")
    throw new Error("capture id already belongs to a different session or phase")
  return { captureId: snapshot.captureId, stored: false }
}

export const getStartCodeState = async (
  db: Querier,
  sessionId: string,
): Promise<CodeStateSnapshot | null> => {
  const [row] = await db
    .select({ snapshot: codeStateSnapshots.snapshot })
    .from(codeStateSnapshots)
    .where(and(eq(codeStateSnapshots.sessionId, sessionId), eq(codeStateSnapshots.phase, "start")))
    .limit(1)
  return (row?.snapshot as CodeStateSnapshot | undefined) ?? null
}

/** A capture contributes to a review only after it completed by the review watermark. */
export const getLatestEndCodeState = async (
  db: Querier,
  sessionId: string,
  capturedBefore?: string,
): Promise<CodeStateSnapshot | null> => {
  const [row] = await db
    .select({ snapshot: codeStateSnapshots.snapshot })
    .from(codeStateSnapshots)
    .where(
      and(
        eq(codeStateSnapshots.sessionId, sessionId),
        eq(codeStateSnapshots.phase, "end"),
        capturedBefore === undefined
          ? undefined
          : lte(codeStateSnapshots.completedAt, new Date(capturedBefore)),
      ),
    )
    .orderBy(desc(codeStateSnapshots.completedAt), desc(codeStateSnapshots.captureId))
    .limit(1)
  return (row?.snapshot as CodeStateSnapshot | undefined) ?? null
}

export const listReviewCodeStates = async (
  db: Querier,
  sessionId: string,
): Promise<ReadonlyArray<CodeStateSnapshot>> => {
  const rows = await db
    .select({ snapshot: codeStateSnapshots.snapshot })
    .from(codeStateSnapshots)
    .where(and(eq(codeStateSnapshots.sessionId, sessionId), eq(codeStateSnapshots.phase, "review")))
    .orderBy(asc(codeStateSnapshots.capturedAt))
  return rows.map((row) => row.snapshot as CodeStateSnapshot)
}
