"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { confirm } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { deleteCustomer } from "@/app/(dashboard)/clientes/actions";

export function DeleteCustomerButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function onClick() {
    const ok = await confirm({
      title: "Eliminar cliente",
      message: `¿Eliminar a ${name}? Esta acción no se puede deshacer.`,
      tone: "danger",
      confirmText: "Eliminar",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteCustomer(id);
      if (!res.ok) {
        toast(res.error ?? "No se pudo eliminar.", "error");
        return;
      }
      toast("Cliente eliminado.");
      router.refresh();
    });
  }

  return (
    <button
      onClick={onClick}
      disabled={pending}
      aria-label={`Eliminar ${name}`}
      className="rounded p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
