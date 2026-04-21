'use client'

import type { MouseEventHandler } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { usePathname } from 'next/navigation'
import {
  ArrowUpRight,
  LayoutDashboard,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'

import { SidebarUserCard } from '@/components/sidebar-user-card'
import type { Committee, Profile } from '@/lib/supabase/types'
import { cn } from '@/lib/utils'

interface SidebarProps {
  profile: Profile
  committees: Committee[]
  collapsed?: boolean
  onMouseEnter?: MouseEventHandler<HTMLElement>
  onMouseLeave?: MouseEventHandler<HTMLElement>
}

const workspaceItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/secretariat/new', label: 'New secretariat', icon: Plus },
]

const governanceItems = [
  { href: '/settings', label: 'Settings', icon: Settings },
]

function NavItem({ href, label, icon: Icon, active, collapsed }: {
  href: string; label: string; icon: typeof LayoutDashboard; active: boolean; collapsed: boolean
}) {
  return (
    <motion.div whileHover={{ x: 4 }} transition={{ duration: 0.18 }}>
      <Link
        href={href}
        title={label}
        className={cn(
          'flex items-center px-2 py-2.5 text-[0.84rem] transition-all duration-200',
          collapsed ? 'justify-center rounded-[12px]' : 'justify-between rounded-[13px]',
          active
            ? 'bg-primary text-primary-foreground shadow-[0_18px_40px_-28px_rgba(8,98,98,0.85)]'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
        )}
      >
        <span className={cn('flex items-center', collapsed ? 'justify-center' : 'gap-3')}>
          <span className={cn(
            'flex h-8 w-8 items-center justify-center rounded-[10px]',
            active ? 'bg-white/14 text-white' : 'bg-primary/8 text-primary'
          )}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          {!collapsed ? label : null}
        </span>
        {!collapsed && active ? <Sparkles className="h-3.5 w-3.5" /> : null}
      </Link>
    </motion.div>
  )
}

function NavGroup({ label, collapsed, children }: { label: string; collapsed: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      {!collapsed ? (
        <p className="px-1 text-[0.58rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground/80">
          {label}
        </p>
      ) : null}
      <div className="space-y-1.25">{children}</div>
    </div>
  )
}

export function Sidebar({
  profile,
  committees,
  collapsed = false,
  onMouseEnter,
  onMouseLeave,
}: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 overflow-hidden border-r border-border/70 bg-white/75 py-2.5 backdrop-blur-xl transition-[width,padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] md:flex md:flex-col",
        collapsed ? "w-[92px] px-2" : "w-[236px] px-2.5"
      )}
    >
      <div
        className={cn(
          "surface-card flex h-full flex-col border border-white/70 transition-[border-radius,padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          collapsed ? "rounded-[18px] px-2 py-3" : "rounded-[20px] px-3 py-3.5"
        )}
      >
        {!collapsed ? (
          <div className="px-1 pb-0.5">
            <p className="font-display text-[1.22rem] font-semibold tracking-[-0.05em] text-foreground">
              Secretariat.my
            </p>
          </div>
        ) : null}

        <nav
          className={cn(
            "flex-1 space-y-4 overflow-y-auto pr-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
            collapsed ? "mt-2" : "mt-2.5"
          )}
        >
          <NavGroup label="Workspace" collapsed={collapsed}>
            {workspaceItems.map(item => (
              <NavItem
                key={item.href}
                {...item}
                collapsed={collapsed}
                active={item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)}
              />
            ))}
          </NavGroup>

          {committees.length > 0 && (
            <NavGroup label="Secretariats" collapsed={collapsed}>
              {committees.map(c => {
                const href = `/secretariat/${c.slug}`
                const active = pathname.startsWith(href)
                return (
                  <motion.div key={c.id} whileHover={{ x: 4 }} transition={{ duration: 0.18 }}>
                    <Link
                      href={href}
                      title={c.name}
                      className={cn(
                        'flex px-2 py-2.5 text-[0.84rem] transition-all duration-200',
                        collapsed ? 'items-center justify-center rounded-[12px]' : 'items-start justify-between rounded-[13px]',
                        active
                          ? 'bg-primary text-primary-foreground shadow-[0_18px_40px_-28px_rgba(8,98,98,0.85)]'
                          : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                      )}
                    >
                      <span className={cn('flex min-w-0', collapsed ? 'items-center justify-center' : 'items-start gap-3')}>
                        <span className={cn(
                          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-[0.78rem] font-semibold',
                          active ? 'bg-white/14 text-white' : 'bg-primary/8 text-primary'
                        )}>
                          {c.name.charAt(0).toUpperCase()}
                        </span>
                        {!collapsed ? (
                          <span className="line-clamp-2 min-w-0 max-w-[138px] text-[0.78rem] leading-4">
                            {c.name}
                          </span>
                        ) : null}
                      </span>
                      {!collapsed && active ? <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : null}
                    </Link>
                  </motion.div>
                )
              })}
            </NavGroup>
          )}

          <NavGroup label="Governance" collapsed={collapsed}>
            {governanceItems.map(item => (
              <NavItem
                key={item.href}
                {...item}
                collapsed={collapsed}
                active={pathname.startsWith(item.href)}
              />
            ))}
          </NavGroup>
        </nav>

        <div className="mt-4 space-y-2 border-t border-border/60 pt-3">
          {profile.role === 'admin' && (
            <Link
              href="/admin"
              title="Admin control room"
              className={cn(
                'flex items-center border px-2 py-2 text-[0.82rem] transition-colors',
                collapsed ? 'justify-center rounded-[12px]' : 'justify-between rounded-[13px]',
                pathname.startsWith('/admin')
                  ? 'border-primary/20 bg-primary/10 text-primary'
                  : 'border-border/70 bg-secondary/40 text-muted-foreground hover:bg-secondary hover:text-foreground'
              )}
            >
              <span className={cn('flex items-center', collapsed ? 'justify-center' : 'gap-3')}>
                <ShieldCheck className="h-4 w-4" />
                {!collapsed ? 'Admin control room' : null}
              </span>
              {!collapsed ? <ArrowUpRight className="h-4 w-4" /> : null}
            </Link>
          )}
          <SidebarUserCard profile={profile} collapsed={collapsed} />
        </div>
      </div>
    </aside>
  )
}
