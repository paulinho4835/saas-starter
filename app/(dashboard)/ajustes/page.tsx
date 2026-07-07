import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { SimpleCatalogManager } from "@/components/ui/SimpleCatalogManager";
import { ButtonLink } from "@/components/ui/Button";
import { ExchangeRateForm } from "@/components/ajustes/ExchangeRateForm";
import { createBranch, deleteBranch } from "@/app/(dashboard)/ajustes/actions";

// Ajustes de la organización: sucursales (solo admin). La gestión de equipo
// y permisos vive en /usuarios.
export default async function AjustesPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: branchesData }, { data: orgData }] = await Promise.all([
    supabase.from("branches").select("id, name").order("name"),
    supabase.from("organizations").select("exchange_rate").eq("id", profile.orgId).single(),
  ]);
  const branches = (branchesData ?? []) as { id: string; name: string }[];
  const exchangeRate = orgData?.exchange_rate ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Ajustes" subtitle="Configuración de la organización" />

      <Card className="p-4">
        <h2 className="font-semibold text-slate-800">Tipo de cambio</h2>
        <p className="mt-1 text-sm text-slate-500">
          Es único para toda la organización. Al guardarlo, se recalcula automáticamente el
          precio (SF, CF y MAY) de todos los productos.
        </p>
        <div className="mt-3">
          <ExchangeRateForm exchangeRate={exchangeRate} />
        </div>
      </Card>

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

      <Card className="p-4">
        <h2 className="font-semibold text-slate-800">Respaldo de datos</h2>
        <p className="mt-1 text-sm text-slate-500">
          Descarga un Excel con toda la información de la organización (productos, stock, ventas,
          clientes, proveedores, sucursales, movimientos y devoluciones) — para respaldo o
          migración a otro sistema.
        </p>
        <ButtonLink href="/ajustes/exportar" className="mt-3" variant="secondary">
          <Download className="h-4 w-4" /> Descargar respaldo completo (.xlsx)
        </ButtonLink>
      </Card>
    </div>
  );
}
