import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { z } from "zod"
import { resolveCliEntry } from "../config/daemon.js"
import { profile } from "../config/paths.js"
import { reportError, resolveIo, type Writer } from "../io.js"

const hookCommandSchema = z
  .object({
    type: z.string().optional(),
    command: z.string().optional(),
    timeout: z.number().optional(),
  })
  .passthrough()
const hookMatcherSchema = z
  .object({ matcher: z.string().optional(), hooks: z.array(hookCommandSchema) })
  .passthrough()
const recordSchema = z.record(z.string(), z.unknown())
type Event = "SessionStart" | "SessionEnd"
const markerBase = (event: Event): string =>
  event === "SessionStart" ? "samskara:ensure" : "samskara:capture-end"

/** One marker per profile, so a dev install and a release install manage separate hook lines. */
const marker = (event: Event): string =>
  profile() === "default" ? markerBase(event) : `${markerBase(event)}:${profile()}`

type Hook = z.infer<typeof hookCommandSchema>
type Matcher = z.infer<typeof hookMatcherSchema>
type JsonRecord = z.infer<typeof recordSchema>
type Status = "missing" | "stale" | "current"

export type HookCommandOptions = {
  readonly settingsPath?: string
  readonly stdout?: Writer
  readonly stderr?: Writer
}

const defaultSettingsPath = (): string => join(homedir(), ".claude", "settings.json")

const parseError = (path: string): Error => new Error(`failed to parse ${path}`)

const parseOrThrow = <T>(schema: z.ZodType<T>, value: unknown, path: string): T => {
  const result = schema.safeParse(value)
  if (!result.success) throw parseError(path)
  return result.data
}

const readSettings = (path: string): JsonRecord => {
  if (!existsSync(path)) return {}
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    throw parseError(path)
  }
  return parseOrThrow(recordSchema, raw, path)
}

const writeSettings = (path: string, settings: JsonRecord): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`)
}

/**
 * Claude Code runs this command with its own environment, never the shell that installed it, so a
 * non-default profile has to travel inside the command itself.
 */
const managedCommand = (event: Event): string => {
  const prefix = profile() === "default" ? "" : `SAMSKARA_PROFILE=${profile()} `
  const command = event === "SessionStart" ? "ensure" : "capture-end"
  return `${prefix}${JSON.stringify(process.execPath)} ${JSON.stringify(resolveCliEntry())} ${command} # ${marker(event)}`
}

// Anchored, not `includes`: `samskara:ensure` is a prefix of `samskara:ensure:dev`, so a substring
// match would let the default profile adopt every other profile's hook and overwrite it as stale.
const isManaged = (hook: Hook, event: Event): hook is Hook & { command: string } =>
  hook.command?.endsWith(`# ${marker(event)}`) === true

const statusOf = (matchers: ReadonlyArray<Matcher>, event: Event): Status => {
  const found = matchers.flatMap((matcher) =>
    matcher.hooks.filter((hook) => isManaged(hook, event)),
  )
  if (found.length === 0) return "missing"
  const want = managedCommand(event)
  return found.every(
    (hook) => hook.command === want && (event !== "SessionEnd" || hook.timeout === 15),
  )
    ? "current"
    : "stale"
}

const withCommand = (matchers: ReadonlyArray<Matcher>, event: Event): ReadonlyArray<Matcher> =>
  matchers.map((matcher) => ({
    ...matcher,
    hooks: matcher.hooks.map((hook) =>
      isManaged(hook, event)
        ? {
            ...hook,
            command: managedCommand(event),
            ...(event === "SessionEnd" ? { timeout: 15 } : {}),
          }
        : hook,
    ),
  }))

const withoutManaged = (matchers: ReadonlyArray<Matcher>, event: Event): ReadonlyArray<Matcher> =>
  matchers
    .map((matcher) => ({
      ...matcher,
      hooks: matcher.hooks.filter((hook) => !isManaged(hook, event)),
    }))
    .filter((matcher) => matcher.hooks.length > 0)

