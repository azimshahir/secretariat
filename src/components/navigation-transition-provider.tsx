"use client"

import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import { cn } from "@/lib/utils"

type NavigationPhase = "idle" | "pending" | "settling"
type NavigateOptions = { scroll?: boolean }

interface NavigationPreparationResult {
  allow: boolean
  animated: boolean
}

interface NavigationTransitionContextValue {
  phase: NavigationPhase
  isNavigating: boolean
  prepareNavigation: (href: string | URL) => NavigationPreparationResult
}

const NavigationTransitionContext =
  createContext<NavigationTransitionContextValue | null>(null)

const OVERLAY_DELAY_MS = 120
const MIN_VISIBLE_MS = 240
const SETTLE_MS = 170

function isInternalAppPath(pathname: string) {
  return (
    pathname === "/" ||
    pathname === "/settings" ||
    pathname.startsWith("/settings/") ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/audit" ||
    pathname.startsWith("/audit/") ||
    pathname === "/meeting" ||
    pathname.startsWith("/meeting/") ||
    pathname === "/secretariat" ||
    pathname.startsWith("/secretariat/")
  )
}

function buildLocationKey(pathname: string, search: string) {
  return search ? `${pathname}?${search}` : pathname
}

function toAbsoluteUrl(href: string | URL) {
  if (typeof window === "undefined") return null

  try {
    return href instanceof URL ? href : new URL(href, window.location.href)
  } catch {
    return null
  }
}

function isSameDocumentHashNavigation(currentUrl: URL, nextUrl: URL) {
  return (
    currentUrl.pathname === nextUrl.pathname &&
    currentUrl.search === nextUrl.search &&
    currentUrl.hash !== nextUrl.hash
  )
}

function isExactSameUrl(currentUrl: URL, nextUrl: URL) {
  return (
    currentUrl.pathname === nextUrl.pathname &&
    currentUrl.search === nextUrl.search &&
    currentUrl.hash === nextUrl.hash
  )
}

function isPrimaryPlainClick(event: MouseEvent) {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  )
}

export function NavigationTransitionProvider({
  children,
}: {
  children: ReactNode
}) {
  const pathname = usePathname()

  return (
    <Suspense
      fallback={
        <NavigationTransitionProviderShell pathname={pathname} search="">
          {children}
        </NavigationTransitionProviderShell>
      }
    >
      <NavigationTransitionProviderContent pathname={pathname}>
        {children}
      </NavigationTransitionProviderContent>
    </Suspense>
  )
}

function NavigationTransitionProviderContent({
  children,
  pathname,
}: {
  children: ReactNode
  pathname: string
}) {
  const searchParams = useSearchParams()
  const search = searchParams.toString()

  return (
    <NavigationTransitionProviderShell pathname={pathname} search={search}>
      {children}
    </NavigationTransitionProviderShell>
  )
}

