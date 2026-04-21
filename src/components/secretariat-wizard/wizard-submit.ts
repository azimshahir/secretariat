import { postFormData } from '@/lib/api/client'
import type { WizardState } from './wizard-types'

export async function submitWizard(state: WizardState): Promise<{ committeeId: string; slug: string }> {
  const payload = new FormData()
  payload.set(
    'state',
    JSON.stringify({
      ...state,
      ragFiles: state.ragFiles.map(fileDraft => ({
        id: fileDraft.id,
        category: fileDraft.category,
        customName: fileDraft.customName,
      })),
    }),
  )

  for (const rag of state.ragFiles) {
    if (!rag.file) continue
    payload.set(`rag-file:${rag.id}`, rag.file)
  }

  const result = await postFormData<{
    ok: true
    committeeId: string
    slug: string
  }>('/api/secretariat-wizard/submit', payload)

  return {
    committeeId: result.committeeId,
    slug: result.slug,
  }
}
