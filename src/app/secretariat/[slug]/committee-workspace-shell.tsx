'use client'

import dynamic from 'next/dynamic'

const CommitteeWorkspace = dynamic(
  () => import('./committee-workspace').then(module => module.CommitteeWorkspace),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-[28px] border border-zinc-200 bg-white px-6 py-10 text-sm text-zinc-500 shadow-sm">
        Loading committee workspace...
      </div>
    ),
  },
)

export const CommitteeWorkspaceShell = CommitteeWorkspace
