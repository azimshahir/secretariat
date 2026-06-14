'use client'

import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/lib/supabase/types'
import { SUBSCRIPTION_PLANS } from '@/lib/subscription/catalog'
import { cn } from '@/lib/utils'

interface SidebarUserCardProps {
  profile: Profile
  collapsed: boolean
}

export function SidebarUserCard({ profile, collapsed }: SidebarUserCardProps) {
  const router = useRouter()
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div
      className={cn(
        'border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(246,251,250,0.94))]',
        collapsed ? 'rounded-[14px] p-2' : 'rounded-[16px] p-2.5'
      )}
    >
      <div
        className={cn(
          'flex',
          collapsed ? 'flex-col items-center gap-2' : 'items-center gap-3'
        )}
      >
        <div className="flex h-8.5 w-8.5 items-center justify-center rounded-[10px] bg-primary/12 text-[0.82rem] font-semibold text-primary">
          {profile.full_name.charAt(0).toUpperCase()}
        </div>
        {!collapsed ? (
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.82rem] font-medium text-foreground">
              {profile.full_name}
            </p>
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                {profile.role}
              </span>
              <span
                className={cn(
                  'shrink-0 rounded-full px-1.5 py-0.5 text-[0.55rem] font-semibold uppercase tracking-wide',
                  profile.plan === 'free'
                    ? 'bg-muted text-muted-foreground'
                    : 'bg-primary/12 text-primary'
                )}
              >
                {SUBSCRIPTION_PLANS[profile.plan]?.label ?? 'Free'}
              </span>
            </div>
          </div>
        ) : null}
        <button
          onClick={handleSignOut}
          className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-border/70 text-muted-foreground transition-colors hover:border-destructive/20 hover:bg-destructive/10 hover:text-destructive"
          title="Sign out"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
