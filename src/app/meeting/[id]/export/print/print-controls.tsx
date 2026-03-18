'use client'

export function PrintControls() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded border px-3 py-1.5 text-xs font-medium hover:bg-zinc-100"
    >
      Print / Save as PDF
    </button>
  )
}
