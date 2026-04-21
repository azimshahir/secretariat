import { NextResponse } from 'next/server'
import { assertFileSize } from '@/actions/file-upload/validation'
import {
  NO_PDF_MARKER,
  USE_HEADER_PDF_MARKER,
  hasRealAgendaPdf,
  isAgendaHeadingNo,
  isExplicitNoAgendaPdf,
  usesHeaderAgendaPdf,
} from '@/lib/agenda-pdf'
import { uuidSchema } from '@/lib/validation'
import {
  assertMeetingAgendaEditable,
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const formData = await request.formData()
    const agendaIdValue = formData.get('agendaId')
    const mode = String(formData.get('mode') ?? 'upload').trim().toLowerCase()
    const file = formData.get('file')
    const agendaId = typeof agendaIdValue === 'string' && agendaIdValue.trim().length > 0
      ? uuidSchema.parse(agendaIdValue)
      : null

    const context = await requireWritableMeetingContext(meetingId)

    if (mode === 'apply_header_pdf') {
      const headerAgendaIdRaw = formData.get('headerAgendaId')
      const agendaIdsRaw = formData.get('agendaIds')
      const headerAgendaId = typeof headerAgendaIdRaw === 'string' && headerAgendaIdRaw.trim().length > 0
        ? uuidSchema.parse(headerAgendaIdRaw.trim())
        : null

      if (!headerAgendaId) {
        throw new Error('headerAgendaId is required')
      }

      let requestedIds: string[] = []
      if (typeof agendaIdsRaw === 'string' && agendaIdsRaw.trim().length > 0) {
        try {
          const parsed = JSON.parse(agendaIdsRaw) as unknown
          if (!Array.isArray(parsed)) {
            throw new Error('agendaIds must be a JSON array')
          }
          requestedIds = [...new Set(
            parsed
              .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
              .map(value => uuidSchema.parse(value.trim())),
          )]
        } catch {
          throw new Error('Invalid agendaIds JSON')
        }
      }

      const { data: orderedRows, error: listError } = await context.adminSupabase
        .from('agendas')
        .select('id, agenda_no, sort_order, slide_pages, content_revision')
        .eq('meeting_id', meetingId)
        .order('sort_order', { ascending: true })

      if (listError) {
        throw new Error(listError.message)
      }
      if (!orderedRows?.length) {
        throw new Error('No agenda rows for this meeting')
      }

      const headerIndex = orderedRows.findIndex(row => row.id === headerAgendaId)
      if (headerIndex < 0) {
        throw new Error('Header agenda row not found')
      }

      const headerRow = orderedRows[headerIndex]
      if (!headerRow || !isAgendaHeadingNo(headerRow.agenda_no ?? '')) {
        throw new Error('Selected row is not an agenda heading')
      }
      if (!hasRealAgendaPdf(headerRow.slide_pages)) {
        throw new Error('Heading has no PDF to apply')
      }

      const sectionChildIds: string[] = []
      for (let index = headerIndex + 1; index < orderedRows.length; index += 1) {
        const row = orderedRows[index]
        if (!row?.id) continue
        if (isAgendaHeadingNo(row.agenda_no ?? '')) break
        sectionChildIds.push(row.id)
      }

      const sectionChildSet = new Set(sectionChildIds)
      const validRequested = requestedIds.filter(idValue => sectionChildSet.has(idValue))

      const updatedAgendaIds: string[] = []
      for (const targetId of validRequested) {
        const row = orderedRows.find(r => r.id === targetId)
        if (!row) continue
        const slide = row.slide_pages
        const trimmed = (slide ?? '').trim()
        if (usesHeaderAgendaPdf(slide)) continue
        if (hasRealAgendaPdf(slide)) continue
        if (trimmed.length > 0 && !isExplicitNoAgendaPdf(slide)) continue

        const nextRevision = row.content_revision + 1

        const { error: updateError } = await context.adminSupabase
          .from('agendas')
          .update({
            slide_pages: USE_HEADER_PDF_MARKER,
            content_revision: nextRevision,
          })
          .eq('id', targetId)
          .eq('meeting_id', meetingId)

        if (updateError) {
          throw new Error(updateError.message)
        }
        updatedAgendaIds.push(targetId)
      }

      return NextResponse.json({
        ok: true,
        updatedAgendaIds,
      })
    }

    if (agendaId) {
      const { data: agenda, error: agendaError } = await context.adminSupabase
        .from('agendas')
        .select('id, slide_pages, content_revision')
        .eq('id', agendaId)
        .eq('meeting_id', meetingId)
        .maybeSingle()

      if (agendaError) {
        throw new Error(agendaError.message)
      }
      if (!agenda) {
        throw new Error('Agenda row not found')
      }

      if (mode === 'no_pdf') {
        const nextRevision = agenda.slide_pages === NO_PDF_MARKER
          ? agenda.content_revision
          : agenda.content_revision + 1

        const { error: updateError } = await context.adminSupabase
          .from('agendas')
          .update({
            slide_pages: NO_PDF_MARKER,
            content_revision: nextRevision,
          })
          .eq('id', agendaId)

        if (updateError) {
          throw new Error(updateError.message)
        }

        return NextResponse.json({
          ok: true,
          path: NO_PDF_MARKER,
          mediaId: null,
          signedUrl: null,
        })
      }
    } else {
      await assertMeetingAgendaEditable(context.adminSupabase, meetingId)
    }

    if (!(file instanceof File)) {
      throw new Error('PDF file is required')
    }

    assertFileSize(file)
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) {
      throw new Error('Only PDF files are supported')
    }

    const ext = file.name.split('.').pop() ?? 'pdf'
    const path = `${meetingId}/slides_pdf/${Date.now()}.${ext}`

    const { error: uploadError } = await context.adminSupabase.storage
      .from('meeting-files')
      .upload(path, file)
    if (uploadError) {
      throw new Error(uploadError.message)
    }

    const { data: media, error: mediaError } = await context.adminSupabase
      .from('media_files')
      .insert({
        meeting_id: meetingId,
        file_type: 'slides_pdf',
        storage_path: path,
        original_name: file.name,
        size_bytes: file.size,
      })
      .select('id')
      .single()
    if (mediaError || !media) {
      throw new Error(mediaError?.message ?? 'Failed to save uploaded PDF metadata')
    }

    const { data: signedUrlData, error: signedUrlError } = await context.adminSupabase.storage
      .from('meeting-files')
      .createSignedUrl(path, 3600)
    if (signedUrlError || !signedUrlData?.signedUrl) {
      throw new Error(signedUrlError?.message ?? 'Failed to generate PDF preview link')
    }

    if (agendaId) {
      const { data: currentAgenda, error: currentAgendaError } = await context.adminSupabase
        .from('agendas')
        .select('slide_pages, content_revision')
        .eq('id', agendaId)
        .eq('meeting_id', meetingId)
        .maybeSingle()

      if (currentAgendaError) {
        throw new Error(currentAgendaError.message)
      }
      if (!currentAgenda) {
        throw new Error('Agenda row not found')
      }

      const nextRevision = currentAgenda.slide_pages === path
        ? currentAgenda.content_revision
        : currentAgenda.content_revision + 1

      const { error: updateAgendaError } = await context.adminSupabase
        .from('agendas')
        .update({
          slide_pages: path,
          content_revision: nextRevision,
        })
        .eq('id', agendaId)

      if (updateAgendaError) {
        throw new Error(updateAgendaError.message)
      }
    }

    return NextResponse.json({
      ok: true,
      path,
      mediaId: media.id,
      signedUrl: signedUrlData.signedUrl,
    })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to upload agenda PDF')
    console.error('[api/meeting/[id]/agenda-pdf] failed:', message)
    return NextResponse.json({ ok: false, message }, { status })
  }
}
