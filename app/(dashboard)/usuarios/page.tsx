import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import { TeamPanel, type TeamMember } from "@/components/usuarios/TeamPanel";

// Gestión de equipo + permisos por módulo (solo admin).
export default async function UsuariosPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: membersData }, { data: branchesData }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, role, active, branch_id, allowed_modules")
      .eq("org_id", profile.orgId)
      .order("full_name"),
    supabase.from("branches").select("id, name").order("name"),
  ]);
  const members = (membersData ?? []) as TeamMember[];
  const branches = (branchesData ?? []) as { id: string; name: string }[];

  return (
    <div className="space-y-6">
      <PageHeader title="Usuarios" subtitle="Equipo de la organización y permisos" />
      <TeamPanel members={members} currentUserId={profile.userId} branches={branches} />
    </div>
  );
}
