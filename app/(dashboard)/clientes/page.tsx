import { Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { requireNavAccess } from "@/lib/guard";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { NewCustomerForm } from "@/components/clientes/NewCustomerForm";
import { DeleteCustomerButton } from "@/components/clientes/DeleteCustomerButton";

type Customer = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  created_at: string;
};

// Módulo de ejemplo: lista de clientes de la organización. RLS garantiza el
// aislamiento; igual filtramos por org_id como defensa en profundidad.
export default async function ClientesPage() {
  await requireNavAccess("clientes");

  const supabase = await createClient();
  const profile = await getProfile();

  const { data } = await supabase
    .from("customers")
    .select("id, full_name, email, phone, created_at")
    .order("full_name");
  const customers = (data ?? []) as Customer[];

  const canDelete = can(profile?.role, "clientes:delete");
  const canCreate = can(profile?.role, "clientes:write");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clientes"
        subtitle={`${customers.length} registrados`}
        action={canCreate ? <NewCustomerForm /> : null}
      />

      <Card>
        {customers.length === 0 ? (
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="Aún no hay clientes"
            description="Crea el primer cliente para empezar."
          />
        ) : (
          <ul className="divide-y divide-slate-200">
            {customers.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-800">
                    {c.full_name}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {[c.email, c.phone].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                {canDelete && (
                  <DeleteCustomerButton id={c.id} name={c.full_name} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
