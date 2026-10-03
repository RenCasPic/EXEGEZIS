// DRAFT pending legal review. The versions are the ones a new account accepts
// (packages/accounts/src/legal.ts): change them when these texts change.
import { PRIVACY_VERSION, TERMS_VERSION } from "../../../packages/accounts/src/legal";

export type LegalDocument = "privacy" | "terms";

export interface LegalText {
  title: string;
  summary: string;
  sections: { heading: string; paragraphs: string[] }[];
}

/** The URL path of each document in each language (/es/privacidad/, /en/privacy/…). */
export const LEGAL_SLUGS: Record<LegalDocument, Record<"en" | "es", string>> = {
  privacy: { en: "privacy", es: "privacidad" },
  terms: { en: "terms", es: "terminos" },
};

export const LEGAL_VERSION: Record<LegalDocument, string> = { privacy: PRIVACY_VERSION, terms: TERMS_VERSION };

/** {email} is replaced by the privacy contact (NEXT_PUBLIC_EXEGEZIS_PRIVACY_EMAIL). */
export const LEGAL: Record<LegalDocument, Record<"en" | "es", LegalText>> = {
  privacy: {
    es: {
      title: "Política de privacidad",
      summary: "Qué datos trata EXEGEZIS, para qué, dónde están y cómo puedes verlos, llevártelos o borrarlos.",
      sections: [
        {
          heading: "Qué datos tratamos",
          paragraphs: [
            "Tu cuenta: email, nombre (si lo escribes), idioma y tema preferidos, el plan, y la fecha y la versión de los términos y de esta política que aceptaste. Si entras con Google o GitHub, recibimos de ellos tu email, tu nombre y tu identificador en ese servicio.",
            "Tu contraseña no la guarda EXEGEZIS: la gestiona nuestro proveedor de autenticación (Supabase), que solo conserva una huella cifrada (hash).",
            "Lo que inspeccionas: las direcciones que nos pides revisar y lo que EXEGEZIS registra al visitarlas como evidencia (capturas de pantalla, contenido de la página, peticiones de red, mensajes de la consola y los tests que genera). Si guardas un acceso a una zona privada, esa sesión se guarda cifrada.",
            "Datos técnicos mínimos: la dirección IP y la fecha de los intentos de inicio de sesión, registro y recuperación, para limitar los abusos.",
          ],
        },
        {
          heading: "Para qué",
          paragraphs: [
            "Para darte el servicio que pides: crear y proteger tu cuenta, hacer las inspecciones, búsquedas e investigaciones, guardar sus resultados y aplicar los límites de tu plan.",
            "No vendemos tus datos, no los usamos para publicidad y no usamos cookies de seguimiento. Solo hay dos tipos de cookies: la de tu sesión (imprescindible) y la de tu idioma.",
          ],
        },
        {
          heading: "Inteligencia artificial",
          paragraphs: [
            "Algunas funciones (búsqueda por significado, planes de prueba) envían texto al proveedor de IA (Anthropic). Antes de enviarlo se eliminan los datos que parecen secretos (contraseñas, tokens, emails). La IA nunca decide un resultado.",
          ],
        },
        {
          heading: "Dónde están y quién más los trata",
          paragraphs: [
            "En la base de datos y la autenticación de Supabase, y en el almacenamiento del servidor donde se ejecuta EXEGEZIS, en una carpeta separada para cada cuenta. Cada cuenta solo puede leer sus propios datos.",
            "Proveedores: Supabase (cuentas y base de datos), el proveedor de alojamiento del servidor y Anthropic (solo para las funciones de IA). Pendiente de revisión legal: la lista definitiva de encargados, sus países y las garantías de las transferencias.",
          ],
        },
        {
          heading: "Cuánto tiempo",
          paragraphs: ["Mientras tengas la cuenta. Cuando la borras, se borran tus datos y tus artefactos. Los registros de intentos de acceso se renuevan en cuestión de horas."],
        },
        {
          heading: "Tus derechos",
          paragraphs: [
            "Puedes ver y corregir tus datos en Ajustes → Cuenta, descargarlos todos en un archivo ZIP y borrar tu cuenta con todo su contenido. Para cualquier otra petición sobre tus datos, escribe a {email}.",
          ],
        },
      ],
    },
    en: {
      title: "Privacy policy",
      summary: "What data EXEGEZIS processes, why, where it is and how you can see it, take it with you or delete it.",
      sections: [
        {
          heading: "What data we process",
          paragraphs: [
            "Your account: email, name (if you type it), preferred language and theme, your plan, and the date and version of the terms and of this policy you accepted. If you sign in with Google or GitHub, they give us your email, your name and your identifier in that service.",
            "EXEGEZIS does not store your password: our authentication provider (Supabase) handles it and keeps only an encrypted fingerprint (hash).",
            "What you inspect: the addresses you ask us to check and what EXEGEZIS records as evidence when visiting them (screenshots, page content, network requests, console messages and the tests it generates). If you save access to a private area, that session is stored encrypted.",
            "Minimal technical data: the IP address and date of sign-in, sign-up and recovery attempts, to limit abuse.",
          ],
        },
        {
          heading: "Why",
          paragraphs: [
            "To give you the service you ask for: create and protect your account, run inspections, searches and investigations, keep their results and apply your plan's limits.",
            "We do not sell your data, we do not use it for advertising and we use no tracking cookies. There are only two kinds of cookies: your session (essential) and your language.",
          ],
        },
        {
          heading: "Artificial intelligence",
          paragraphs: [
            "Some features (search by meaning, test plans) send text to the AI provider (Anthropic). Before sending it, anything that looks like a secret (passwords, tokens, emails) is removed. The AI never decides a result.",
          ],
        },
        {
          heading: "Where it is and who else processes it",
          paragraphs: [
            "In Supabase's database and authentication, and in the storage of the server that runs EXEGEZIS, in a separate folder for each account. Each account can only read its own data.",
            "Providers: Supabase (accounts and database), the server's hosting provider and Anthropic (only for the AI features). Pending legal review: the final list of processors, their countries and the safeguards for transfers.",
          ],
        },
        {
          heading: "How long",
          paragraphs: ["While you have the account. When you delete it, your data and your artifacts are deleted. Records of access attempts expire within hours."],
        },
        {
          heading: "Your rights",
          paragraphs: [
            "You can see and correct your data in Settings → Account, download all of it as a ZIP file and delete your account with everything in it. For any other request about your data, write to {email}.",
          ],
        },
      ],
    },
  },
  terms: {
    es: {
      title: "Términos de uso",
      summary: "Las reglas para usar EXEGEZIS: qué ofrece, qué puedes inspeccionar y qué no.",
      sections: [
        {
          heading: "El servicio",
          paragraphs: [
            "EXEGEZIS revisa sitios web en modo de solo lectura, repite cada comprobación y entrega los problemas que puede demostrar, con su evidencia. Algunas funciones están marcadas como «Próximamente»: todavía no existen.",
          ],
        },
        {
          heading: "Tu cuenta",
          paragraphs: [
            "Necesitas una cuenta con un email que puedas verificar. Eres responsable de lo que se hace con ella: usa una contraseña que no uses en otros sitios y cierra la sesión en los dispositivos que no sean tuyos.",
          ],
        },
        {
          heading: "Qué puedes inspeccionar",
          paragraphs: [
            "Solo sitios que sean tuyos o para los que tengas permiso de quien los controla. EXEGEZIS te pide confirmarlo antes de inspeccionar un dominio por primera vez.",
            "No está permitido: usar EXEGEZIS para atacar, sobrecargar o acceder sin permiso a un sistema; intentar saltarse protecciones anti-bot o controles de acceso; ni usarlo para nada ilegal. EXEGEZIS en la nube no visita direcciones privadas ni internas.",
          ],
        },
        {
          heading: "Planes y límites",
          paragraphs: [
            "Cada cuenta tiene un plan; por defecto, Gratis. Los límites de cada plan (sitios, páginas por inspección, inspecciones al mes, búsqueda por significado) están en la página de precios y se aplican automáticamente. Los planes de pago aún no se pueden contratar: no hay pagos.",
          ],
        },
        {
          heading: "Resultados y responsabilidad",
          paragraphs: [
            "EXEGEZIS solo marca como verificado lo que se reproduce siempre, pero no garantiza encontrar todos los problemas de un sitio. El servicio se ofrece «tal cual». Pendiente de revisión legal: las limitaciones de responsabilidad, la ley aplicable y la jurisdicción.",
          ],
        },
        {
          heading: "Suspensión y cambios",
          paragraphs: [
            "Podemos suspender una cuenta que incumpla estos términos. Si cambian, te lo diremos y te pediremos aceptarlos de nuevo. Puedes borrar tu cuenta cuando quieras desde Ajustes → Cuenta. Contacto: {email}.",
          ],
        },
      ],
    },
    en: {
      title: "Terms of use",
      summary: "The rules for using EXEGEZIS: what it offers, what you may inspect and what not.",
      sections: [
        {
          heading: "The service",
          paragraphs: [
            "EXEGEZIS checks websites in read-only mode, repeats every check and gives you the problems it can prove, with their evidence. Some features are marked «Coming soon»: they do not exist yet.",
          ],
        },
        {
          heading: "Your account",
          paragraphs: [
            "You need an account with an email you can verify. You are responsible for what is done with it: use a password you do not use elsewhere and sign out on devices that are not yours.",
          ],
        },
        {
          heading: "What you may inspect",
          paragraphs: [
            "Only sites that are yours or that you have permission to test from whoever controls them. EXEGEZIS asks you to confirm it before inspecting a domain for the first time.",
            "Not allowed: using EXEGEZIS to attack, overload or access a system without permission; trying to get around anti-bot protections or access controls; or using it for anything illegal. EXEGEZIS in the cloud does not visit private or internal addresses.",
          ],
        },
        {
          heading: "Plans and limits",
          paragraphs: [
            "Each account has a plan; Free by default. Each plan's limits (sites, pages per inspection, inspections a month, search by meaning) are on the pricing page and are applied automatically. Paid plans cannot be bought yet: there are no payments.",
          ],
        },
        {
          heading: "Results and liability",
          paragraphs: [
            "EXEGEZIS only marks as verified what reproduces every time, but it does not guarantee finding every problem of a site. The service is provided «as is». Pending legal review: limitations of liability, governing law and jurisdiction.",
          ],
        },
        {
          heading: "Suspension and changes",
          paragraphs: [
            "We may suspend an account that breaks these terms. If they change, we will tell you and ask you to accept them again. You can delete your account at any time from Settings → Account. Contact: {email}.",
          ],
        },
      ],
    },
  },
};
