import { NextResponse } from 'next/server'
import {
  listCommitteeRagDocuments,
  uploadCommitteeRagDocument,
  deleteCommitteeRagDocument,
} from '@/app/meeting/[id]/setup/rag-actions'
import { serializeAdminApiError } from '../_lib/write-access'

export async function GET(request: Request) {
  try {
    const committeeId = new URL(request.url).searchParams.get('committeeId')?.trim() ?? ''

    if (!committeeId) {
      return NextResponse.json(
        { ok: false, message: 'Committee id is required' },
        { status: 400 },
      )
    }

    const documents = await listCommitteeRagDocuments(committeeId)
    return NextResponse.json({ ok: true, documents })
  } catch (error) {
    const { status, message, code } = serializeAdminApiError(
      error,
      'Failed to load committee RAG documents',
    )
    return NextResponse.json({ ok: false, message, code }, { status })
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const committeeId = String(formData.get('committeeId') ?? '').trim()
    const category = String(formData.get('category') ?? '').trim() || 'General'
    const documentName = String(formData.get('documentName') ?? '').trim()
    const file = formData.get('file')

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { ok: false, message: 'Select a PDF or DOCX file' },
        { status: 400 },
      )
    }

    const document = await uploadCommitteeRagDocument(
      committeeId,
      category,
      documentName || file.name,
      file,
    )

    return NextResponse.json({
      ok: true,
      document,
    })
  } catch (error) {
    const { status, message, code } = serializeAdminApiError(
      error,
      'Failed to upload committee RAG document',
    )
    return NextResponse.json({ ok: false, message, code }, { status })
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as { documentId?: string }
    const documentId = String(body.documentId ?? '').trim()

    if (!documentId) {
      return NextResponse.json(
        { ok: false, message: 'Document id is required' },
        { status: 400 },
      )
    }

    await deleteCommitteeRagDocument(documentId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const { status, message, code } = serializeAdminApiError(
      error,
      'Failed to delete committee RAG document',
    )
    return NextResponse.json({ ok: false, message, code }, { status })
  }
}
