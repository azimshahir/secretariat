'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, MailPlus, Pencil, Users } from 'lucide-react'

import { postFormData } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { FormatSection } from './format-section'
import { GlossarySection } from './glossary-section'

interface Committee {
  id: string
  name: string
  slug: string
  persona_prompt: string | null
}

interface GlossaryItem {
  id: string
  acronym: string
  full_meaning: string
}

interface CommitteeMember {
  user_id: string
  full_name: string
  role: 'operator'
  created_at: string
}

interface CommitteeInvitation {
  email: string
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  created_at: string
  accepted_at: string | null
}

export function CommitteeSettingsCard({
  committee,
  templates,
  glossary,
  members,
  invitations,
  defaultTab,
}: {
  committee: Committee
  templates: Array<{ id: string }>
  glossary: GlossaryItem[]
  members: CommitteeMember[]
  invitations: CommitteeInvitation[]
  defaultTab?: string
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [isInviting, startInviting] = useTransition()

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      try {
        await saveCommittee(formData)
        toast.success('Secretariat updated')
        setEditing(false)
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to save')
      }
    })
  }

  function handleInvite(formData: FormData) {
    startInviting(async () => {
      try {
        await inviteSecretariatMember(formData)
        toast.success('Operator invited')
        router.refresh()
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to send invite'
        )
      }
    })
  }

  return (
    <Card id={`committee-${committee.id}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary">
            {committee.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <CardTitle className="text-lg">{committee.name}</CardTitle>
            <p className="text-xs text-muted-foreground">{committee.slug}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{templates.length} format variants</Badge>
          <Badge variant="secondary">{glossary.length} terms</Badge>
          <Badge variant="secondary">{members.length} operators</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={defaultTab ?? 'profile'}>
          <TabsList>
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="playbooks">Playbooks</TabsTrigger>
            <TabsTrigger value="glossary">Glossary</TabsTrigger>
            <TabsTrigger value="access">Access</TabsTrigger>
          </TabsList>
          <TabsContent value="profile" className="pt-4">
            {editing ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  handleSubmit(new FormData(event.currentTarget))
                }}
                className="space-y-3"
              >
                <input type="hidden" name="id" value={committee.id} />
                <Input
                  name="name"
                  defaultValue={committee.name}
                  placeholder="Committee name"
                  required
                />
                <Input
                  name="slug"
                  defaultValue={committee.slug}
                  placeholder="committee-slug"
                  required
                />
                <Textarea
                  name="personaPrompt"
                  defaultValue={committee.persona_prompt ?? ''}
                  className="min-h-24"
                  placeholder="System persona..."
                  required
                />
                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing(false)}
                    disabled={isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={isPending}
                    className="gap-1.5"
                  >
                    {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                    Save
                  </Button>
                </div>
              </form>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">System Persona</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {committee.persona_prompt || 'No persona configured yet.'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(true)}
                  className="shrink-0 gap-1 text-xs"
                >
                  <Pencil className="h-3 w-3" /> Edit
                </Button>
              </div>
            )}
          </TabsContent>
          <TabsContent value="playbooks" className="pt-4">
            <FormatSection committeeId={committee.id} />
          </TabsContent>
          <TabsContent value="glossary" className="pt-4">
            <GlossarySection committeeId={committee.id} glossary={glossary} />
          </TabsContent>
          <TabsContent value="access" className="pt-4">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-4">
                <div className="rounded-2xl border border-border/70 bg-secondary/25 p-4">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    <p className="text-sm font-medium">Current operators</p>
                  </div>
                  <div className="mt-3 space-y-2">
                    {members.length > 0 ? (
                      members.map(member => (
                        <div
                          key={member.user_id}
                          className="flex items-center justify-between rounded-xl border border-border/70 bg-white/80 px-3 py-2"
                        >
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {member.full_name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Operator access
                            </p>
                          </div>
                          <Badge variant="secondary">{member.role}</Badge>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No additional operators yet.
                      </p>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-border/70 bg-secondary/25 p-4">
                  <div className="flex items-center gap-2">
                    <MailPlus className="h-4 w-4 text-primary" />
                    <p className="text-sm font-medium">Invitations</p>
                  </div>
                  <div className="mt-3 space-y-2">
                    {invitations.length > 0 ? (
                      invitations.map(invitation => (
                        <div
                          key={`${invitation.email}-${invitation.created_at}`}
                          className="flex items-center justify-between rounded-xl border border-border/70 bg-white/80 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">
                              {invitation.email}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {invitation.accepted_at
                                ? 'Accepted'
                                : 'Awaiting acceptance'}
                            </p>
                          </div>
                          <Badge variant="secondary">{invitation.status}</Badge>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No invitations have been sent yet.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border/70 bg-white/85 p-4">
                <p className="text-sm font-medium text-foreground">
                  Invite a secretariat operator
                </p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  The invited user will only gain operator access to this
                  secretariat and its meetings.
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    handleInvite(new FormData(event.currentTarget))
                  }}
                  className="mt-4 space-y-3"
                >
                  <input type="hidden" name="committeeId" value={committee.id} />
                  <Input
                    name="email"
                    type="email"
                    placeholder="operator@company.com"
                    required
                  />
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isInviting}
                  >
                    {isInviting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Send invite
                  </Button>
                </form>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

async function saveCommittee(formData: FormData) {
  await postFormData<{ ok: true }>('/api/settings/committee', formData)
}

async function inviteSecretariatMember(formData: FormData) {
  await postFormData<{ ok: true }>('/api/settings/invite', formData)
}
