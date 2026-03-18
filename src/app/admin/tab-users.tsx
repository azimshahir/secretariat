'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { updateUserRole, updateUserPlan } from './user-actions'

interface OrgUser {
  id: string
  full_name: string
  email: string
  role: string
  plan: string
  created_at: string
}

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-100 text-red-700',
  cosec: 'bg-blue-100 text-blue-700',
  viewer: 'bg-zinc-100 text-zinc-700',
  auditor: 'bg-amber-100 text-amber-700',
}

const PLAN_COLORS: Record<string, string> = {
  free: 'bg-zinc-100 text-zinc-700',
  pro: 'bg-blue-100 text-blue-700',
  max: 'bg-purple-100 text-purple-700',
}

function UserRow({ user, currentUserId }: { user: OrgUser; currentUserId: string }) {
  const [pending, startTransition] = useTransition()
  const isSelf = user.id === currentUserId

  function handleRoleChange(newRole: string) {
    startTransition(async () => {
      try {
        await updateUserRole(user.id, newRole)
        toast.success(`${user.full_name} is now ${newRole}`)
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
    })
  }

  function handlePlanChange(newPlan: string) {
    startTransition(async () => {
      try {
        await updateUserPlan(user.id, newPlan)
        toast.success(`${user.full_name} upgraded to ${newPlan}`)
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
    })
  }

  return (
    <tr className="border-b border-border/50 last:border-b-0">
      <td className="py-3 pr-4">
        <p className="text-sm font-medium">{user.full_name}</p>
        <p className="text-xs text-muted-foreground">{user.email}</p>
      </td>
      <td className="py-3 pr-4">
        {isSelf ? (
          <Badge className={ROLE_COLORS[user.role] ?? ''}>{user.role}</Badge>
        ) : (
          <select
            value={user.role}
            onChange={e => handleRoleChange(e.target.value)}
            disabled={pending}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value="admin">admin</option>
            <option value="cosec">cosec</option>
            <option value="viewer">viewer</option>
            <option value="auditor">auditor</option>
          </select>
        )}
      </td>
      <td className="py-3 pr-4">
        <select
          value={user.plan}
          onChange={e => handlePlanChange(e.target.value)}
          disabled={pending}
          className="h-8 rounded-md border border-border bg-background px-2 text-xs"
        >
          <option value="free">Free</option>
          <option value="pro">Pro</option>
          <option value="max">Max</option>
        </select>
      </td>
      <td className="py-3 text-xs text-muted-foreground">
        {new Date(user.created_at).toLocaleDateString('en-MY')}
      </td>
    </tr>
  )
}

export function TabUsers({ users, currentUserId }: { users: OrgUser[]; currentUserId: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Organization Users</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left text-[0.72rem] uppercase tracking-[0.22em] text-muted-foreground">
              <th className="py-3 pr-4">User</th>
              <th className="py-3 pr-4">Role</th>
              <th className="py-3 pr-4">Plan</th>
              <th className="py-3">Joined</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <UserRow key={u.id} user={u} currentUserId={currentUserId} />
            ))}
          </tbody>
        </table>
        {users.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No users found.</p>
        )}
      </CardContent>
    </Card>
  )
}
