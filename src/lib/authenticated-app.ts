import "server-only"

import { redirect } from "next/navigation"

import { canViewOrganizationScope } from "@/lib/secretariat-access"
import { createClient } from "@/lib/supabase/server"
import { ensureUserProvisioned } from "@/lib/auth/provision"

export async function requireAuthedAppContext() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  let { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single()

  if (!profile) {
    await ensureUserProvisioned(user)
    const retry = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single()
    profile = retry.data
  }

  if (!profile) {
    redirect("/login?error=Profile+setup+failed.+Please+try+signing+up+again.")
  }

  const { data: committees } = await supabase
    .from("committees")
    .select("*")
    .order("name")

  const allCommittees = committees ?? []

  return {
    supabase,
    user,
    profile,
    committees: allCommittees,
    activeSecretariats: allCommittees,
    canViewOrgScope: canViewOrganizationScope(profile.role),
  }
}
