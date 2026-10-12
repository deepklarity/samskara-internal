import { serve } from "@hono/node-server"
import { createLogger } from "@samskara/core"
import { buildApp } from "./app.js"
import { createDb } from "./db/client.js"
import { installCrashHandlers } from "./lib/crash-handlers.js"
import { loadEnv } from "./lib/env.js"
import { reapStaleReviewSandboxes } from "./services/ai-review/runner.js"

const rootLog = createLogger({ service: "samskara-server" })
installCrashHandlers(rootLog)

const env = loadEnv()
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL is required")

const { db } = createDb(databaseUrl)
const app = buildApp(db, env, { rootLog })

// Crash-orphaned review sandboxes never got their per-run `remove`: reap by label before
// serving, while the in-memory job registry guarantees nothing is running yet.
await reapStaleReviewSandboxes(process.env.MSB_BIN ?? "msb", rootLog)

const port = Number(process.env.PORT ?? 3000)

serve({ fetch: app.fetch, port }, (info) => {
  rootLog.info({ port: info.port }, "server listening")
})
