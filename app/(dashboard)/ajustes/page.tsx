import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import { TeamPanel, type TeamMember } from "@/components/ajustes/TeamPanel";

// Ajustes de la organización. Por ahora: gestión del equipo (solo admin).
export default async function AjustesPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, role, active")
    .eq("org_id", profile.orgId)
    .order("full_name");
  const members = (data ?? []) as TeamMember[];

  return (
    <div className="space-y-6">
      <PageHeader title="Ajustes" subtitle="Equipo de la organización" />
      <TeamPanel members={members} currentUserId={profile.userId} />
    </div>
  );
}
