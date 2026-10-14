import { type FormEvent, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { type ApiError, client, request } from "../api/client.js"
import type { OrgSummary } from "../api/types.js"
import { useAuth } from "../auth/AuthProvider.js"
import { SessionExpired } from "../auth/SessionExpired.js"
import { Button } from "../components/ui/button.js"
import { Card, CardContent } from "../components/ui/card.js"
import { LoadingShell } from "../shell/LoadingShell.js"

type State =
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly orgs: ReadonlyArray<OrgSummary> }
  | { readonly phase: "failed"; readonly error: ApiError }

type FormState =
  | { readonly phase: "idle" }
  | { readonly phase: "submitting" }
  | { readonly phase: "failed"; readonly error: string }

const IDLE_FORM: FormState = { phase: "idle" }

const ErrorState = ({ error }: { error: ApiError }) => (
  <Card className="border border-destructive/40 bg-card">
    <CardContent className="p-6">
      <p className="text-muted-foreground font-semibold">Retrieval failed</p>
      <p className="mt-2 text-muted-foreground">{error.message}</p>
    </CardContent>
  </Card>
)

export const Orgs = () => {
  const { user } = useAuth()
  const [state, setState] = useState<State>({ phase: "loading" })
  const [slug, setSlug] = useState("")
  const [autoAdd, setAutoAdd] = useState(true)
  const [form, setForm] = useState<FormState>(IDLE_FORM)

  useEffect(() => {
    let active = true

    request(() => client.api.orgs.$get()).then((result) => {
      if (!active) return
      setState(
        result.ok
          ? { phase: "ready", orgs: result.data.orgs }
          : { phase: "failed", error: result.error },
      )
    })

    return () => {
      active = false
    }
  }, [])

  const register = (event: FormEvent) => {
    event.preventDefault()
    if (form.phase === "submitting") return
    setForm({ phase: "submitting" })

    request(() =>
      client.api.orgs.$post({ json: { githubSlug: slug, autoAddMembers: autoAdd } }),
    ).then((result) => {
      if (!result.ok) {
        setForm({ phase: "failed", error: result.error.message })
        return
      }
      const { org } = result.data
      setForm(IDLE_FORM)
      setSlug("")
      // Registering an org that is already listed answers 200, so replace by id rather than
      // append -- appending would show the same org twice, under a duplicate React key.
      setState((previous) =>
        previous.phase === "ready"
          ? {
              phase: "ready",
              orgs: previous.orgs.some((listed) => listed.id === org.id)
                ? previous.orgs.map((listed) => (listed.id === org.id ? org : listed))
                : [...previous.orgs, org],
            }
          : previous,
      )
    })
  }

  if (state.phase === "loading") return <LoadingShell label="Retrieving orgs" />
  if (state.phase === "failed") {
    if (state.error.kind === "unauthorized") return <SessionExpired />
    return <ErrorState error={state.error} />
  }

  return (
    <section>
      <h1 className="text-case-title font-semibold leading-tight">Orgs</h1>
      <ul className="mt-4 grid grid-cols-1 gap-4 min-[560px]:grid-cols-2 min-[840px]:grid-cols-3">
        {state.orgs.map((org) => (
          <li key={org.id}>
            <Link
              to={`/orgs/${encodeURIComponent(org.githubSlug)}`}
              className="flex w-full flex-col gap-2 bg-card p-4 text-left hover:border-muted-foreground"
            >
              <h2 className="truncate text-foreground font-semibold">{org.name}</h2>
              <p className="truncate font-mono text-sm text-muted-foreground">{org.githubSlug}</p>
            </Link>
          </li>
        ))}
      </ul>

      {user?.isSuperAdmin ? (
        <form onSubmit={register} className="mt-6 max-w-sm bg-card p-4">
          <h2 className="text-foreground font-semibold">Register an org</h2>
          <label
            htmlFor="org-slug-input"
            className="mt-3 block text-muted-foreground font-semibold"
          >
            GitHub org slug
          </label>
          <input
            id="org-slug-input"
            type="text"
            value={slug}
            disabled={form.phase === "submitting"}
            onChange={(event) => setSlug(event.target.value)}
            autoComplete="off"
            className="mt-1 w-full border bg-card px-3 py-2 font-mono text-sm"
          />
          <label className="mt-3 flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoAdd}
              disabled={form.phase === "submitting"}
              onChange={(event) => setAutoAdd(event.target.checked)}
            />
            Add new GitHub members automatically
          </label>
          <Button
            type="submit"
            disabled={form.phase === "submitting" || slug.trim() === ""}
            className="mt-4"
          >
            {form.phase === "submitting" ? "Registering…" : "Register"}
          </Button>
          {form.phase === "failed" ? (
            <p role="alert" className="mt-3 border border-error/40 bg-card p-3 text-error">
              {form.error}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  )
}
