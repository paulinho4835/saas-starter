import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/ui/PageHeader";
import { TeamPanel, type TeamMember } from "@/components/ajustes/TeamPanel";
import { SimpleCatalogManager } from "@/components/ui/SimpleCatalogManager";
import { createBranch, deleteBranch } from "@/app/(dashboard)/ajustes/actions";

// Ajustes de la organización: equipo + sucursales (solo admin).
export default async function AjustesPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: membersData }, { data: branchesData }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, role, active")
      .eq("org_id", profile.orgId)
      .order("full_name"),
    supabase.from("branches").select("id, name").order("name"),
  ]);
  const members = (membersData ?? []) as TeamMember[];
  const branches = (branchesData ?? []) as { id: string; name: string }[];

  return (
    <div className="space-y-6">
      <PageHeader title="Ajustes" subtitle="Equipo de la organización" />
      <TeamPanel members={members} currentUserId={profile.userId} />

      <div>
        <h2 className="mb-3 font-semibold text-slate-800">Sucursales</h2>
        <SimpleCatalogManager
          itemLabel="sucursal"
          emptyLabel="Aún no hay sucursales"
          items={branches}
          canWrite={can(profile.role, "sucursales:write")}
          onCreate={createBranch}
          onDelete={deleteBranch}
        />
      </div>
    </div>
  );
}
