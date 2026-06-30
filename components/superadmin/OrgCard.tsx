"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { toast } from "@/lib/toast";
import { FEATURES, normalizeFeatures } from "@/lib/features";
import { toggleFeature, setOrgActive } from "@/app/(dashboard)/superadmin/actions";

export type OrgRow = {
  id: string;
  name: string;
  active: boolean;
  features: unknown;
};

// Solo se muestran como toggles los módulos opt-in (los core/normales van
// siempre encendidos). Esta es la lista de "addons" vendibles.
const OPTIONAL_FEATURES = FEATURES.filter((f) => f.optIn);

export function OrgCard({ org }: { org: OrgRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const features = normalizeFeatures(org.features);

  async function onToggleFeature(key: (typeof OPTIONAL_FEATURES)[number]["key"]) {
    setBusy(true);
    const res = await toggleFeature(org.id, key, !features[key]);
    setBusy(false);
    if (!res.ok) {
      toast(res.error ?? "Error.", "error");
      return;
    }
    router.refresh();
  }

  async function onToggleActive() {
    setBusy(true);
    const res = await setOrgActive(org.id, !org.active);
    setBusy(false);
    if (!res.ok) {
      toast(res.error ?? "Error.", "error");
      return;
    }
    toast(org.active ? "Organización suspendida." : "Organización reactivada.");
    router.refresh();
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-800">{org.name}</h3>
          {!org.active && <Badge tone="danger">Suspendida</Badge>}
        </div>
        <Button
          size="sm"
          variant={org.active ? "danger" : "secondary"}
          onClick={onToggleActive}
          disabled={busy}
        >
          {org.active ? "Suspender" : "Reactivar"}
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {OPTIONAL_FEATURES.map((f) => {
          const on = features[f.key];
          return (
            <button
              key={f.key}
              onClick={() => onToggleFeature(f.key)}
              disabled={busy}
              className={
                "rounded-full px-3 py-1 text-xs font-medium ring-1 transition disabled:opacity-50 " +
                (on
                  ? "bg-brand/10 text-brand ring-brand/20"
                  : "bg-slate-100 text-slate-500 ring-slate-200 hover:bg-slate-200")
              }
            >
              {on ? "✓ " : ""}
              {f.label}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
