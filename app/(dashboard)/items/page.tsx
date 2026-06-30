import { Package } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireNavAccess } from "@/lib/guard";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

type Item = { id: string; name: string; quantity: number };

// Segundo módulo de ejemplo (addon opt-in). Sólo lectura para mantenerlo breve;
// duplica el patrón de "clientes" (actions + form) si necesitas alta/edición.
export default async function ItemsPage() {
  await requireNavAccess("items");

  const supabase = await createClient();
  const { data } = await supabase
    .from("items")
    .select("id, name, quantity")
    .order("name");
  const items = (data ?? []) as Item[];

  return (
    <div className="space-y-6">
      <PageHeader title="Inventario" subtitle={`${items.length} items`} />
      <Card>
        {items.length === 0 ? (
          <EmptyState
            icon={<Package className="h-6 w-6" />}
            title="Sin items"
            description="Este módulo de ejemplo es de solo lectura."
          />
        ) : (
          <ul className="divide-y divide-slate-200">
            {items.map((it) => (
              <li
                key={it.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <span className="font-medium text-slate-800">{it.name}</span>
                <span className="tabular-nums text-slate-500">{it.quantity}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
