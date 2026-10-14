import { type ReactNode, useId } from "react"
import { Input } from "./ui/input.js"
import { Label } from "./ui/label.js"

export const controlClass =
  "h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted/50 disabled:opacity-50"
export const labelClass = "block text-sm font-medium text-muted-foreground"

type Props = {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly placeholder?: string
  readonly hint?: string
  readonly trailing?: ReactNode
}

export const TextField = ({ label, value, onChange, placeholder, hint, trailing }: Props) => {
  const id = useId()
  const hintId = `${id}-hint`

  return (
    <>
      <Label htmlFor={id} className={labelClass}>
        {label}
      </Label>
      <div className="mt-1 flex gap-1.5">
        <Input
          id={id}
          className={`${controlClass} mt-0`}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={hint === undefined ? undefined : hintId}
        />
        {trailing}
      </div>
      {hint === undefined ? null : (
        <span id={hintId} className="sr-only">
          {hint}
        </span>
      )}
    </>
  )
}
