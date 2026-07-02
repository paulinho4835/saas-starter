import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/ui/PageHeader";
import { SimpleCatalogManager } from "@/components/ui/SimpleCatalogManager";
import { createBranch, deleteBranch } from "@/app/(dashboard)/ajustes/actions";

// Ajustes de la organización: sucursales (solo admin). La gestión de equipo
// y permisos vive en /usuarios.
export default async function AjustesPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/dashboard");

  const supabase = await createClient();
  const { data: branchesData } = await supabase
    .from("branches")
    .select("id, name")
    .order("name");
  const branches = (branchesData ?? []) as { id: string; name: string }[];

  return (
    <div className="space-y-6">
      <PageHeader title="Ajustes" subtitle="Configuración de la organización" />
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
