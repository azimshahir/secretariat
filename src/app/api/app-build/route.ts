import { NextResponse } from 'next/server'
import { getActiveBuildId } from '@/lib/app-build'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
}

export async function GET() {
  return NextResponse.json(
    { buildId: getActiveBuildId() },
    { headers: NO_STORE_HEADERS },
  )
}
