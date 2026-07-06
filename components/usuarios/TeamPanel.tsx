"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, FieldLabel, fieldInputClass } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { toast } from "@/lib/toast";
import { confirm } from "@/lib/confirm";
import type { AssignableModuleKey } from "@/lib/features";
import { createTeamUser, setUserActive, setUserBranch } from "@/app/(dashboard)/usuarios/actions";
import { PermissionsModal } from "@/components/usuarios/PermissionsModal";

export type TeamMember = {
  id: string;
  full_name: string;
  role: string;
  active: boolean;
  branch_id: string | null;
  allowed_modules: AssignableModuleKey[] | null;
};

type BranchOption = { id: string; name: string };

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrador",
  manager: "Gerente",
  member: "Miembro",
  viewer: "Lectura",
};

export function TeamPanel({
  members,
  currentUserId,
  branches,
}: {
  members: TeamMember[];
  currentUserId: string;
  branches: BranchOption[];
}) {
  const [loading, setLoading] = useState(false);
  const [permissionsFor, setPermissionsFor] = useState<TeamMember | null>(null);
  const router = useRouter();

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = e.currentTarget;
    const res = await createTeamUser(new FormData(form));
    setLoading(false);
    if (!res.ok) {
      toast(res.error ?? "No se pudo crear el usuario.", "error");
      return;
    }
    toast("Usuario creado. Entrégale el correo y la contraseña.");
    form.reset();
    router.refresh();
  }

  async function onToggle(m: TeamMember) {
    const ok = await confirm({
      title: m.active ? "Desactivar usuario" : "Reactivar usuario",
      message: m.active
        ? `${m.full_name} no podrá ingresar hasta reactivarlo.`
        : `${m.full_name} podrá volver a ingresar.`,
      tone: m.active ? "danger" : "default",
    });
    if (!ok) return;
    const res = await setUserActive(m.id, !m.active);
    if (!res.ok) {
      toast(res.error ?? "No se pudo actualizar.", "error");
      return;
    }
    toast("Usuario actualizado.");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h2 className="font-semibold text-slate-800">Crear usuario</h2>
        <p className="mt-1 text-sm text-slate-500">
          Define la contraseña y entrégasela tú mismo al trabajador. El correo
          puede ser inventado (ej. juan@retenes.local), solo se usa para
          iniciar sesión.
        </p>
        <form onSubmit={onCreate} className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Nombre completo" name="fullName" required />
          <Field label="Correo" name="email" type="email" required />
          <Field
            label="Contraseña"
            name="password"
            type="text"
            required
            minLength={6}
          />
          <label className="block text-sm">
            <FieldLabel>Rol</FieldLabel>
            <select name="role" className={fieldInputClass} defaultValue="member">
              <option value="admin">Administrador</option>
              <option value="manager">Gerente</option>
              <option value="member">Miembro</option>
              <option value="viewer">Lectura</option>
            </select>
          </label>
          <label className="block text-sm">
            <FieldLabel>Sucursal (opcional)</FieldLabel>
            <select name="branchId" className={fieldInputClass} defaultValue="">
              <option value="">— Sin asignar —</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Creando…" : "Crear usuario"}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <ul className="divide-y divide-slate-200">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-800">
                  {m.full_name}
                  {m.id === currentUserId && (
                    <span className="ml-2 text-xs text-slate-400">(tú)</span>
                  )}
                </p>
                <p className="text-xs text-slate-500">
                  {ROLE_LABEL[m.role] ?? m.role}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <MemberBranchEditor member={m} branches={branches} />
                {!m.active && <Badge tone="danger">Inactivo</Badge>}
                {m.id !== currentUserId && (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setPermissionsFor(m)}
                    >
                      Permisos
                    </Button>
                    <Button
                      size="sm"
                      variant={m.active ? "danger" : "secondary"}
                      onClick={() => onToggle(m)}
                    >
                      {m.active ? "Desactivar" : "Reactivar"}
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <PermissionsModal
        member={permissionsFor}
        onClose={() => setPermissionsFor(null)}
      />
    </div>
  );
}

function MemberBranchEditor({
  member,
  branches,
}: {
  member: TeamMember;
  branches: BranchOption[];
}) {
  const [branchId, setBranchId] = useState(member.branch_id ?? "");
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function save() {
    setSaving(true);
    const res = await setUserBranch(member.id, branchId || null);
    setSaving(false);
    if (!res.ok) {
      toast(res.error ?? "No se pudo actualizar la sucursal.", "error");
      return;
    }
    toast("Sucursal actualizada.");
    router.refresh();
  }

  const changed = branchId !== (member.branch_id ?? "");

  return (
    <div className="flex items-center gap-2">
      <select
        value={branchId}
        onChange={(e) => setBranchId(e.target.value)}
        className={`${fieldInputClass} w-40`}
      >
        <option value="">— Sin asignar —</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      {changed && (
        <Button size="sm" variant="secondary" disabled={saving} onClick={save}>
          Guardar
        </Button>
      )}
    </div>
  );
}
