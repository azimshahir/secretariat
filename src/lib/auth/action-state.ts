export type AuthActionStatus = 'idle' | 'success' | 'error'

export interface AuthActionState {
  status: AuthActionStatus
  code?: string
  message?: string
  redirectTo?: string
}

export const AUTH_ACTION_IDLE_STATE: AuthActionState = { status: 'idle' }
