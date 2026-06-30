import { Users, Package } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import { Stat } from "@/components/ui/Stat";

// Panel de inicio: métricas básicas de la organización. Punto de partida para
// el dashboard de tu dominio.
export default async function DashboardHome() {
  const supabase = await createClient();
  const profile = await getProfile();

  const [{ count: clientes }, { count: items }] = await Promise.all([
    supabase.from("customers").select("id", { count: "exact", head: true }),
    supabase.from("items").select("id", { count: "exact", head: true }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hola, ${profile?.fullName ?? ""}`}
        subtitle="Resumen de tu organización"
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          label="Clientes"
          value={clientes ?? 0}
          icon={<Users className="h-5 w-5" />}
        />
        <Stat
          label="Items en inventario"
          value={items ?? 0}
          icon={<Package className="h-5 w-5" />}
        />
      </div>
    </div>
  );
}
