import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const errors: string[] = []
  const steps: string[] = []

  try {
    steps.push('1. Creating supabase client')
    const supabase = await createClient()

    steps.push('2. Getting user')
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError) errors.push(`auth.getUser error: ${userError.message}`)
    if (!user) {
      return NextResponse.json({ steps, errors, result: 'no user - auth required' })
    }
    steps.push(`2b. User: ${user.id}`)

    steps.push('3. Getting profile')
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, organization_id, role')
      .eq('id', user.id)
      .single()
    if (profileError) errors.push(`profile error: ${profileError.message} (code: ${profileError.code})`)

    steps.push('4. Getting committees')
    const { data: committees, error: committeesError } = await supabase
      .from('committees')
      .select('id, name')
      .limit(5)
    if (committeesError) errors.push(`committees error: ${committeesError.message} (code: ${committeesError.code})`)

    steps.push('5. Testing committee_generation_settings')
    const { data: cgs, error: cgsError } = await supabase
      .from('committee_generation_settings')
      .select('committee_id')
      .limit(1)
    if (cgsError) errors.push(`committee_generation_settings: ${cgsError.message} (code: ${cgsError.code})`)
    else steps.push(`5b. committee_generation_settings OK (${cgs?.length ?? 0} rows)`)

    steps.push('6. Testing committee_rag_documents')
    const { data: ragDocs, error: ragError } = await supabase
      .from('committee_rag_documents')
      .select('id')
      .limit(1)
    if (ragError) errors.push(`committee_rag_documents: ${ragError.message} (code: ${ragError.code})`)
    else steps.push(`6b. committee_rag_documents OK (${ragDocs?.length ?? 0} rows)`)

    steps.push('7. Testing committee_rag_chunks')
    const { data: ragChunks, error: chunksError } = await supabase
      .from('committee_rag_chunks')
      .select('id')
      .limit(1)
    if (chunksError) errors.push(`committee_rag_chunks: ${chunksError.message} (code: ${chunksError.code})`)
    else steps.push(`7b. committee_rag_chunks OK (${ragChunks?.length ?? 0} rows)`)

    steps.push('8. Testing meetings')
    const { data: meetings, error: meetingsError } = await supabase
      .from('meetings')
      .select('id, committee_id, status')
      .limit(1)
    if (meetingsError) errors.push(`meetings: ${meetingsError.message} (code: ${meetingsError.code})`)
    else steps.push(`8b. meetings OK (${meetings?.length ?? 0} rows)`)

    steps.push('9. Testing organization_ai_settings')
    const { data: aiSettings, error: aiError } = await supabase
      .from('organization_ai_settings')
      .select('id')
      .limit(1)
    if (aiError) errors.push(`organization_ai_settings: ${aiError.message} (code: ${aiError.code})`)
    else steps.push(`9b. organization_ai_settings OK (${aiSettings?.length ?? 0} rows)`)

    steps.push('10. Import test - timecode')
    const { formatSecondsToTimecode } = await import('@/lib/timecode')
    steps.push(`10b. formatSecondsToTimecode(90) = ${formatSecondsToTimecode(90)}`)

    steps.push('11. Import test - meeting-pack-model')
    const { normalizeMeetingPackConfig } = await import('@/app/meeting/[id]/setup/meeting-pack-model')
    const testConfig = normalizeMeetingPackConfig(null, [])
    steps.push(`11b. normalizeMeetingPackConfig OK: ${JSON.stringify(testConfig).slice(0, 100)}`)

    return NextResponse.json({ steps, errors, result: errors.length === 0 ? 'ALL OK' : 'ERRORS FOUND' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    return NextResponse.json({ steps, errors, crash: { message, stack } }, { status: 500 })
  }
}
