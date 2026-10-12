#!/usr/bin/env bun
/**
 * review-shot — screenshot the session review tab against the running local stack.
 *
 *   scripts/review-shot.ts [sessionId] [--out dir] [--widths 1440,390]
 *
 * Logs in with LOCAL_LOGIN_SECRET from .env, opens ?tab=review, waits for the
 * verdict headline, and writes desktop + mobile PNGs. Exit non-zero when the
 * review has not landed (nothing to shoot).
 */
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium } from "@playwright/test"

const API = process.env.API_BASE ?? "http://localhost:3000"
const WEB = process.env.WEB_BASE ?? "http://localhost:8000"
const SESSION = process.argv[2] ?? "60a32350-d62d-41b6-a252-255c8ad938fa"
const outDir = (() => {
  const i = process.argv.indexOf("--out")
  return i === -1 ? "/tmp/review-shots" : (process.argv[i + 1] as string)
})()
const widths = (() => {
  const i = process.argv.indexOf("--widths")
  return i === -1 ? [1440, 390] : (process.argv[i + 1] as string).split(",").map(Number)
})()

const envText = await readFile(new URL("../.env", import.meta.url), "utf8").catch(() => "")
const secret = /^LOCAL_LOGIN_SECRET=(.+)$/m.exec(envText)?.[1]?.trim()
if (!secret) throw new Error("LOCAL_LOGIN_SECRET missing from .env")

const login = await fetch(`${API}/api/auth/local`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ secret }),
})
if (!login.ok) throw new Error(`local login failed: ${login.status}`)
const setCookie = login.headers.get("set-cookie") ?? ""
const sessionCookie = /([^=;\s]+)=([^;]+)/.exec(setCookie)
if (!sessionCookie) throw new Error("no session cookie in login response")

const browser = await chromium.launch()
try {
  const failed: string[] = []
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 2,
    })
    await context.addCookies([
      {
        name: sessionCookie[1] as string,
        value: decodeURIComponent(sessionCookie[2] as string),
        domain: "localhost",
        path: "/",
      },
    ])
    const page = await context.newPage()
    await page.goto(`${WEB}/sessions/${SESSION}?tab=review`, { waitUntil: "networkidle" })
    const headline = page.locator("text=AI review").first()
    await headline.waitFor({ timeout: 15_000 }).catch(() => failed.push(`no headline@${width}`))
    await page.waitForTimeout(800)
    const shot = join(outDir, `review-${width}.png`)
    await page.screenshot({ path: shot, fullPage: true })
    console.log(`shot ${shot}`)
    await context.close()
  }
  if (failed.length > 0) {
    console.error(`WARN: ${failed.join("; ")}`)
    process.exitCode = 2
  }
} finally {
  await browser.close()
}
