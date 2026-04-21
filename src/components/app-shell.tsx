"use client"

import { motion, useReducedMotion } from "framer-motion"
import { type ReactNode, useState, useSyncExternalStore } from "react"
import { usePathname } from "next/navigation"

import { Sidebar } from "@/components/sidebar"
import { Navbar } from "@/components/navbar"
import { BuildGuard } from "@/components/build-guard"
import type { DashboardScope } from "@/lib/secretariat-access"
import type { Committee, Profile } from "@/lib/supabase/types"
import { cn } from "@/lib/utils"

interface AppShellProps {
  profile: Profile
  committees: Committee[]
  activeCommitteeId?: string
  children: ReactNode
  eyebrow?: string
  title?: string
  description?: string
  actions?: ReactNode
  dashboardScope?: DashboardScope
  canViewOrgScope?: boolean
  mainClassName?: string
  containerClassName?: string
  initialBuildId?: string | null
}

const SIDEBAR_PINNED_STORAGE_KEY = "secretariat.sidebar.pinned"
const SIDEBAR_PINNED_CHANGE_EVENT = "secretariat:sidebar-pinned-change"

function subscribeToSidebarPinnedPreference(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => undefined
  }

  const handleStorageChange = (event: StorageEvent) => {
    if (event.key === SIDEBAR_PINNED_STORAGE_KEY) {
      onStoreChange()
    }
  }

  window.addEventListener("storage", handleStorageChange)
  window.addEventListener(SIDEBAR_PINNED_CHANGE_EVENT, onStoreChange)

  return () => {
    window.removeEventListener("storage", handleStorageChange)
    window.removeEventListener(SIDEBAR_PINNED_CHANGE_EVENT, onStoreChange)
  }
}

function getSidebarPinnedSnapshot() {
  if (typeof window === "undefined") {
    return false
  }

  return window.localStorage.getItem(SIDEBAR_PINNED_STORAGE_KEY) === "true"
}

export function AppShell({
  profile,
  committees,
  activeCommitteeId,
  children,
  eyebrow,
  title,
  description,
  actions,
  dashboardScope,
  canViewOrgScope = false,
  mainClassName,
  containerClassName,
  initialBuildId = null,
}: AppShellProps) {
  const pathname = usePathname()
  const reduceMotion = useReducedMotion()
  const [sidebarHovered, setSidebarHovered] = useState(false)
  const sidebarPinned = useSyncExternalStore(
    subscribeToSidebarPinnedPreference,
    getSidebarPinnedSnapshot,
    () => false
  )
  const sidebarCollapsed = !sidebarPinned && !sidebarHovered

  const toggleSidebarPinned = () => {
    const nextPinned = !sidebarPinned

    window.localStorage.setItem(
      SIDEBAR_PINNED_STORAGE_KEY,
      String(nextPinned)
    )
    window.dispatchEvent(new Event(SIDEBAR_PINNED_CHANGE_EVENT))

    if (nextPinned) {
      setSidebarHovered(false)
    }
  }

  return (
    <div className="relative h-screen overflow-hidden bg-background">
      <BuildGuard initialBuildId={initialBuildId} />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.12),transparent_24%),radial-gradient(circle_at_bottom_left,rgba(15,118,110,0.08),transparent_28%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(255,255,255,0))]" />
      <div className="relative flex h-screen">
        <Sidebar
          profile={profile}
          committees={committees}
          collapsed={sidebarCollapsed}
          onMouseEnter={() => {
            if (!sidebarPinned) {
              setSidebarHovered(true)
            }
          }}
          onMouseLeave={() => {
            if (!sidebarPinned) {
              setSidebarHovered(false)
            }
          }}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Navbar
            profile={profile}
            committees={committees}
            activeCommitteeId={activeCommitteeId}
            sidebarPinned={sidebarPinned}
            onToggleSidebarPinned={toggleSidebarPinned}
            dashboardScope={dashboardScope}
            canViewOrgScope={canViewOrgScope}
          />
          <motion.main
            key={pathname}
            initial={
              reduceMotion
                ? false
                : { opacity: 0, y: 18, filter: "blur(8px)" }
            }
            animate={
              reduceMotion
                ? {}
                : { opacity: 1, y: 0, filter: "blur(0px)" }
            }
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "min-h-0 flex-1 overflow-y-auto px-2 py-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:px-3.5 md:py-3.5 xl:px-4 xl:py-4",
              mainClassName
            )}
          >
            <div
              className={cn(
                "mx-auto flex w-full max-w-[1260px] flex-col gap-4",
                containerClassName
              )}
            >
              {(title || description || actions) && (
                <section className="relative overflow-hidden rounded-[18px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(247,250,249,0.94))] px-4 py-3.5 shadow-[0_24px_80px_-28px_rgba(15,23,42,0.22)] backdrop-blur xl:px-5 xl:py-4">
                  <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-80 bg-[radial-gradient(circle_at_right,rgba(16,185,129,0.16),transparent_62%)] md:block" />
                  <div className="relative flex flex-col gap-2.5 lg:flex-row lg:items-end lg:justify-between">
                    <div className="max-w-3xl space-y-2">
                      {eyebrow ? (
                        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.32em] text-primary/70">
                          {eyebrow}
                        </p>
                      ) : null}
                      {title ? (
                        <h1 className="font-display text-[1.55rem] font-semibold tracking-[-0.04em] text-foreground sm:text-[1.9rem]">
                          {title}
                        </h1>
                      ) : null}
                      {description ? (
                        <p className="max-w-2xl text-[0.84rem] leading-5 text-muted-foreground sm:text-[0.88rem]">
                          {description}
                        </p>
                      ) : null}
                    </div>
                    {actions ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {actions}
                      </div>
                    ) : null}
                  </div>
                </section>
              )}
              {children}
            </div>
          </motion.main>
        </div>
      </div>
    </div>
  )
}
