import { createClient } from '@supabase/supabase-js'

let lastErrors: Array<{ time: string; method: string; path: string; digest: string; message: string }> = []

export async function onRequestError(
  error: { digest: string; message: string },
  request: { path: string; method: string; headers: Record<string, string> },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  const entry = {
    time: new Date().toISOString(),
    method: request.method,
    path: request.path,
    digest: error.digest,
    message: error.message,
    routeType: context.routeType,
    routerKind: context.routerKind,
    routePath: context.routePath,
  }

  console.error('[onRequestError]', JSON.stringify(entry))

  lastErrors = [...lastErrors.slice(-19), entry as typeof lastErrors[number]]

  // Also try to write to Supabase
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (url && key) {
      const sb = createClient(url, key)
      await sb.from('audit_logs').insert({
        action: 'rsc_render_error',
        details: entry,
      }).then(() => {}, () => {}) // swallow errors
    }
  } catch {
    // ignore
  }
}

// Export errors for the debug route
export function getLastErrors() {
  return lastErrors
}
