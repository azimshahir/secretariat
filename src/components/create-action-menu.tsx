'use client'

import Link from 'next/link'
import { ChevronDown, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface CreateActionMenuProps {
  meetingHref: string
  canCreateMeeting: boolean
  className?: string
  label?: string
  variant?: 'default' | 'outline'
  size?: 'default' | 'sm' | 'lg' | 'icon'
}

export function CreateActionMenu({
  meetingHref,
  canCreateMeeting,
  className,
  label = 'New Secretariat',
  variant = 'default',
  size = 'sm',
}: CreateActionMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size={size}
          variant={variant}
          className={cn('gap-2', className)}
        >
          <Plus className="h-3.5 w-3.5" />
          {label}
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-[14px] p-1.5">
        <DropdownMenuLabel className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Create
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/secretariat/new">
            <Plus className="h-3.5 w-3.5" />
            New Secretariat
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          asChild={canCreateMeeting}
          disabled={!canCreateMeeting}
        >
          {canCreateMeeting ? (
            <Link href={meetingHref}>
              <Plus className="h-3.5 w-3.5" />
              New Meeting
            </Link>
          ) : (
            <span>
              <Plus className="h-3.5 w-3.5" />
              New Meeting
            </span>
          )}
        </DropdownMenuItem>
        {!canCreateMeeting ? (
          <>
            <DropdownMenuSeparator />
            <p className="px-2 py-1 text-[11px] leading-5 text-muted-foreground">
              Create or join a secretariat first before opening a new meeting.
            </p>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
