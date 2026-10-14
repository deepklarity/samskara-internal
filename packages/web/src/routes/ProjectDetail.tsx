import type { ReactNode } from "react"
import { useEffect, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { type ApiError, client, request } from "../api/client.js"
import type { ProjectDetail as ProjectDetailPayload, SessionSummary } from "../api/types.js"
import { SessionExpired } from "../auth/SessionExpired.js"
import { DeleteProjectDialog } from "../components/DeleteProjectDialog.js"
import { RepoLink } from "../components/RepoLink.js"
import { SessionRow } from "../components/SessionRow.js"
import { LoadingShell } from "../shell/LoadingShell.js"

type State =
  | { readonly phase: "loading" }
  | {
      readonly phase: "ready"
      readonly project: ProjectDetailPayload
      readonly viewerCanDelete: boolean
    }
  | { readonly phase: "failed"; readonly error: ApiError }

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="min-w-0">
    <p className="text-muted-foreground font-semibold">{label}</p>
    <p className="truncate font-mono text-[0.9375rem]">{children}</p>
  </div>
)

const ErrorState = ({ error }: { error: ApiError }) => (
  <section className="border border-destructive/40 bg-card p-6">
    <p className="text-muted-foreground font-semibold">Retrieval failed</p>
    <p className="mt-2 text-muted-foreground">{error.message}</p>
  </section>
)

const OwnerValue = ({ owner }: { owner: ProjectDetailPayload["owner"] }) =>
  owner.type === "org" ? (
    <Link
      to={`/orgs/${encodeURIComponent(owner.slug)}`}
      className="text-muted-foreground hover:underline"
    >
      org · {owner.slug}
    </Link>
  ) : (
    owner.slug
  )

export const ProjectDetail = () => {
  const { id } = useParams()
  const [state, setState] = useState<State>({ phase: "loading" })
  const [deleting, setDeleting] = useState(false)
  const [recent, setRecent] = useState<ReadonlyArray<SessionSummary> | null>(null)
  const [shownCount, setShownCount] = useState(10)
  const deleteTriggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let active = true

    request(() => client.api.projects[":id"].$get({ param: { id: id ?? "" } })).then((result) => {
      if (!active) return
      setState(
        result.ok
          ? {
              phase: "ready",
              project: result.data.project,
              viewerCanDelete: result.data.viewerCanDelete,
            }
          : { phase: "failed", error: result.error },
      )
    })

    return () => {
      active = false
    }
  }, [id])

  useEffect(() => {
    if (!id) return
    let active = true

    // Load enough that "show more" reveals the whole project; the API pages at 100.
    request(() =>
      client.api.sessions.$get({ query: { project: id, sort: "recent", limit: "100" } }),
    ).then((result) => {
      if (!active) return
      setRecent(result.ok ? result.data.sessions : [])
    })

    return () => {
      active = false
    }
  }, [id])

  if (state.phase === "loading") return <LoadingShell label="Retrieving the project" />
  if (state.phase === "failed") {
    if (state.error.kind === "unauthorized") return <SessionExpired />
    return <ErrorState error={state.error} />
  }

  const { project, viewerCanDelete } = state

  return (
    <section>
      <h1 className="text-case-title font-semibold leading-tight">{project.name}</h1>
      <div className="mt-4 grid grid-cols-2 gap-4 bg-card p-4 shadow-xs min-[560px]:grid-cols-4">
        <Field label="Slug">{project.slug}</Field>
        <Field label="Owner">
          <OwnerValue owner={project.owner} />
        </Field>
        {project.repo === null ? null : (
          <Field label="Repository">
            <RepoLink repo={project.repo} />
          </Field>
        )}
        <Field label="Sessions">{project.sessionCount}</Field>
      </div>
      <div className="mt-6 flex items-baseline justify-between gap-4">
        <h2 className="text-lead font-semibold">Sessions</h2>
        {project.sessionCount > 0 ? (
          <Link
            to={`/sessions?project=${encodeURIComponent(project.id)}`}
            className="text-muted-foreground font-semibold hover:underline"
          >
            Filter &amp; search these sessions
          </Link>
        ) : null}
      </div>

      {recent === null ? (
        <p className="mt-2 text-muted-foreground">Loading sessions…</p>
      ) : recent.length === 0 ? (
        <p className="mt-2 border bg-card p-4 text-muted-foreground">
          Nothing captured here yet. Run{" "}
          <code className="font-mono text-[0.78rem]">samskara watch</code> in this project to start
          recording sessions.
        </p>
      ) : (
        <>
          <ul className="mt-2 flex flex-col gap-2">
            {recent.slice(0, shownCount).map((session) => (
              <li key={session.id}>
                <SessionRow
                  session={session}
                  to={`/sessions/${encodeURIComponent(session.id)}`}
                  showProject={false}
                />
              </li>
            ))}
          </ul>
          {recent.length > shownCount ? (
            <button
              type="button"
              onClick={() => setShownCount((count) => count + 20)}
              className="mt-3 w-full bg-card px-4 py-2 text-sm font-semibold text-muted-foreground hover:border-muted-foreground hover:text-foreground"
            >
              Show more ({recent.length - shownCount} remaining)
            </button>
          ) : null}
        </>
      )}

      {viewerCanDelete ? (
        <div className="mt-8 border border-error/40 bg-card p-4">
          <h2 className="text-muted-foreground font-semibold">Delete this project</h2>
          <p className="mt-1 text-muted-foreground">
            Removes the project and every session captured in it. This cannot be undone.
          </p>
          <button
            ref={deleteTriggerRef}
            type="button"
            onClick={() => setDeleting(true)}
            className="mt-3 min-h-11 border border-destructive/60 bg-card px-4 py-2 text-sm font-semibold text-destructive"
          >
            Delete project
          </button>
        </div>
      ) : null}

      <DeleteProjectDialog
        open={deleting}
        project={{ id: project.id, slug: project.slug, sessionCount: project.sessionCount }}
        onClose={() => setDeleting(false)}
        restoreFocusTo={() => deleteTriggerRef.current}
      />
    </section>
  )
}
