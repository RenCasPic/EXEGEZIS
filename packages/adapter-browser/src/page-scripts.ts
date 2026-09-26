import { z } from "zod";

/*
 * Scripts evaluated inside the page during a web inspection. They are plain
 * JavaScript strings (the adapter is compiled without DOM types, so Node code
 * can never touch browser globals by accident) and every result is validated.
 * All of them only READ the page, except the highlight pair, which sets and
 * then restores an outline style for the evidence screenshot.
 */

/** Resolves true once the DOM had no mutation for 500 ms, false at the cap. */
export function domSettleScript(capMs: number): string {
  return `new Promise((resolve) => {
  let quiet;
  const done = () => { observer.disconnect(); resolve(true); };
  const observer = new MutationObserver(() => { clearTimeout(quiet); quiet = setTimeout(done, 500); });
  observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  quiet = setTimeout(done, 500);
  setTimeout(() => { observer.disconnect(); resolve(false); }, ${Math.max(0, Math.floor(capMs))});
})`;
}

export const PAGE_FACTS_SCRIPT = `(() => {
  const text = (document.body ? document.body.innerText : "").slice(0, 5000);
  const markers = [];
  const frames = Array.from(document.querySelectorAll("iframe")).map((f) => f.src || "");
  const framePatterns = [["recaptcha", /recaptcha/i], ["hcaptcha", /hcaptcha/i], ["turnstile", /challenges\\.cloudflare\\.com|turnstile/i]];
  for (const [name, pattern] of framePatterns) if (frames.some((src) => pattern.test(src))) markers.push(name + " iframe");
  for (const selector of [".g-recaptcha", ".h-captcha", ".cf-turnstile", "#challenge-form", "#cf-challenge-running", "#challenge-stage"]) {
    if (document.querySelector(selector) !== null) markers.push(selector);
  }
  const phrases = [
    /verify you are (a )?human/i,
    /checking (if the site connection is secure|your browser)/i,
    /are you a robot/i,
    /attention required/i,
    /access denied/i,
    /enable javascript and cookies to continue/i,
    /just a moment\\.\\.\\./i,
  ];
  for (const phrase of phrases) {
    const match = phrase.exec(text) || phrase.exec(document.title);
    if (match !== null) markers.push("text: " + match[0]);
  }
  const viewport = document.querySelector('meta[name="viewport"]');
  return {
    meta: {
      title: document.title,
      lang: document.documentElement.getAttribute("lang"),
      viewport: viewport === null ? null : viewport.getAttribute("content"),
      h1Count: document.querySelectorAll("h1").length,
      protocol: location.protocol,
    },
    links: Array.from(document.querySelectorAll("a[href]"))
      .map((a) => ({ href: a.href, text: (a.textContent || "").trim().slice(0, 80) }))
      .filter((l) => /^https?:/.test(l.href)),
    markers,
    passwordField: document.querySelector('input[type="password"]') !== null,
  };
})()`;

export const PageFacts = z.object({
  meta: z.object({
    title: z.string(),
    lang: z.string().nullable(),
    viewport: z.string().nullable(),
    h1Count: z.int().nonnegative(),
    protocol: z.string(),
  }),
  links: z.array(z.object({ href: z.string(), text: z.string() })),
  markers: z.array(z.string()),
  passwordField: z.boolean(),
});
export type PageFacts = z.infer<typeof PageFacts>;

export function highlightScript(selectors: readonly string[]): string {
  return `(() => {
  for (const selector of ${JSON.stringify(selectors)}) {
    let element = null;
    try { element = document.querySelector(selector); } catch { element = null; }
    if (element === null) continue;
    element.setAttribute("data-exegezis-highlight", element.style.outline);
    element.style.outline = "3px solid #ff2d55";
  }
})()`;
}

export const UNHIGHLIGHT_SCRIPT = `(() => {
  for (const element of document.querySelectorAll("[data-exegezis-highlight]")) {
    element.style.outline = element.getAttribute("data-exegezis-highlight") || "";
    element.removeAttribute("data-exegezis-highlight");
  }
})()`;
