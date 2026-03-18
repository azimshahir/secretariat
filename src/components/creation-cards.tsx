'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CalendarRange, Sparkles } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { NormalMeetingDialog } from '@/components/normal-meeting-dialog'
import { AiSuggestDialog } from '@/components/ai-suggest-dialog'
import type { Committee } from '@/lib/supabase/types'

type DialogType = 'normal' | 'ai' | null

export function CreationCards({ committees }: { committees: Committee[] }) {
  const [open, setOpen] = useState<DialogType>(null)

  if (committees.length === 0) {
    return (
      <div className="flex flex-col items-center gap-8 px-6 py-16">
        <div className="space-y-2 text-center">
          <p className="text-xs uppercase tracking-[0.28em] text-primary/70">
            Get started
          </p>
          <h2 className="font-display text-3xl font-semibold tracking-[-0.05em] text-foreground">
            Create your first secretariat
          </h2>
          <p className="mx-auto max-w-lg text-sm leading-6 text-zinc-500">
            A secretariat is an AI-powered workspace for a specific committee.
            Set one up first, then you can create meetings under it.
          </p>
        </div>
        <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
          <Link href="/secretariat/new?first=1" className="flex">
            <Card className="flex flex-1 cursor-pointer transition duration-200 hover:-translate-y-1 hover:border-primary/30">
              <CardHeader>
                <CalendarRange className="mb-1 h-6 w-6 text-primary" />
                <CardTitle className="text-sm">Standard Secretariat</CardTitle>
                <CardDescription className="text-xs leading-6">
                  Choose from pre-built AI personas for Banking (ALCO, Board,
                  Audit, Risk), Construction, Oil & Gas, NGOs, and more.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
          <Link href="/secretariat/new?first=1" className="flex">
            <Card className="flex flex-1 cursor-pointer transition duration-200 hover:-translate-y-1 hover:border-primary/30">
              <CardHeader>
                <Sparkles className="mb-1 h-6 w-6 text-primary" />
                <CardTitle className="text-sm">Personalized Secretariat</CardTitle>
                <CardDescription className="text-xs leading-6">
                  Build a custom committee workspace from scratch — define your
                  own industry, meeting type, and AI persona.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-8 px-6 py-16">
      <div className="space-y-2 text-center">
        <p className="text-xs uppercase tracking-[0.28em] text-primary/70">
          Meeting setup
        </p>
        <h2 className="font-display text-3xl font-semibold tracking-[-0.05em] text-foreground">
          Launch a new meeting workflow
        </h2>
        <p className="text-sm text-zinc-500">
          Choose the secretariat, then create the meeting directly or let AI
          draft the initial agenda structure first.
        </p>
      </div>
      <div className="grid w-full max-w-xl gap-4 sm:grid-cols-2">
        <Card
          className="cursor-pointer transition duration-200 hover:-translate-y-1 hover:border-primary/30"
          onClick={() => setOpen('normal')}
        >
          <CardHeader>
            <CalendarRange className="mb-1 h-6 w-6 text-primary" />
            <CardTitle className="text-sm">New Meeting</CardTitle>
            <CardDescription className="text-xs leading-6">
              Create a meeting directly under the workspace you already manage.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card
          className="cursor-pointer transition duration-200 hover:-translate-y-1 hover:border-primary/30"
          onClick={() => setOpen('ai')}
        >
          <CardHeader>
            <Sparkles className="mb-1 h-6 w-6 text-primary" />
            <CardTitle className="text-sm">AI Suggestion</CardTitle>
            <CardDescription className="text-xs leading-6">
              Describe the meeting in plain language and let AI draft the first
              structure for you.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      <NormalMeetingDialog
        open={open === 'normal'}
        onOpenChange={v => !v && setOpen(null)}
        committees={committees}
      />
      <AiSuggestDialog
        open={open === 'ai'}
        onOpenChange={v => !v && setOpen(null)}
        committees={committees}
      />
    </div>
  )
}
