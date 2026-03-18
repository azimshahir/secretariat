import * as XLSX from 'xlsx'
import {
  Document, Packer, Paragraph, Table as DocxTable, TableRow as DocxRow,
  TableCell as DocxCell, TextRun, AlignmentType, WidthType, BorderStyle,
  HeadingLevel,
} from 'docx'

interface SheetData {
  headers: string[]
  columns: string[]
  rows: string[][]
}

export function exportXlsx({ headers, columns, rows }: SheetData, filename: string) {
  const wsData: string[][] = [
    ...headers.map(h => [h]),
    [], // empty row separator
    columns,
    ...rows,
  ]

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(wsData)

  // Merge header cells across all columns
  const merges = headers.map((_, i) => ({
    s: { r: i, c: 0 },
    e: { r: i, c: columns.length - 1 },
  }))
  ws['!merges'] = merges

  // Column widths
  ws['!cols'] = columns.map((_, i) => ({ wch: i === 0 ? 6 : i === 1 ? 10 : 30 }))

  XLSX.utils.book_append_sheet(wb, ws, 'Agenda')
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

export async function exportDocx({ headers, columns, rows }: SheetData, filename: string) {
  const headerParagraphs = headers.map((h, i) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [new TextRun({
        text: h,
        bold: i === 1,
        size: i === 0 ? 18 : i === 1 ? 24 : 18,
        font: 'Calibri',
      })],
    })
  )

  const borderStyle = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' }
  const borders = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle }

  const tableHeaderRow = new DocxRow({
    children: columns.map(col =>
      new DocxCell({
        borders,
        width: { size: 100 / columns.length, type: WidthType.PERCENTAGE },
        children: [new Paragraph({
          children: [new TextRun({ text: col, bold: true, size: 20, font: 'Calibri' })],
        })],
      })
    ),
  })

  const tableRows = rows.map(row =>
    new DocxRow({
      children: row.map(cell =>
        new DocxCell({
          borders,
          children: [new Paragraph({
            children: [new TextRun({ text: cell || '', size: 20, font: 'Calibri' })],
          })],
        })
      ),
    })
  )

  const doc = new Document({
    sections: [{
      children: [
        ...headerParagraphs,
        new Paragraph({ spacing: { after: 200 }, children: [] }),
        new DocxTable({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [tableHeaderRow, ...tableRows],
        }),
      ],
    }],
  })

  const blob = await Packer.toBlob(doc)
  downloadBlob(blob, `${filename}.docx`)
}

export function exportPdf({ headers, columns, rows }: SheetData, filename: string) {
  const html = `
    <!DOCTYPE html>
    <html><head>
      <title>${filename}</title>
      <style>
        body { font-family: Calibri, Arial, sans-serif; padding: 40px; color: #333; }
        .header { text-align: center; margin-bottom: 24px; }
        .header p { margin: 2px 0; }
        .header .org { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #888; }
        .header .title { font-size: 14px; font-weight: 700; }
        .header .date { font-size: 11px; color: #888; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th { background: #f5f5f5; text-align: left; padding: 8px 10px; border: 1px solid #ddd; font-weight: 600; }
        td { padding: 6px 10px; border: 1px solid #ddd; }
        @media print { body { padding: 20px; } }
      </style>
    </head><body>
      <div class="header">
        ${headers.map((h, i) => `<p class="${i === 0 ? 'org' : i === 1 ? 'title' : 'date'}">${h}</p>`).join('')}
      </div>
      <table>
        <thead><tr>${columns.map(c => `<th>${c}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c || ''}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </body></html>`

  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  if (win) {
    win.onload = () => {
      win.print()
      // Cleanup after print dialog closes
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    }
  }
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
