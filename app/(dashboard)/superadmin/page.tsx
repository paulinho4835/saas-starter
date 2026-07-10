import { redirect } from "next/navigation";
import { isPlatformAdmin } from "@/lib/superadmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformUsage } from "@/lib/platformUsage";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { NewOrgForm } from "@/components/superadmin/NewOrgForm";
import { OrgCard, type OrgRow } from "@/components/superadmin/OrgCard";
import { UsagePanel } from "@/components/superadmin/UsagePanel";

// Panel del operador de la plataforma (dueño del SaaS): gestiona TODAS las
// organizaciones. Usa el cliente service-role tras verificar isPlatformAdmin.
export default async function SuperadminPage() {
  if (!(await isPlatformAdmin())) redirect("/dashboard");

  const admin = createAdminClient();
  const [{ data }, usageResult] = await Promise.all([
    admin.from("organizations").select("id, name, active, features").order("name"),
    getPlatformUsage(admin).then(
      (usage) => ({ ok: true as const, usage }),
      (error: unknown) => {
        console.error("No se pudo obtener el uso de la plataforma:", error);
        return { ok: false as const };
      },
    ),
  ]);
  const orgs = (data ?? []) as OrgRow[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Superadmin"
        subtitle={`${orgs.length} organizaciones`}
        action={<NewOrgForm />}
      />

      <UsagePanel usage={usageResult.ok ? usageResult.usage : null} />

      {orgs.length === 0 ? (
        <EmptyState
          title="Aún no hay organizaciones"
          description="Crea la primera para empezar."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {orgs.map((org) => (
            <OrgCard key={org.id} org={org} />
          ))}
        </div>
      )}
    </div>
  );
}
