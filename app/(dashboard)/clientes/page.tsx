import Link from "next/link";
import { Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { requireNavAccess } from "@/lib/guard";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/Field";
import { escapePostgrestFilterValue } from "@/lib/postgrest";
import { NewCustomerForm } from "@/components/clientes/NewCustomerForm";
import { DeleteCustomerButton } from "@/components/clientes/DeleteCustomerButton";

type Customer = {
  id: string;
  full_name: string;
  nit: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
};

// Módulo de ejemplo: lista de clientes de la organización. RLS garantiza el
// aislamiento; igual filtramos por org_id como defensa en profundidad.
export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireNavAccess("clientes");
  const sp = await searchParams;

  const supabase = await createClient();
  const profile = await getProfile();

  let query = supabase
    .from("customers")
    .select("id, full_name, nit, email, phone, created_at")
    .order("full_name");
  if (sp.q) {
    const q = escapePostgrestFilterValue(sp.q);
    query = query.or(`full_name.ilike.%${q}%,nit.ilike.%${q}%`);
  }
  const { data } = await query;
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

      <Card className="p-4">
        <form className="flex items-end gap-3" method="get">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Buscar por nombre o NIT</span>
            <input
              type="text"
              name="q"
              defaultValue={sp.q ?? ""}
              className={`${fieldInputClass} w-64`}
            />
          </label>
          <Button type="submit">Buscar</Button>
        </form>
      </Card>

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
                <Link href={`/clientes/${c.id}`} className="min-w-0 hover:underline">
                  <p className="truncate font-medium text-slate-800">
                    {c.full_name}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {[c.nit ? `NIT: ${c.nit}` : null, c.email, c.phone].filter(Boolean).join(" · ") || "—"}
                  </p>
                </Link>
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
