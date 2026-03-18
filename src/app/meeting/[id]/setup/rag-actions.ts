'use server'

import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import { createClient } from '@/lib/supabase/server'
import { uuidSchema } from '@/lib/validation'

const MAX_RAG_FILE_MB = 40

export interface CommitteeRagDocumentSummary {
  id: string
  category: string
  documentName: string
  fileName: string
  createdAt: string
}

function normalizeWhitespace(value: string) {
  return value
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function chunkText(input: string, maxChars = 1400) {
  const normalized = normalizeWhitespace(input)
  if (!normalized) return []

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(Boolean)

  const chunks: string[] = []
  let current = ''
  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph
      continue
    }
    if ((current.length + 2 + paragraph.length) <= maxChars) {
      current = `${current}\n\n${paragraph}`
      continue
    }
    chunks.push(current)
    current = paragraph
  }
  if (current) chunks.push(current)
  return chunks
}

async function requireCommitteeAccess(committeeId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()
  if (!profile) throw new Error('Profile not found')
  if (!['admin', 'cosec'].includes(profile.role)) {
    throw new Error('Only admin or secretariat can manage RAG documents')
  }

  const { data: committee, error } = await supabase
    .from('committees')
    .select('id')
    .eq('id', committeeId)
    .eq('organization_id', profile.organization_id)
    .single()
  if (error || !committee) throw new Error('Committee not found or inaccessible')

  return {
    supabase,
    userId: user.id,
    organizationId: profile.organization_id as string,
  }
}

const ACCEPTED_EXTENSIONS = ['.pdf', '.docx']
const ACCEPTED_MIME_TYPES = [
  'application/pdf', 'application/x-pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

function assertRagFile(file: File) {
  const lower = file.name.toLowerCase()
  const validExt = ACCEPTED_EXTENSIONS.some(ext => lower.endsWith(ext))
  const validMime = ACCEPTED_MIME_TYPES.includes(file.type)
  if (!validExt && !validMime) {
    throw new Error('Only PDF and DOCX files are supported for committee RAG')
  }
  if (file.size > MAX_RAG_FILE_MB * 1024 * 1024) {
    throw new Error(`RAG file too large. Max ${MAX_RAG_FILE_MB}MB`)
  }
}

function isDocx(file: File) {
  return file.name.toLowerCase().endsWith('.docx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_')
}

export async function listCommitteeRagDocuments(committeeId: string): Promise<CommitteeRagDocumentSummary[]> {
  const parsedCommitteeId = uuidSchema.parse(committeeId)
  const { supabase } = await requireCommitteeAccess(parsedCommitteeId)

  const { data, error } = await supabase
    .from('committee_rag_documents')
    .select('id, category, document_name, file_name, created_at')
    .eq('committee_id', parsedCommitteeId)
    .order('created_at', { ascending: false })

  if (error) {
    if (error.message?.includes('schema cache')) return []
    throw new Error(error.message)
  }

  return (data ?? []).map(row => ({
    id: row.id,
    category: row.category,
    documentName: row.document_name,
    fileName: row.file_name,
    createdAt: row.created_at,
  }))
}

export async function uploadCommitteeRagDocument(
  committeeId: string,
  category: string,
  documentName: string,
  file: File,
): Promise<CommitteeRagDocumentSummary> {
  const parsedCommitteeId = uuidSchema.parse(committeeId)
  const safeCategory = category.trim().slice(0, 80)
  const safeDocumentName = documentName.trim().slice(0, 160)
  if (!safeCategory) throw new Error('Category is required')
  if (!safeDocumentName) throw new Error('Document name is required')
  assertRagFile(file)

  const { supabase, userId } = await requireCommitteeAccess(parsedCommitteeId)

  const buffer = Buffer.from(await file.arrayBuffer())
  let extractedText = ''

  if (isDocx(file)) {
    const result = await mammoth.extractRawText({ buffer })
    extractedText = result.value ?? ''
  } else {
    const parser = new PDFParse({ data: buffer })
    try {
      const extracted = await parser.getText()
      extractedText = extracted.text ?? ''
    } finally {
      await parser.destroy()
    }
  }

  const chunks = chunkText(extractedText)
  if (chunks.length === 0) {
    throw new Error('Could not extract readable text from this file')
  }

  const contentType = isDocx(file)
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : 'application/pdf'
  const path = `committee-rag/${parsedCommitteeId}/${Date.now()}-${sanitizeFileName(file.name)}`
  const { error: uploadError } = await supabase.storage
    .from('meeting-files')
    .upload(path, file, { upsert: false, contentType })
  if (uploadError) throw new Error(uploadError.message)

  const { data: documentRow, error: insertDocError } = await supabase
    .from('committee_rag_documents')
    .insert({
      committee_id: parsedCommitteeId,
      category: safeCategory,
      document_name: safeDocumentName,
      file_name: file.name,
      storage_path: path,
      uploaded_by: userId,
    })
    .select('id, category, document_name, file_name, created_at')
    .single()

  if (insertDocError || !documentRow) {
    await supabase.storage.from('meeting-files').remove([path])
    throw new Error(insertDocError?.message ?? 'Failed to store committee RAG document')
  }

  const { error: chunksError } = await supabase
    .from('committee_rag_chunks')
    .insert(
      chunks.map((content, index) => ({
        document_id: documentRow.id,
        committee_id: parsedCommitteeId,
        chunk_index: index,
        content,
      })),
    )

  if (chunksError) {
    await supabase.from('committee_rag_documents').delete().eq('id', documentRow.id)
    await supabase.storage.from('meeting-files').remove([path])
    throw new Error(chunksError.message)
  }

  return {
    id: documentRow.id,
    category: documentRow.category,
    documentName: documentRow.document_name,
    fileName: documentRow.file_name,
    createdAt: documentRow.created_at,
  }
}

export async function deleteCommitteeRagDocument(documentId: string): Promise<void> {
  const parsedDocumentId = uuidSchema.parse(documentId)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()
  if (!profile) throw new Error('Profile not found')
  if (!['admin', 'cosec'].includes(profile.role)) {
    throw new Error('Only admin or secretariat can manage RAG documents')
  }

  const { data: row, error } = await supabase
    .from('committee_rag_documents')
    .select(`
      id,
      storage_path,
      committee_id,
      committees!inner(organization_id)
    `)
    .eq('id', parsedDocumentId)
    .single()
  if (error || !row) throw new Error('Document not found')

  const committee = Array.isArray(row.committees) ? row.committees[0] : row.committees
  if (!committee || committee.organization_id !== profile.organization_id) {
    throw new Error('Document not found or inaccessible')
  }

  const { error: deleteError } = await supabase
    .from('committee_rag_documents')
    .delete()
    .eq('id', parsedDocumentId)
  if (deleteError) throw new Error(deleteError.message)

  if (row.storage_path) {
    await supabase.storage.from('meeting-files').remove([row.storage_path])
  }
}
