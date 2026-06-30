import type { Metadata } from "next";
import {
  LEGAL_LAST_UPDATED,
  PLATFORM_NAME,
  OPERATOR_NAME,
  CONTACT_EMAIL,
} from "@/lib/legal";

export const metadata: Metadata = { title: "Política de Privacidad" };

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-8 text-lg font-semibold text-slate-800">{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm leading-relaxed text-slate-600">{children}</p>;
}

// PLANTILLA. Ajústala a tu producto y hazla revisar por un abogado.
export default function PrivacidadPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">
        Política de Privacidad
      </h1>
      <p className="mt-2 text-xs text-slate-400">
        Última actualización: {LEGAL_LAST_UPDATED}
      </p>

      <P>
        Esta Política explica cómo {PLATFORM_NAME}, operada por {OPERATOR_NAME}{" "}
        (&ldquo;la Plataforma&rdquo;), trata la información de las organizaciones
        usuarias. Cada organización es responsable de los datos que carga; la
        Plataforma los procesa por su cuenta para prestar el servicio.
      </P>

      <H2>1. Datos que tratamos</H2>
      <P>
        Datos de los usuarios (nombre, correo, rol y actividad dentro del
        sistema), los datos operativos que cada organización carga, y registros
        técnicos necesarios para la seguridad y el funcionamiento del servicio.
      </P>

      <H2>2. Finalidad</H2>
      <P>
        Los datos se utilizan únicamente para prestar y mantener el servicio y
        para garantizar la seguridad de la cuenta.
      </P>

      <H2>3. Cookies y sesión</H2>
      <P>
        Usamos únicamente cookies esenciales para mantener tu sesión iniciada y
        proteger la cuenta. No usamos cookies de publicidad ni de seguimiento con
        fines comerciales.
      </P>

      <H2>4. No comercializamos los datos</H2>
      <P>
        No vendemos, alquilamos ni cedemos los datos a terceros con fines
        comerciales. Solo se comparten con los proveedores estrictamente
        necesarios para operar el servicio, o cuando lo exija la ley.
      </P>

      <H2>5. Encargados y almacenamiento</H2>
      <P>
        Para operar nos apoyamos en proveedores de infraestructura (alojamiento
        de la base de datos, almacenamiento de archivos) que actúan como
        encargados y tratan los datos siguiendo nuestras instrucciones y medidas
        de seguridad adecuadas.
      </P>

      <H2>6. Seguridad</H2>
      <P>
        Protegemos la información con control de acceso por rol, cifrado en
        tránsito, aislamiento de los datos de cada organización, limitación de
        intentos de acceso y respaldos periódicos.
      </P>

      <H2>7. Conservación</H2>
      <P>
        Conservamos los datos mientras la organización mantenga su cuenta activa y
        según las obligaciones legales aplicables. Tras la baja pueden conservarse
        por el tiempo que exija la ley y luego eliminarse o anonimizarse.
      </P>

      <H2>8. Contacto</H2>
      <P>
        Para consultas sobre privacidad, escribe a {OPERATOR_NAME} al correo{" "}
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
