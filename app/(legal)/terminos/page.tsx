import type { Metadata } from "next";
import {
  LEGAL_LAST_UPDATED,
  PLATFORM_NAME,
  OPERATOR_NAME,
  CONTACT_EMAIL,
  GOVERNING_LAW,
} from "@/lib/legal";

export const metadata: Metadata = { title: "Términos y Condiciones" };

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-8 text-lg font-semibold text-slate-800">{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm leading-relaxed text-slate-600">{children}</p>;
}

// PLANTILLA. Ajusta el texto a tu producto y hazlo revisar por un abogado de tu
// jurisdicción antes de operar comercialmente.
export default function TerminosPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">
        Términos y Condiciones
      </h1>
      <p className="mt-2 text-xs text-slate-400">
        Última actualización: {LEGAL_LAST_UPDATED}
      </p>

      <P>
        {PLATFORM_NAME} (en adelante, &ldquo;la Plataforma&rdquo;), operada por{" "}
        {OPERATOR_NAME}, ofrece un servicio de software como servicio (SaaS) para
        la gestión de organizaciones. Al usar la Plataforma, aceptas estos
        Términos.
      </P>

      <H2>1. Cuentas y acceso</H2>
      <P>
        Cada organización accede mediante usuarios con credenciales propias. El
        administrador de la organización es responsable de gestionar a sus
        usuarios y de mantener la confidencialidad de sus accesos.
      </P>

      <H2>2. Uso del servicio</H2>
      <P>
        Te comprometes a usar la Plataforma conforme a la ley y a no intentar
        vulnerar su seguridad, acceder a datos de otras organizaciones, ni
        interferir con su funcionamiento.
      </P>

      <H2>3. Datos de la organización</H2>
      <P>
        Los datos que cargas son de tu organización. La Plataforma los procesa
        por tu cuenta para prestar el servicio, según la Política de Privacidad.
      </P>

      <H2>4. Propiedad intelectual</H2>
      <P>
        El software, su diseño y su código pertenecen a {OPERATOR_NAME}. El
        contenido y los datos que cargue cada organización pertenecen a esa
        organización.
      </P>

      <H2>5. Disponibilidad</H2>
      <P>
        Procuramos mantener el servicio disponible y respaldado, pero se presta
        &ldquo;tal cual&rdquo;, sin garantía de disponibilidad ininterrumpida.
        Podemos realizar mantenimientos y mejoras.
      </P>

      <H2>6. Suspensión y baja</H2>
      <P>
        Podemos suspender el acceso ante un uso indebido o ante la falta de pago
        del servicio. Durante un periodo de gracia razonable conservamos los
        datos para que puedas regularizar tu situación o exportarlos.
      </P>

      <H2>7. Cambios en los Términos</H2>
      <P>
        Podemos actualizar estos Términos. Si cambian de fondo, se solicitará una
        nueva aceptación dentro de la Plataforma.
      </P>

      <H2>8. Ley aplicable</H2>
      <P>
        Estos Términos se rigen por las leyes de {GOVERNING_LAW} y cualquier
        controversia se someterá a sus tribunales competentes.
      </P>

      <H2>9. Contacto</H2>
      <P>
        Para consultas sobre estos Términos, escribe a {OPERATOR_NAME} al correo{" "}
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="font-medium text-brand hover:underline"
        >
          {CONTACT_EMAIL}
        </a>
        .
      </P>
    </div>
  );
}
