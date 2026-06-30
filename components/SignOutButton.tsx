"use client";

import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  async function signOut() {
    await createClient().auth.signOut();
    window.location.href = "/login";
  }
  return (
    <button
      onClick={signOut}
      className="w-full rounded-md px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-100"
    >
      Cerrar sesión
    </button>
  );
}
