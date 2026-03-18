'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { AUTH_ACTION_IDLE_STATE, type AuthActionState } from '@/lib/auth/action-state'
import { createClient } from '@/lib/supabase/server'
import { ensureUserProvisioned } from '@/lib/auth/provision'
import { loginSchema, signupSchema } from '@/lib/validation'

function mapAuthError(message: string): AuthActionState {
  const normalized = message.toLowerCase()
  if (normalized.includes('invalid email')) {
    return { status: 'error', code: 'invalid_email', message: 'Please use a valid email address.' }
  }
  if (normalized.includes('already registered') || normalized.includes('already exists')) {
    return { status: 'error', code: 'email_exists', message: 'Email already exists. Please sign in instead.' }
  }
  if (normalized.includes('invalid login credentials')) {
    return { status: 'error', code: 'invalid_credentials', message: 'Invalid email or password.' }
  }
  if (normalized.includes('email not confirmed')) {
    return { status: 'error', code: 'email_not_confirmed', message: 'Email not confirmed yet. Please verify your email.' }
  }
  if (normalized.includes('rate limit')) {
    return { status: 'error', code: 'rate_limited', message: 'Too many attempts. Please try again shortly.' }
  }
  return { status: 'error', code: 'auth_error', message: message || 'Authentication failed. Please try again.' }
}

function mapProvisionFailure(result: Awaited<ReturnType<typeof ensureUserProvisioned>>): AuthActionState {
  if (result.status === 'fatal_error') {
    return {
      status: 'error',
      code: result.code,
      message: 'Authentication service is not fully configured. Contact administrator.',
    }
  }
  if (result.status === 'recoverable_error') {
    return { status: 'error', code: result.code, message: result.message }
  }
  return { status: 'error', code: 'profile_setup_failed', message: 'Profile setup failed. Please try again.' }
}

export async function loginAction(
  prevState: AuthActionState = AUTH_ACTION_IDLE_STATE,
  formData: FormData
): Promise<AuthActionState> {
  void prevState
  const supabase = await createClient()
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return {
      status: 'error',
      code: 'validation',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    }
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (error) {
    return mapAuthError(error.message)
  }

  const provisionResult = await ensureUserProvisioned(data.user)
  if (provisionResult.status !== 'ok') {
    return mapProvisionFailure(provisionResult)
  }

  revalidatePath('/', 'layout')
  return {
    status: 'success',
    code: 'login_success',
    message: 'Signed in successfully. Redirecting...',
    redirectTo: '/',
  }
}

export async function signupAction(
  prevState: AuthActionState = AUTH_ACTION_IDLE_STATE,
  formData: FormData
): Promise<AuthActionState> {
  void prevState
  const supabase = await createClient()
  const parsed = signupSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return {
      status: 'error',
      code: 'validation',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    }
  }

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.fullName } },
  })

  if (error) {
    return mapAuthError(error.message)
  }

  // No session = email confirmation required
  if (!data.session) {
    // Detect fake signup (user already exists, Supabase hides it)
    if (data.user && (!data.user.identities || data.user.identities.length === 0)) {
      return { status: 'error', code: 'email_exists', message: 'An account with this email already exists. Please sign in.' }
    }
    return {
      status: 'success',
      code: 'email_confirmation_required',
      message: 'Account created! Check your email inbox for the confirmation link, then sign in.',
    }
  }

  const provisionResult = await ensureUserProvisioned(data.user)
  if (provisionResult.status !== 'ok') {
    return mapProvisionFailure(provisionResult)
  }

  revalidatePath('/', 'layout')
  return {
    status: 'success',
    code: 'signup_success',
    message: 'Account created. Redirecting...',
    redirectTo: '/',
  }
}

export async function signout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
