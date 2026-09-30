import { execFile } from "node:child_process"
import { mkdtemp, rm, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"
import BetterSqlite3 from "better-sqlite3"
import * as esbuild from "esbuild"
import { expect, test } from "vitest"

const execFileAsync = promisify(execFile)

const here = dirname(fileURLToPath(import.meta.url))

/**
 * The released CLI runs the compiled watcher as plain Node ESM, where a bare `require(...)`
 * is a ReferenceError -- unlike bun, tsx and vitest, which all shim one in. This test
 * transpiles the plugin to an ESM file exactly like the release build does and drives it
 * from a spawned Node, so a `require` that only works under a shim cannot pass.
 */
test("the Node sqlite driver loads from real ESM, where require does not exist", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "samskara-esm-"))
  // The transpiled module must live inside the package tree: createResolve(import.meta.url)
  // walks up from wherever the file sits to find node_modules.
  const transpiled = join(here, `opencode-esm-${process.pid}.mjs`)
  try {
    const dbPath = join(fixtureDir, "opencode.db")
    const db = new BetterSqlite3(dbPath)
    db.exec("CREATE TABLE session (id TEXT PRIMARY KEY)")
    db.prepare("INSERT INTO session (id) VALUES ('ses_probe')").run()
    db.close()

    esbuild.buildSync({
      entryPoints: [join(here, "opencode.ts")],
      outfile: transpiled,
      bundle: true,
      format: "esm",
      platform: "node",
      // Bundle the relative imports, leave package imports as bare specifiers -- the same
      // shape the release dist has.
      packages: "external",
    })

    const script = `
      const m = await import(${JSON.stringify(pathToFileURL(transpiled).href)})
      const db = await m.openDatabase(${JSON.stringify(dbPath)})
      const row = db.prepare("SELECT id FROM session").get()
      console.log(JSON.stringify(row))
    `
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        timeout: 30_000,
      },
    )
    expect(JSON.parse(stdout)).toEqual({ id: "ses_probe" })
  } catch (err) {
    const failure = err as { readonly stderr?: string; readonly message?: string }
    throw new Error(
      `openDatabase failed under real Node ESM: ${failure.stderr ?? failure.message ?? ""}`,
      { cause: err },
    )
  } finally {
    await unlink(transpiled).catch(() => undefined)
    await rm(fixtureDir, { recursive: true, force: true })
  }
}, 60_000)
