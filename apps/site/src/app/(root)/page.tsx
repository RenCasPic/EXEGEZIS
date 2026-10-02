import { LOCALE_NAME, LOCALE_STORAGE_KEY, LOCALES } from "@/i18n/locales";

/*
 * The visitor's language: their earlier choice in this browser, else the
 * first supported language of the browser, else English. A static site has
 * no server to read Accept-Language, so the browser decides, before paint.
 */
const REDIRECT = `(function(){var l=null;try{l=localStorage.getItem(${JSON.stringify(LOCALE_STORAGE_KEY)})}catch(e){}
var ok=${JSON.stringify(LOCALES)};if(ok.indexOf(l)<0){l="en";var n=navigator.languages||[navigator.language||""];
for(var i=0;i<n.length;i++){var b=String(n[i]).toLowerCase().split("-")[0];if(ok.indexOf(b)>=0){l=b;break}}}
location.replace("/"+l+"/"+location.hash)})();`;

export default function RootPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <script dangerouslySetInnerHTML={{ __html: REDIRECT }} />
      <p className="font-mono text-sm tracking-[0.18em] text-heading">EXEGEZIS</p>
      <ul className="flex gap-4">
        {LOCALES.map((l) => (
          <li key={l}>
            <a href={`/${l}/`} lang={l} className="text-accent-text underline">
              {LOCALE_NAME[l]}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
