'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Pencil, Loader2, X, Check } from 'lucide-react'
import { postFormData } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function EditableRow({
  label,
  value,
  children,
}: {
  label: string
  value: string
  children: (opts: { close: () => void }) => React.ReactNode
}) {
  const [editing, setEditing] = useState(false)
  if (editing) return <div className="space-y-2 py-3">{children({ close: () => setEditing(false) })}</div>
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
      <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="gap-1 text-xs">
        <Pencil className="h-3 w-3" /> Edit
      </Button>
    </div>
  )
}

export function AccountSection({ fullName, email }: { fullName: string; email: string }) {
  const [namePending, startNameTransition] = useTransition()
  const [emailPending, startEmailTransition] = useTransition()
  const [pwPending, startPwTransition] = useTransition()
  const [showPwForm, setShowPwForm] = useState(false)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account & Security</CardTitle>
      </CardHeader>
      <CardContent className="divide-y">
        <EditableRow label="Display Name" value={fullName}>
          {({ close }) => (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                const fd = new FormData(event.currentTarget)
                startNameTransition(async () => {
                try { await updateProfile(fd); toast.success('Name updated'); close() }
                catch (error) { toast.error(error instanceof Error ? error.message : 'Failed to update name') }
              })}}
              className="flex items-end gap-2"
            >
              <div className="flex-1 space-y-1">
                <Label htmlFor="fullName">Display Name</Label>
                <Input id="fullName" name="fullName" defaultValue={fullName} required minLength={2} />
              </div>
              <Button type="submit" size="sm" disabled={namePending} className="gap-1">
                {namePending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={close} disabled={namePending}>
                <X className="h-3 w-3" />
              </Button>
            </form>
          )}
        </EditableRow>

        <EditableRow label="Email" value={email}>
          {({ close }) => (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                const fd = new FormData(event.currentTarget)
                startEmailTransition(async () => {
                try { await updateEmail(fd); toast.success('Confirmation email sent — check your inbox'); close() }
                catch (error) { toast.error(error instanceof Error ? error.message : 'Failed to update email') }
              })}}
              className="flex items-end gap-2"
            >
              <div className="flex-1 space-y-1">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" defaultValue={email} required />
              </div>
              <Button type="submit" size="sm" disabled={emailPending} className="gap-1">
                {emailPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={close} disabled={emailPending}>
                <X className="h-3 w-3" />
              </Button>
            </form>
          )}
        </EditableRow>

        {showPwForm ? (
          <div className="space-y-2 py-3">
            <form
              onSubmit={(event) => {
                event.preventDefault()
                const fd = new FormData(event.currentTarget)
                startPwTransition(async () => {
                try { await updatePassword(fd); toast.success('Password updated'); setShowPwForm(false) }
                catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to update password') }
              })}}
              className="space-y-2"
            >
              <div className="space-y-1">
                <Label htmlFor="password">New Password</Label>
                <Input id="password" name="password" type="password" required minLength={6} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input id="confirmPassword" name="confirmPassword" type="password" required minLength={6} />
              </div>
              <div className="flex items-center gap-2 justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowPwForm(false)} disabled={pwPending}>Cancel</Button>
                <Button type="submit" size="sm" disabled={pwPending} className="gap-1">
                  {pwPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Update Password
                </Button>
              </div>
            </form>
          </div>
        ) : (
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-xs text-muted-foreground">Password</p>
              <p className="text-sm font-medium">••••••••</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowPwForm(true)} className="gap-1 text-xs">
              <Pencil className="h-3 w-3" /> Change
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

async function updateProfile(formData: FormData) {
  await postFormData<{ ok: true }>('/api/settings/profile', formData)
}

async function updateEmail(formData: FormData) {
  await postFormData<{ ok: true }>('/api/settings/email', formData)
}

async function updatePassword(formData: FormData) {
  await postFormData<{ ok: true }>('/api/settings/password', formData)
}
