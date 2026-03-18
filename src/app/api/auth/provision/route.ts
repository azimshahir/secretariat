import { NextResponse } from 'next/server'
import { ensureUserProvisioned } from '@/lib/auth/provision'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

async function resolveUserFromToken(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.toLowerCase().startsWith('bearer ')) return null
  const token = authHeader.slice(7).trim()
  if (!token) return null

  const admin = createAdminClient()
  const { data, error } = await admin.auth.getUser(token)
  if (error) return null
  return data.user
}

export async function POST(request: Request) {
  const tokenUser = await resolveUserFromToken(request)
  const supabase = await createClient()
  const { data: { user: cookieUser } } = await supabase.auth.getUser()
  const user = tokenUser ?? cookieUser
  if (!user) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 })
  }

  const result = await ensureUserProvisioned(user)
  if (result.status !== 'ok') {
    return NextResponse.json({ ok: false, message: result.message, code: result.code }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
