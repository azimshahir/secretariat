export async function onRequestError(
  error: { digest: string; message: string },
  request: { path: string; method: string },
) {
  console.error(
    `[instrumentation] ${request.method} ${request.path} → digest=${error.digest} message=${error.message}`,
  )
}
