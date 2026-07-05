import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FEATURES, normalizeFeatures } from "@/lib/features";
import { isPlatformAdmin } from "@/lib/superadmin";
import { canSeeNav, type Role } from "@/lib/rbac";
import type { AssignableModuleKey } from "@/lib/features";
import { Sidebar } from "@/components/Sidebar";
import { Toaster } from "@/components/ui/toaster";
import { ConfirmHost } from "@/components/ui/ConfirmHost";
import { getInitials } from "@/lib/format";
import { TermsGate } from "@/components/legal/TermsGate";
import { LEGAL_VERSION } from "@/lib/legal";
import { getImpersonationOrgName } from "@/lib/impersonation";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "full_name, role, active, terms_accepted_at, terms_accepted_version, allowed_modules, organizations(name, features, active)",
    )
    .eq("id", user.id)
    .single();

  const superadmin = await isPlatformAdmin();

  // Un superadmin normalmente no tiene perfil. Si lo tiene, está en modo vista
  // previa de una organización.
  const isPreview = superadmin && !!profile;

  const org = profile?.organizations as
    | { name?: string; features?: unknown; active?: boolean }
    | null;

  // Usuario desactivado: conserva sus datos pero no puede operar.
  const profileActive = (profile as { active?: boolean } | null)?.active ?? true;
  if (!superadmin && profile && profileActive === false) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md rounded-xl bg-white p-8 text-center shadow ring-1 ring-slate-200">
          <h1 className="text-xl font-bold text-slate-800">Cuenta desactivada</h1>
          <p className="mt-2 text-sm text-slate-500">
            Tu cuenta fue desactivada. Si crees que es un error, contacta al
            administrador de tu organización.
          </p>
        </div>
        <Toaster />
      </main>
    );
  }

  // Organización dada de baja: bloquea el acceso a sus usuarios.
  if (!superadmin && org && org.active === false) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md rounded-xl bg-white p-8 text-center shadow ring-1 ring-slate-200">
          <h1 className="text-xl font-bold text-slate-800">Cuenta suspendida</h1>
          <p className="mt-2 text-sm text-slate-500">
            El acceso a {org.name ?? "esta organización"} está temporalmente
            suspendido. Contacta al administrador de la plataforma.
          </p>
        </div>
        <Toaster />
      </main>
    );
  }

  // Aceptación de Términos: el admin la ve en el primer ingreso y cada vez que la
  // versión vigente (LEGAL_VERSION) difiere de la aceptada. No aplica al
  // superadmin ni en vista previa.
  const termsProfile = profile as {
    terms_accepted_at?: string | null;
    terms_accepted_version?: string | null;
  } | null;
  const termsAccepted =
    !!termsProfile?.terms_accepted_at &&
    termsProfile?.terms_accepted_version === LEGAL_VERSION;
  if (!superadmin && profile && profile.role === "admin" && !termsAccepted) {
    return (
      <>
        <TermsGate orgName={org?.name ?? "tu organización"} />
        <Toaster />
      </>
    );
  }

  const orgName = superadmin && !isPreview ? "Plataforma" : org?.name ?? "Organización";

  // Menú = módulos encendidos de la organización Y permitidos para el rol Y
  // (si existe) el override de visibilidad del usuario.
  const features = normalizeFeatures(org?.features);
  const role = profile?.role as Role | undefined;
  const allowedModules =
    (profile as { allowed_modules?: AssignableModuleKey[] | null } | null)
      ?.allowed_modules ?? null;

  const nav =
    superadmin && !isPreview
      ? []
      : FEATURES.filter(
          (f) => features[f.key] && canSeeNav(role, f.key, allowedModules),
        ).map((f) => ({ href: f.href, label: f.label }));

  const initials =
    !superadmin && profile?.full_name ? getInitials(profile.full_name) : null;

  const ROLE_LABEL: Record<string, string> = {
    admin: "Administrador",
    manager: "Gerente",
    member: "Miembro",
    viewer: "Lectura",
  };
  const subtitle = isPreview
    ? "Vista previa"
    : superadmin
    ? "Operador de plataforma"
    : `${profile?.full_name ?? ""} · ${ROLE_LABEL[profile?.role ?? ""] ?? profile?.role ?? ""}`;

  const impersonatingOrgName = await getImpersonationOrgName();

  return (
    <div className="flex min-h-screen flex-col">
      {impersonatingOrgName && <ImpersonationBanner orgName={impersonatingOrgName} />}
      <div className="flex flex-1 flex-col md:flex-row">
        <Sidebar
          orgName={orgName}
          subtitle={subtitle}
          initials={initials}
          nav={nav}
          superadmin={superadmin}
        />
        <main className="flex-1 p-4 md:p-8">{children}</main>
        <Toaster />
        <ConfirmHost />
      </div>
    </div>
  );
}
