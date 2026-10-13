import { useEffect, useState } from "react"
import { type ApiError, client, request } from "../api/client.js"
import type { ProjectSummary } from "../api/types.js"
import { SessionExpired } from "../auth/SessionExpired.js"
import { ProjectCard } from "../components/ProjectCard.js"
import { Card, CardContent } from "../components/ui/card.js"
import { LoadingShell } from "../shell/LoadingShell.js"

type Loaded = { readonly projects: ReadonlyArray<ProjectSummary> }

type State =
  | { readonly phase: "loading" }
  | ({ readonly phase: "ready" } & Loaded)
  | { readonly phase: "failed"; readonly error: ApiError }

const EmptyState = () => (
  <Card className="border-dashed bg-panel">
    <CardContent className="p-8 text-center">
      <p className="text-label font-semibold text-stamp">No case files yet</p>
      <h2 className="mt-2 text-lead font-semibold">Nothing has been filed here</h2>
      <p className="mx-auto mt-2 max-w-md text-ink-soft">
        Send your first capture from the CLI and this shelf fills itself. Run{" "}
        <code className="font-mono text-[0.78rem] text-custody">samskara capture</code> inside a
        project to file its sessions.
      </p>
    </CardContent>
  </Card>
)

const ErrorState = ({ error }: { error: ApiError }) => (
  <Card className="border-err/40 bg-panel">
    <CardContent className="p-6">
      <p className="text-label font-semibold text-err">Retrieval failed</p>
      <p className="mt-2 text-ink-soft">{error.message}</p>
    </CardContent>
  </Card>
)

export const Projects = () => {
  const [state, setState] = useState<State>({ phase: "loading" })

  useEffect(() => {
    let active = true

    request(() => client.api.projects.$get()).then((result) => {
      if (!active) return
      setState(
        result.ok
          ? { phase: "ready", projects: result.data.projects }
          : { phase: "failed", error: result.error },
      )
    })

    return () => {
      active = false
    }
  }, [])

  if (state.phase === "loading") return <LoadingShell label="Retrieving case files" />
  if (state.phase === "failed") {
    if (state.error.kind === "unauthorized") return <SessionExpired />
    return <ErrorState error={state.error} />
  }
  if (state.projects.length === 0) return <EmptyState />

  return (
    <section>
      <h1 className="text-case-title font-semibold leading-tight">Projects</h1>
      <ul className="mt-4 grid grid-cols-1 gap-4 min-[560px]:grid-cols-2 min-[840px]:grid-cols-3">
        {state.projects.map((project) => (
          <li key={project.id}>
            <ProjectCard project={project} to={`/projects/${encodeURIComponent(project.id)}`} />
          </li>
        ))}
      </ul>
    </section>
  )
}
