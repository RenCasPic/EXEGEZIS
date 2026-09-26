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
  const dd = frames.some((src) => /captcha-delivery\\.com/i.test(src));
  if (dd) markers.push("datadome iframe");
  for (const selector of [".g-recaptcha", ".h-captcha", ".cf-turnstile", "#challenge-form", "#cf-challenge-running", "#challenge-stage", "#px-captcha"]) {
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
    /access denied[\\s\\S]{0,200}reference #[0-9a-f.]+/i,
  ];
  for (const phrase of phrases) {
    const match = phrase.exec(text) || phrase.exec(document.title);
    if (match !== null) markers.push("text: " + match[0]);
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none" && st.opacity !== "0";
  };
  const words = (el) => (el ? (el.textContent || "").trim().split(/\\s+/).filter(Boolean).length : 0);
  // Login: a visible password field, and how much of the page is something else.
  const visiblePassword = Array.from(document.querySelectorAll('input[type="password"]')).some(visible);
  let wordsOutsideForms = 0;
  if (document.body) {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll("form, script, style, noscript, template, nav, header, footer").forEach((e) => e.remove());
    wordsOutsideForms = words(clone);
  }
  const mainContent = Array.from(document.querySelectorAll("main, article, [role=main]")).some((el) => {
    const c = el.cloneNode(true);
    c.querySelectorAll("form, script, style").forEach((f) => f.remove());
    return words(c) >= 40;
  });
  // Consent: a known consent manager, or a fixed element about cookies; how much of the viewport it covers.
  const vw = window.innerWidth || 1;
  const vh = window.innerHeight || 1;
  const coverage = (el) => {
    const r = el.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    return (w * h) / (vw * vh);
  };
  const vendors = [
    ["OneTrust", "#onetrust-banner-sdk, #onetrust-pc-sdk"],
    ["Cookiebot", "#CybotCookiebotDialog"],
    ["Didomi", "#didomi-popup, #didomi-notice"],
    ["Usercentrics", "#usercentrics-root, #usercentrics-cmp-ui"],
    ["Quantcast", ".qc-cmp2-container"],
    ["TrustArc", "#truste-consent-track, .truste_box_overlay"],
    ["CookieYes", ".cky-consent-container"],
    ["Complianz", ".cmplz-cookiebanner"],
  ];
  let consent = null;
  for (const [vendor, selector] of vendors) {
    const el = document.querySelector(selector);
    if (el !== null && visible(el)) {
      consent = { vendor, coverage: Math.round(coverage(el) * 100) / 100 };
      break;
    }
  }
  if (consent === null) {
    const candidates = Array.from(document.querySelectorAll("div, section, aside, dialog, [role=dialog], [role=alertdialog]")).slice(0, 4000);
    for (const el of candidates) {
      const st = getComputedStyle(el);
      if (st.position !== "fixed" && st.position !== "sticky") continue;
      if (!visible(el) || !/cookie|consent|consentimiento|galleta|gdpr/i.test((el.textContent || "").slice(0, 2000))) continue;
      const c = Math.round(coverage(el) * 100) / 100;
      if (consent === null || c > consent.coverage) consent = { vendor: null, coverage: c };
    }
  }
  const locked = (el) => el !== null && (getComputedStyle(el).overflow === "hidden" || getComputedStyle(el).overflowY === "hidden");
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
    login: { visiblePassword, wordsOutsideForms, mainContent },
    consent: consent === null ? null : { vendor: consent.vendor, coverage: consent.coverage, scrollLocked: locked(document.body) || locked(document.documentElement) },
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
  login: z.object({ visiblePassword: z.boolean(), wordsOutsideForms: z.int().nonnegative(), mainContent: z.boolean() }),
  consent: z.object({ vendor: z.string().nullable(), coverage: z.number(), scrollLocked: z.boolean() }).nullable(),
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
