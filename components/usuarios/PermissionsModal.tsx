"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { toast } from "@/lib/toast";
import { ASSIGNABLE_MODULES, type AssignableModuleKey } from "@/lib/features";
import { setUserModules } from "@/app/(dashboard)/usuarios/actions";
import type { TeamMember } from "@/components/usuarios/TeamPanel";

const ALL_KEYS = ASSIGNABLE_MODULES.map((m) => m.key);

export function PermissionsModal({
  member,
  onClose,
}: {
  member: TeamMember | null;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<AssignableModuleKey>>(
    new Set(ALL_KEYS),
  );
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  // Recarga el set marcado cada vez que se abre el modal para un usuario distinto.
  useEffect(() => {
    if (!member) return;
    setSelected(new Set(member.allowed_modules ?? ALL_KEYS));
  }, [member]);

  function toggle(key: AssignableModuleKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save() {
    if (!member) return;
    setSaving(true);
    // Todo marcado = sin override (equivale a null: el usuario vuelve a
    // seguir el whitelist de su rol tal cual).
    const allChecked = selected.size === ALL_KEYS.length;
    const res = await setUserModules(
      member.id,
      allChecked ? null : Array.from(selected),
    );
    setSaving(false);
    if (!res.ok) {
      toast(res.error ?? "No se pudo actualizar los permisos.", "error");
      return;
    }
    toast("Permisos actualizados.");
    router.refresh();
    onClose();
  }

  return (
    <Modal
      open={!!member}
      onClose={onClose}
      title="Asignar permisos"
      subtitle={member?.full_name}
      size="lg"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {ASSIGNABLE_MODULES.map((mod) => (
          <label
            key={mod.key}
            className="flex items-center gap-2 text-sm text-slate-700"
          >
            <input
              type="checkbox"
              checked={selected.has(mod.key)}
              onChange={() => toggle(mod.key)}
              className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
            />
            {mod.label}
          </label>
        ))}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </Modal>
  );
}
