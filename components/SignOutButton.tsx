import { signOutAction } from "@/lib/impersonation-actions";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="w-full rounded-md px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-100"
      >
        Cerrar sesión
      </button>
    </form>
  );
}
