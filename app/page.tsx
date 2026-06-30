import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Raíz: a quien tiene sesión lo manda al panel; si no, al login.
export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  redirect(user ? "/dashboard" : "/login");
}
