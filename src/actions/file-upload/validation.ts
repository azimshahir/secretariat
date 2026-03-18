const MAX_FILE_MB = 120

export function assertFileSize(file: File) {
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    throw new Error(`File too large. Max ${MAX_FILE_MB}MB`)
  }
}
