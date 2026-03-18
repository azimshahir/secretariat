import 'server-only'
import JSZip from 'jszip'

/** Extract readable text from a DOCX buffer (server-side). */
export async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const docXml = await zip.file('word/document.xml')?.async('string')
  if (!docXml) return ''
  const lines: string[] = []
  const parts = docXml.split(/<\/w:p>/)
  for (const part of parts) {
    const texts = part.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? []
    const line = texts.map(t => t.replace(/<[^>]+>/g, '')).join('')
    if (line.trim()) lines.push(line.trim())
  }
  return lines.join('\n')
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
