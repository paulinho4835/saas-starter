import { Truck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { requireNavAccess } from "@/lib/guard";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { NewSupplierForm } from "@/components/proveedores/NewSupplierForm";
import { DeleteSupplierButton } from "@/components/proveedores/DeleteSupplierButton";

type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  contact_name: string | null;
  notes: string | null;
};

export default async function ProveedoresPage() {
  await requireNavAccess("proveedores");

  const supabase = await createClient();
  const profile = await getProfile();

  const { data } = await supabase
    .from("suppliers")
    .select("id, name, phone, contact_name, notes")
    .order("name");
  const suppliers = (data ?? []) as Supplier[];

  const canWrite = can(profile?.role, "proveedores:write");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Proveedores"
        subtitle={`${suppliers.length} registrados`}
        action={canWrite ? <NewSupplierForm /> : null}
      />

      <Card>
        {suppliers.length === 0 ? (
          <EmptyState
            icon={<Truck className="h-6 w-6" />}
            title="Aún no hay proveedores"
            description="Crea el primer proveedor para empezar."
          />
        ) : (
          <ul className="divide-y divide-slate-200">
            {suppliers.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-800">{s.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {[s.contact_name, s.phone].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                {canWrite && <DeleteSupplierButton id={s.id} name={s.name} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
