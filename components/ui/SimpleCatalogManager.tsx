"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/lib/toast";
import { confirm } from "@/lib/confirm";

export type CatalogItem = { id: string; name: string };
type CatalogResult = { ok: boolean; error?: string };

// Lista + alta + borrado para catálogos simples de "nombre" (sucursales,
// marcas, familias, procedencias). Las server actions se reciben por props
// para que este componente no conozca la tabla concreta.
export function SimpleCatalogManager({
  itemLabel,
  emptyLabel,
  items,
  canWrite,
  onCreate,
  onDelete,
}: {
  /** Nombre singular del tipo de registro, ej. "sucursal", "marca". */
  itemLabel: string;
  emptyLabel: string;
  items: CatalogItem[];
  canWrite: boolean;
  onCreate: (formData: FormData) => Promise<CatalogResult>;
  onDelete: (id: string) => Promise<CatalogResult>;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const res = await onCreate(new FormData(form));
    if (!res.ok) {
      toast(res.error ?? "No se pudo crear.", "error");
      return;
    }
    form.reset();
    toast(`${itemLabel[0].toUpperCase()}${itemLabel.slice(1)} creada.`);
    router.refresh();
  }

  async function handleDelete(id: string, name: string) {
    const ok = await confirm({
      title: `Eliminar ${name}`,
      message: `¿Eliminar "${name}"? Esta acción no se puede deshacer.`,
      tone: "danger",
      confirmText: "Eliminar",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await onDelete(id);
      if (!res.ok) {
        toast(res.error ?? "No se pudo eliminar.", "error");
        return;
      }
      toast("Eliminado.");
      router.refresh();
    });
  }

  return (
    <Card className="space-y-4 p-4">
      {canWrite && (
        <form onSubmit={handleCreate} className="flex items-end gap-2">
          <Field
            label={`Nueva ${itemLabel}`}
            name="name"
            required
            className="flex-1"
          />
          <Button type="submit">Agregar</Button>
        </form>
      )}
      {items.length === 0 ? (
        <EmptyState title={emptyLabel} />
      ) : (
        <ul className="divide-y divide-slate-200">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <span className="text-sm text-slate-800">{item.name}</span>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => handleDelete(item.id, item.name)}
                  disabled={pending}
                  aria-label={`Eliminar ${item.name}`}
                  className="rounded p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
