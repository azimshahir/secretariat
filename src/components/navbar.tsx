'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  CalendarRange,
  LogOut,
  PanelLeft,
  Pin,
  Search,
  Settings,
  Shield,
  ShieldCheck,
} from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { CreateActionMenu } from '@/components/create-action-menu'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import type { DashboardScope } from '@/lib/secretariat-access'
import type { Committee, Profile } from '@/lib/supabase/types'
import { cn } from '@/lib/utils'

interface NavbarProps {
  profile: Profile
  committees: Committee[]
  activeCommitteeId?: string
  sidebarPinned?: boolean
  onToggleSidebarPinned?: () => void
  dashboardScope?: DashboardScope
  canViewOrgScope?: boolean
}

export function Navbar({
  profile,
  committees,
  activeCommitteeId,
  sidebarPinned = false,
  onToggleSidebarPinned,
  dashboardScope,
  canViewOrgScope = false,
}: NavbarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()
  const newMeetingHref = activeCommitteeId
    ? `/meeting/new?committee=${activeCommitteeId}`
    : '/meeting/new'
  const canCreateMeeting = committees.length > 0
  const today = new Date().toLocaleDateString('en-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <header className="sticky top-0 z-20 border-b border-white/70 bg-background/70 backdrop-blur-xl">
      <div className="flex h-[56px] items-center gap-2.5 px-2 md:px-3.5 xl:gap-3 xl:px-4">
        <Button
          type="button"
          variant={sidebarPinned ? 'default' : 'outline'}
          size="sm"
          onClick={onToggleSidebarPinned}
          aria-label={sidebarPinned ? 'Switch to auto sidebar' : 'Keep sidebar open'}
          aria-pressed={sidebarPinned}
          title={sidebarPinned ? 'Switch to auto sidebar' : 'Keep sidebar open'}
          className={cn(
            'h-8.5 rounded-[12px] px-2.5 text-[0.84rem] sm:px-3',
            !sidebarPinned && 'border-white/80 bg-white/94'
          )}
        >
          <PanelLeft className="h-3.5 w-3.5" />
          <Pin
            className={cn(
              'h-3 w-3',
              sidebarPinned ? 'fill-current text-current' : 'text-muted-foreground'
            )}
          />
          <span className="hidden xl:inline">
            {sidebarPinned ? 'Pinned nav' : 'Auto nav'}
          </span>
        </Button>

        <div className="relative hidden min-w-0 flex-1 lg:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search workspace"
            placeholder="Search meetings, agendas, minutes..."
            className="h-8.5 rounded-[12px] border-white/70 bg-white/92 pl-8.5 pr-3 text-[0.84rem] shadow-[0_18px_45px_-34px_rgba(15,23,42,0.42)]"
          />
        </div>

        <div className="hidden items-center gap-2 rounded-[12px] border border-white/70 bg-white/92 px-3 py-1.5 text-[0.84rem] text-muted-foreground shadow-[0_18px_40px_-34px_rgba(15,23,42,0.42)] xl:flex">
          <CalendarRange className="h-3.5 w-3.5 text-primary" />
          <span>{today}</span>
        </div>

        {canViewOrgScope && pathname === '/' ? (
          <Suspense fallback={null}>
            <ScopeToggle dashboardScope={dashboardScope} />
          </Suspense>
        ) : null}

        <CreateActionMenu
          meetingHref={newMeetingHref}
          canCreateMeeting={canCreateMeeting}
          className="h-8.5 rounded-[12px] px-3.5 text-[0.84rem]"
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8.5 rounded-[12px] px-2.5 text-[0.84rem] sm:px-3"
            >
              <div className="flex h-6.5 w-6.5 items-center justify-center rounded-[9px] bg-primary/12 text-[0.7rem] font-semibold text-primary">
                {profile.full_name.charAt(0).toUpperCase()}
              </div>
              <span className="hidden sm:inline">{profile.full_name}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {profile.role === 'admin' && (
              <DropdownMenuItem asChild>
                <Link href="/admin"><ShieldCheck className="mr-2 h-4 w-4" />Admin</Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link href="/settings"><Settings className="mr-2 h-4 w-4" />Settings</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/audit"><Shield className="mr-2 h-4 w-4" />Audit Trail</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" />Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

function ScopeToggle({ dashboardScope }: { dashboardScope?: DashboardScope }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function handleScopeChange(nextScope: DashboardScope) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('scope', nextScope)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="hidden items-center rounded-[12px] border border-white/70 bg-white/92 p-1 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.42)] lg:flex">
      <button
        type="button"
        onClick={() => handleScopeChange('my')}
        className={cn(
          'rounded-[10px] px-3 py-1.5 text-[0.8rem] transition-colors',
          dashboardScope === 'my'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        My Secretariats
      </button>
      <button
        type="button"
        onClick={() => handleScopeChange('org')}
        className={cn(
          'rounded-[10px] px-3 py-1.5 text-[0.8rem] transition-colors',
          dashboardScope === 'org'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        Organization
      </button>
    </div>
  )
}
