import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import type { ProjectSummary } from "../api/types.js"
import { absoluteTime } from "../time.js"
import { Card } from "./ui/card.js"

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="min-w-0">
    <p className="text-muted-foreground font-semibold">{label}</p>
    <p className="truncate font-mono text-sm tabular-nums">{children}</p>
  </div>
)

type Props = {
  readonly project: ProjectSummary
  readonly to: string
}

export const ProjectCard = ({ project, to }: Props) => {
  const { id, name, slug, owner, sessionCount, lastActiveAt } = project
  const dormant = sessionCount === 0

  return (
    <Card
      className="flex w-full flex-col gap-3 bg-card p-4 text-left focus-within:border-muted-foreground hover:border-muted-foreground"
      role="article"
    >
      <div className="min-w-0">
        <h2 className="truncate text-foreground font-semibold">
          <Link to={to} className="hover:underline">
            {name}
          </Link>
        </h2>
        <p className="truncate font-mono text-sm text-muted-foreground">/{slug}</p>
        <p className="truncate text-muted-foreground font-semibold">
          {owner.type === "org" ? (
            <Link
              to={`/orgs/${encodeURIComponent(owner.slug)}`}
              className="text-muted-foreground hover:underline"
            >
              org · {owner.slug}
            </Link>
          ) : (
            "yours"
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Sessions">{sessionCount}</Field>
        <Field label="Last active">
          {lastActiveAt === null ? (
            <span className="text-faded italic underline decoration-dotted">unavailable</span>
          ) : (
            absoluteTime(lastActiveAt)
          )}
        </Field>
      </div>

      {dormant ? (
        <output className="block border-t border pt-2 text-muted-foreground font-semibold">
          No sessions captured yet
        </output>
      ) : (
        <Link
          to={`/sessions?project=${encodeURIComponent(id)}`}
          className="block border-t border pt-2 text-sm font-semibold text-muted-foreground hover:underline"
        >
          View {sessionCount} sessions
        </Link>
      )}
    </Card>
  )
}
