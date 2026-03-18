'use client'

import { FormEvent, Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { motion, AnimatePresence } from 'framer-motion'
import { Mail, Lock, User, ArrowRight, Eye, EyeOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function mapAuthError(message: string) {
  const normalized = message.toLowerCase()
  if (normalized.includes('invalid email')) return 'Please use a valid email address.'
  if (normalized.includes('already registered')) return 'Email already exists. Please sign in instead.'
  if (normalized.includes('invalid login credentials')) return 'Invalid email or password.'
  if (normalized.includes('email not confirmed')) return 'Please verify your email before signing in.'
  return message || 'Authentication failed. Please try again.'
}

function LoginForm() {
  const router = useRouter()
  const supabase = createClient()
  const [isSignUp, setIsSignUp] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const searchParams = useSearchParams()
  const queryError = searchParams.get('error')
  const queryMessage = searchParams.get('message')

  async function handleGoogleLogin() {
    setPending(true)
    setError(null)
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (authError) {
      setError(authError.message)
      setPending(false)
    }
  }

  async function provisionProfile(accessToken?: string) {
    const response = await fetch('/api/auth/provision', {
      method: 'POST',
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    })
    if (response.ok) return true
    const payload = await response.json().catch(() => ({ message: 'Profile setup failed.' }))
    setError(payload.message ?? 'Profile setup failed. Please try again.')
    return false
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    setMessage(null)

    const formData = new FormData(event.currentTarget)
    const email = String(formData.get('email') ?? '').trim()
    const password = String(formData.get('password') ?? '')
    const fullName = String(formData.get('fullName') ?? '').trim()

    try {
      if (isSignUp) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName }, emailRedirectTo: `${window.location.origin}/auth/callback` },
        })
        if (signUpError) {
          setError(mapAuthError(signUpError.message))
          return
        }
        if (data.session) {
          const provisioned = await provisionProfile(data.session.access_token)
          if (!provisioned) return
          router.push('/')
          router.refresh()
          return
        }
        setMessage('Check your email to confirm your account.')
        return
      }

      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) {
        setError(mapAuthError(signInError.message))
        return
      }
      const provisioned = await provisionProfile(data.session?.access_token)
      if (!provisioned) return

      router.push('/')
      router.refresh()
    } catch {
      setError('Service unavailable. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="w-full max-w-[400px] space-y-8">
      <div className="flex flex-col items-center justify-center space-y-4 text-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          <Image src="/logo.png" alt="Secretariat Logo" width={400} height={100} className="h-28 w-auto mb-4" priority />
        </motion.div>
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {isSignUp ? 'Create your account' : 'Welcome back'}
          </h1>
          <p className="text-sm text-slate-500">
            {isSignUp ? 'Start automating your meetings today' : 'Sign in to manage your meetings'}
          </p>
        </div>
      </div>

      <motion.div
        layout
        className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50"
      >
        <div className="space-y-6">
          <Button
            variant="outline"
            className="w-full h-11 border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all font-medium"
            onClick={handleGoogleLogin}
            disabled={pending}
          >
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 12-4.53z"
                fill="#EA4335"
              />
            </svg>
            Continue with Google
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-slate-400">Or continue with</span>
            </div>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <AnimatePresence mode="wait">
              {isSignUp && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="space-y-2 overflow-hidden"
                >
                  <div className="relative">
                    <User className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <Input
                      name="fullName"
                      placeholder="Full Name"
                      className="pl-10 h-11 bg-slate-50 border-transparent focus:bg-white transition-all"
                      required
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="space-y-2 text-left">
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input
                  name="email"
                  type="email"
                  placeholder="Email address"
                  className="pl-10 h-11 bg-slate-50 border-transparent focus:bg-white transition-all"
                  required
                />
              </div>
            </div>

            <div className="space-y-2 text-left">
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Password"
                  className="pl-10 pr-10 h-11 bg-slate-50 border-transparent focus:bg-white transition-all"
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {(error ?? queryError) && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-lg bg-red-50 p-3 text-xs font-medium text-red-600"
              >
                {error ?? queryError}
              </motion.div>
            )}

            {(message ?? queryMessage) && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-lg bg-emerald-50 p-3 text-xs font-medium text-emerald-600"
              >
                {message ?? queryMessage}
              </motion.div>
            )}

            <Button
              className="w-full h-11 bg-emerald-700 hover:bg-emerald-800 text-white font-medium transition-all shadow-lg shadow-emerald-700/20"
              disabled={pending}
              type="submit"
            >
              {pending ? 'Processing...' : (isSignUp ? 'Create account' : 'Sign in')}
              {!pending && <ArrowRight className="ml-2 h-4 w-4" />}
            </Button>
          </form>

          <p className="text-center text-sm text-slate-500">
            {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              disabled={pending}
              onClick={() => { setIsSignUp(!isSignUp); setError(null); setMessage(null) }}
              className="font-semibold text-emerald-700 hover:text-emerald-800 transition-colors"
            >
              {isSignUp ? 'Sign in' : 'Sign up for free'}
            </button>
          </p>
        </div>
      </motion.div>

      <span className="text-center text-xs text-slate-400 flex items-center justify-center gap-1">
        Secure authentication by <span className="font-bold flex items-center gap-1 opacity-60">
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 12l10 10 10-10L12 2z" /></svg>
          Supabase
        </span>
      </span>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen relative overflow-hidden bg-slate-50">
      {/* Decorative background elements */}
      <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/2 w-96 h-96 bg-emerald-100 rounded-full blur-3xl opacity-50" />
      <div className="absolute bottom-0 left-0 translate-y-1/2 -translate-x-1/2 w-96 h-96 bg-emerald-50 rounded-full blur-3xl opacity-50" />

      <div className="relative z-10 flex w-full items-center justify-center px-4 py-12">
        <Suspense fallback={<div className="text-slate-500 animate-pulse font-medium">Loading session...</div>}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}

