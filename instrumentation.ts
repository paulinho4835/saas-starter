// Validación de entorno al arranque del servidor. Corta el arranque si falta una
// variable obligatoria (en vez de fallar callado en runtime) y advierte de
// configuraciones incompletas. Ver lib/env.ts.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("@/lib/env");
    const { errors, warnings } = validateEnv();

    for (const w of warnings) console.warn(`[env] ${w}`);

    if (errors.length > 0) {
      for (const e of errors) console.error(`[env] ${e}`);
      // En producción, abortar el arranque. En dev, solo gritar fuerte.
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          `Configuración de entorno inválida: ${errors.length} error(es). Revisa los logs.`,
        );
      }
    }
  }
}