function NavigationTransitionProviderShell({
  children,
  pathname,
  search,
}: {
  children: ReactNode
  pathname: string
  search: string
}) {
  const reduceMotion = useReducedMotion()
  const locationKey = useMemo(
    () => buildLocationKey(pathname, search),
    [pathname, search]
  )

  const [phase, setPhase] = useState<NavigationPhase>("idle")
  const [showVeil, setShowVeil] = useState(false)
  const timersRef = useRef<{ veil: number | null; settle: number | null }>({
    veil: null,
    settle: null,
  })
  const phaseRef = useRef<NavigationPhase>("idle")
  const pendingStartedAtRef = useRef<number | null>(null)
  const lastCommittedLocationKeyRef = useRef(locationKey)

  const clearTimers = useCallback(() => {
    if (timersRef.current.veil) {
      window.clearTimeout(timersRef.current.veil)
      timersRef.current.veil = null
    }

    if (timersRef.current.settle) {
      window.clearTimeout(timersRef.current.settle)
      timersRef.current.settle = null
    }
  }, [])

  const finishNavigation = useCallback(() => {
    if (pendingStartedAtRef.current == null) {
      setPhase("idle")
      setShowVeil(false)
      return
    }

    clearTimers()

    const elapsed = performance.now() - pendingStartedAtRef.current
    const remaining = Math.max(SETTLE_MS, MIN_VISIBLE_MS - elapsed)

    setPhase("settling")
    setShowVeil(false)

    timersRef.current.settle = window.setTimeout(() => {
      pendingStartedAtRef.current = null
      setPhase("idle")
      setShowVeil(false)
    }, remaining)
  }, [clearTimers])

  const beginAnimatedNavigation = useCallback(() => {
    clearTimers()

    pendingStartedAtRef.current = performance.now()
    setPhase("pending")
    setShowVeil(false)

    if (!reduceMotion) {
      timersRef.current.veil = window.setTimeout(() => {
        if (phaseRef.current === "pending") {
          setShowVeil(true)
        }
      }, OVERLAY_DELAY_MS)
    }
  }, [clearTimers, reduceMotion])

  const prepareNavigation = useCallback(
    (href: string | URL): NavigationPreparationResult => {
      const nextUrl = toAbsoluteUrl(href)
      if (!nextUrl || typeof window === "undefined") {
        return { allow: true, animated: false }
      }

      const currentUrl = new URL(window.location.href)
      if (nextUrl.origin !== currentUrl.origin) {
        return { allow: true, animated: false }
      }

      if (isExactSameUrl(currentUrl, nextUrl)) {
        return { allow: false, animated: false }
      }

      if (isSameDocumentHashNavigation(currentUrl, nextUrl)) {
        return { allow: true, animated: false }
      }

      if (!isInternalAppPath(nextUrl.pathname)) {
        return { allow: true, animated: false }
      }

      if (phaseRef.current !== "idle") {
        return { allow: false, animated: false }
      }

      beginAnimatedNavigation()
      return { allow: true, animated: true }
    },
    [beginAnimatedNavigation]
  )

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  useEffect(() => {
    const shouldFinish =
      phaseRef.current !== "idle" &&
      locationKey !== lastCommittedLocationKeyRef.current
    lastCommittedLocationKeyRef.current = locationKey
    if (!shouldFinish) return

    const timeoutId = window.setTimeout(() => {
      finishNavigation()
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [finishNavigation, locationKey])

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented || !isPrimaryPlainClick(event)) return

      const target = event.target
      if (!(target instanceof Element)) return

      const anchor = target.closest("a[href]")
      if (!(anchor instanceof HTMLAnchorElement)) return
      if (anchor.dataset.navTransition === "false") return
      if (anchor.target && anchor.target !== "_self") return
      if (anchor.hasAttribute("download")) return

      const rel = anchor.getAttribute("rel")
      if (rel?.split(/\s+/).includes("external")) return

      const nextUrl = toAbsoluteUrl(anchor.href)
      if (!nextUrl || nextUrl.origin !== window.location.origin) return

      const result = prepareNavigation(nextUrl)
      if (!result.allow && isInternalAppPath(nextUrl.pathname)) {
        event.preventDefault()
      }
    }

    document.addEventListener("click", handleDocumentClick)
    return () => {
      document.removeEventListener("click", handleDocumentClick)
    }
  }, [prepareNavigation])

  useEffect(() => {
    const handlePopState = () => {
      const nextUrl = new URL(window.location.href)
      if (!isInternalAppPath(nextUrl.pathname) || phaseRef.current !== "idle") {
        return
      }

      beginAnimatedNavigation()
    }

    window.addEventListener("popstate", handlePopState)
    return () => {
      window.removeEventListener("popstate", handlePopState)
    }
  }, [beginAnimatedNavigation])

  useEffect(() => {
    return () => {
      clearTimers()
    }
  }, [clearTimers])

  const currentPathIsInternal = isInternalAppPath(pathname)
  const showWorkspaceVeil =
    currentPathIsInternal && phase === "pending" && showVeil

  const contextValue = useMemo<NavigationTransitionContextValue>(
    () => ({
      phase,
      isNavigating: phase !== "idle",
      prepareNavigation,
    }),
    [phase, prepareNavigation]
  )

  return (
    <NavigationTransitionContext.Provider value={contextValue}>
      <div className="relative min-h-screen">
        <AnimatePresence>
          {phase !== "idle" ? (
            <motion.div
              key="navigation-progress"
              aria-hidden="true"
              className="pointer-events-none fixed inset-x-0 top-0 z-[150] h-1 overflow-hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="h-full origin-left bg-[linear-gradient(90deg,rgba(13,148,136,0.95),rgba(45,212,191,0.95),rgba(153,246,228,0.9))] shadow-[0_8px_24px_rgba(13,148,136,0.35)]"
                initial={reduceMotion ? { scaleX: 0.2 } : { scaleX: 0.08 }}
                animate={
                  phase === "settling"
                    ? { scaleX: 1 }
                    : { scaleX: reduceMotion ? 0.75 : 0.88 }
                }
                transition={
                  phase === "settling"
                    ? {
                        duration: reduceMotion ? 0.18 : 0.24,
                        ease: "easeOut",
                      }
                    : {
                        duration: reduceMotion ? 0.18 : 0.42,
                        ease: [0.22, 1, 0.36, 1],
                      }
                }
              />
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div
          aria-busy={showWorkspaceVeil}
          className={cn(
            "min-h-screen transition-[filter,opacity,transform] duration-200 ease-out",
            showWorkspaceVeil &&
              (reduceMotion
                ? "opacity-[0.96]"
                : "scale-[0.997] opacity-[0.9] blur-[1.5px]")
          )}
        >
          {children}
        </div>

        <AnimatePresence>
          {showWorkspaceVeil ? (
            <motion.div
              key="navigation-veil"
              aria-hidden="true"
              className="fixed inset-0 z-[140] cursor-progress bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.12),transparent_22%),linear-gradient(180deg,rgba(241,245,249,0.28),rgba(255,255,255,0.38))] backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: reduceMotion ? 0.8 : 1 }}
              exit={{ opacity: 0 }}
              transition={{
                duration: reduceMotion ? 0.12 : 0.18,
                ease: "easeOut",
              }}
            />
          ) : null}
        </AnimatePresence>
      </div>
    </NavigationTransitionContext.Provider>
  )
}

export function useNavigationTransition() {
  const context = useContext(NavigationTransitionContext)
  const router = useRouter()
  const safeContext = useMemo(
    () =>
      context ?? {
        phase: "idle" as const,
        isNavigating: false,
        prepareNavigation: () => ({ allow: true, animated: false }),
      },
    [context]
  )

  const push = useCallback(
    (href: string, options?: NavigateOptions) => {
      const result = safeContext.prepareNavigation(href)
      if (!result.allow) return false

      router.push(href, options)
      return true
    },
    [router, safeContext]
  )

  const replace = useCallback(
    (href: string, options?: NavigateOptions) => {
      const result = safeContext.prepareNavigation(href)
      if (!result.allow) return false

      router.replace(href, options)
      return true
    },
    [router, safeContext]
  )

  return {
    phase: safeContext.phase,
    isNavigating: safeContext.isNavigating,
    push,
    replace,
  }
}