type Current = {
  readonly settings: JsonRecord
  readonly hooks: JsonRecord
  readonly sessionStart: ReadonlyArray<Matcher>
  readonly sessionEnd: ReadonlyArray<Matcher>
}

const readCurrent = (path: string): Current => {
  const settings = readSettings(path)
  const hooks = settings.hooks === undefined ? {} : parseOrThrow(recordSchema, settings.hooks, path)
  const sessionStart =
    hooks.SessionStart === undefined
      ? []
      : parseOrThrow(z.array(hookMatcherSchema), hooks.SessionStart, path)
  const sessionEnd =
    hooks.SessionEnd === undefined
      ? []
      : parseOrThrow(z.array(hookMatcherSchema), hooks.SessionEnd, path)
  return { settings, hooks, sessionStart, sessionEnd }
}

const saveHooks = (
  path: string,
  current: Current,
  sessionStart: ReadonlyArray<Matcher>,
  sessionEnd: ReadonlyArray<Matcher>,
): void => {
  const hooks = Object.fromEntries(
    Object.entries(current.hooks).filter(([key]) => key !== "SessionStart" && key !== "SessionEnd"),
  )
  if (sessionStart.length > 0) hooks.SessionStart = sessionStart
  if (sessionEnd.length > 0) hooks.SessionEnd = sessionEnd
  writeSettings(path, { ...current.settings, hooks })
}

export const isManagedHookInstalled = (options: HookCommandOptions = {}): boolean => {
  try {
    const path = options.settingsPath ?? defaultSettingsPath()
    const current = readCurrent(path)
    return (
      statusOf(current.sessionStart, "SessionStart") !== "missing" &&
      statusOf(current.sessionEnd, "SessionEnd") !== "missing"
    )
  } catch {
    return false
  }
}

export const installHooksCommand = (options: HookCommandOptions = {}): number => {
  const path = options.settingsPath ?? defaultSettingsPath()
  const { stdout, stderr } = resolveIo(options)

  try {
    const current = readCurrent(path)
    const startStatus = statusOf(current.sessionStart, "SessionStart")
    const endStatus = statusOf(current.sessionEnd, "SessionEnd")

    if (startStatus === "current" && endStatus === "current") {
      stdout.write(`hook already installed in ${path}\n`)
      return 0
    }

    saveHooks(
      path,
      current,
      startStatus === "stale"
        ? withCommand(current.sessionStart, "SessionStart")
        : startStatus === "current"
          ? current.sessionStart
          : [
              ...current.sessionStart,
              { hooks: [{ type: "command", command: managedCommand("SessionStart") }] },
            ],
      endStatus === "stale"
        ? withCommand(current.sessionEnd, "SessionEnd")
        : endStatus === "current"
          ? current.sessionEnd
          : [
              ...current.sessionEnd,
              { hooks: [{ type: "command", command: managedCommand("SessionEnd"), timeout: 15 }] },
            ],
    )
    stdout.write(
      `${startStatus === "stale" || endStatus === "stale" ? "repaired" : "installed"} session hooks in ${path}\n`,
    )
    return 0
  } catch (error) {
    return reportError(stderr, error)
  }
}

export const uninstallHooksCommand = (options: HookCommandOptions = {}): number => {
  const path = options.settingsPath ?? defaultSettingsPath()
  const { stdout, stderr } = resolveIo(options)
  if (!existsSync(path)) {
    stdout.write("nothing to uninstall\n")
    return 0
  }

  try {
    const current = readCurrent(path)
    saveHooks(
      path,
      current,
      withoutManaged(current.sessionStart, "SessionStart"),
      withoutManaged(current.sessionEnd, "SessionEnd"),
    )
    stdout.write(`removed samskara hook from ${path}\n`)
    return 0
  } catch (error) {
    return reportError(stderr, error)
  }
}
