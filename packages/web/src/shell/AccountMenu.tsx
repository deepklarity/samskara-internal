import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { PairingDialog } from "../account/PairingDialog.js"
import { logout } from "../api/account.js"
import type { ApiError } from "../api/client.js"
import type { CurrentUser } from "../api/types.js"
import { useAuth } from "../auth/AuthProvider.js"
import { Button } from "../components/ui/button.js"

const ITEM_CLASS =
  "block w-full px-3 py-2 text-left text-[0.78rem] hover:bg-card focus:bg-card focus-visible:outline-none"

const itemsWithin = (menu: HTMLElement | null): ReadonlyArray<HTMLElement> =>
  menu ? Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')) : []

const nextIndex = (key: string, current: number, count: number): number | null => {
  if (key === "ArrowDown") return current < 0 ? 0 : (current + 1) % count
  if (key === "ArrowUp") return current < 0 ? count - 1 : (current - 1 + count) % count
  if (key === "Home") return 0
  if (key === "End") return count - 1
  return null
}

const activeIndex = (items: ReadonlyArray<HTMLElement>): number => {
  const active = document.activeElement
  return active instanceof HTMLElement ? items.indexOf(active) : -1
}

export const AccountMenu = ({ user }: { user: CurrentUser }) => {
  const [open, setOpen] = useState(false)
  const [pairing, setPairing] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { clear } = useAuth()

  const close = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  const focusTrigger = useCallback(() => triggerRef.current, [])

  useEffect(() => {
    if (!open) return
    itemsWithin(menuRef.current)[0]?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault()
        close()
        return
      }

      const items = itemsWithin(menuRef.current)
      if (items.length === 0) return

      const target = nextIndex(event.key, activeIndex(items), items.length)
      if (target === null) return
      event.preventDefault()
      items[target]?.focus()
    }

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target
      if (target instanceof Node && containerRef.current?.contains(target)) return
      setOpen(false)
    }

    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("mousedown", onPointerDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("mousedown", onPointerDown)
    }
  }, [open, close])

  const onPair = useCallback(() => {
    setOpen(false)
    setPairing(true)
  }, [])

  const onLogout = useCallback(() => {
    setError(null)
    logout().then((result) => {
      if (!result.ok) {
        setError(result.error)
        return
      }
      setOpen(false)
      clear()
      navigate("/login", { replace: true })
    })
  }, [clear, navigate])

  return (
    <div ref={containerRef} className="relative shrink-0">
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="font-mono text-[0.78rem] text-muted-foreground max-sm:max-w-[45vw] max-sm:truncate"
      >
        <span className="text-muted-foreground">signed in</span> / {user.githubLogin}
      </Button>

      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Account"
          className="absolute right-0 z-20 mt-1 w-56 border bg-card py-1 rounded-md"
        >
          <p className="border-b rounded-md px-3 py-2 font-mono text-muted-foreground">
            {user.githubLogin}
          </p>
          <button type="button" role="menuitem" onClick={onPair} className={ITEM_CLASS}>
            Pair the CLI
          </button>
          <button type="button" role="menuitem" onClick={onLogout} className={ITEM_CLASS}>
            Log out
          </button>
          {error ? (
            <p
              role="alert"
              className="border-t rounded-md px-3 py-2 text-[0.78rem] text-destructive"
            >
              {error.message}
            </p>
          ) : null}
        </div>
      ) : null}

      <PairingDialog
        open={pairing}
        onClose={() => setPairing(false)}
        restoreFocusTo={focusTrigger}
      />
    </div>
  )
}
