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

/** The page shows its main content: parsed, with a visible main region, heading or text. */
export const MAIN_VISIBLE_SCRIPT = `(() => {
  if (document.readyState === "loading" || document.body === null) return false;
  const visible = (el) => {
    if (el === null) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0;
  };
  if (visible(document.querySelector("main, [role=main]")) || visible(document.querySelector("h1"))) return true;
  return document.body.innerText.trim().length > 0;
})()`;

/** Resolves when the page's main thread has a moment free (two idle callbacks in a row), at most 2 s. */
export const MAIN_THREAD_IDLE_SCRIPT = `new Promise((resolve) => {
  if (typeof requestIdleCallback !== "function") { setTimeout(() => resolve(true), 50); return; }
  const cap = setTimeout(() => resolve(false), 2000);
  requestIdleCallback(() => requestIdleCallback(() => { clearTimeout(cap); resolve(true); }, { timeout: 2000 }), { timeout: 2000 });
})`;

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

/**
 * Search extraction (docs/10-search.md §1): the rendered text of the page in
 * blocks (headings, paragraphs, list items, cells, buttons, links…), each
 * with a selector, its position in page coordinates and whether a visitor can
 * see it; then alt / title / aria-label attributes, and the title, meta
 * description and Open Graph text. Hidden text (closed accordion, hidden tab,
 * display:none, aria-hidden) is kept apart and marked, unless left out.
 */
export function textBlocksScript(includeHidden: boolean, maxBlocks = 4000, maxText = 4000): string {
  return String.raw`(() => {
  const INCLUDE_HIDDEN = ${includeHidden ? "true" : "false"};
  const MAX_BLOCKS = ${Math.max(1, Math.floor(maxBlocks))};
  const MAX_TEXT = ${Math.max(1, Math.floor(maxText))};
  const CONTAINER = new Set(["H1","H2","H3","H4","H5","H6","P","LI","TD","TH","DT","DD","BLOCKQUOTE","FIGCAPTION","CAPTION","SUMMARY","LABEL","BUTTON","PRE","OPTION","LEGEND","DIV","SECTION","ARTICLE","MAIN","HEADER","FOOTER","ASIDE","NAV","FORM","BODY","UL","OL","DL","TABLE","TR","TBODY","THEAD","TFOOT","FIGURE","DETAILS","DIALOG","ADDRESS","CENTER","FIELDSET","HGROUP"]);
  const KIND = { P: "paragraph", LI: "list-item", TD: "cell", TH: "cell", BLOCKQUOTE: "quote", LABEL: "label", BUTTON: "button", SUMMARY: "button", OPTION: "text" };
  const cssPath = (el) => {
    if (el === document.body) return "body";
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.body && cur !== document.documentElement && parts.length < 30) {
      if (cur.id && /^[A-Za-z][\w-]*$/.test(cur.id) && document.querySelectorAll("#" + cur.id).length === 1) {
        parts.unshift("#" + cur.id);
        return parts.join(" > ");
      }
      const tag = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (!parent) { parts.unshift(tag); break; }
      const same = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
      parts.unshift(same.length > 1 ? tag + ":nth-of-type(" + (same.indexOf(cur) + 1) + ")" : tag);
      cur = parent;
    }
    if (cur === document.body) parts.unshift("body");
    return parts.join(" > ");
  };
  const visible = (el) => {
    if (el.closest('[aria-hidden="true"]') !== null) return false;
    if (typeof el.checkVisibility === "function" && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const clean = (s) => s.replace(/\s+/g, " ").trim();
  let truncated = false;
  const blocks = [];
  const push = (b) => {
    if (blocks.length >= MAX_BLOCKS) { truncated = true; return; }
    let text = clean(b.text);
    if (text === "") return;
    if (text.length > MAX_TEXT) { text = text.slice(0, MAX_TEXT); truncated = true; }
    blocks.push({ id: "b" + (blocks.length + 1), kind: b.kind, level: b.level, text, selector: b.selector, rect: b.rect, visible: b.visible, source: b.source });
  };

  // Rendered text, grouped by the nearest block container and by visibility.
  const groups = new Map();
  const order = [];
  let seq = 0;
  if (document.body) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (parent === null || parent.closest("script, style, noscript, template, svg, iframe, object, canvas") !== null) return NodeFilter.FILTER_REJECT;
        return /\S/.test(node.nodeValue || "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = node.parentElement;
      let container = parent;
      while (container !== null && !CONTAINER.has(container.tagName)) container = container.parentElement;
      if (container === null) container = document.body;
      const isVisible = visible(parent);
      if (!isVisible && !INCLUDE_HIDDEN) continue;
      let group = groups.get(container);
      if (group === undefined) {
        group = { visible: null, hidden: null };
        groups.set(container, group);
      }
      const slot = isVisible ? "visible" : "hidden";
      if (group[slot] === null) {
        group[slot] = { parts: [], anchors: new Set(), plain: false, last: -2 };
        order.push([container, slot]);
      }
      const g = group[slot];
      // Adjacent text nodes join as written (inline markup does not split words); a <br> or another block in between is a space.
      const breakBefore = node.previousSibling !== null && node.previousSibling.nodeName === "BR";
      g.parts.push((breakBefore ? "\n" : g.last === seq - 1 ? "" : " ") + (node.nodeValue || ""));
      g.last = seq;
      seq += 1;
      const anchor = parent.closest("a");
      if (anchor === null || !container.contains(anchor) && !anchor.contains(container)) g.plain = true;
      else g.anchors.add(anchor);
    }
  }
  for (const [container, slot] of order) {
    const g = groups.get(container)[slot];
    const tag = container.tagName;
    const heading = /^H[1-6]$/.test(tag);
    const kind = heading ? "heading" : KIND[tag] !== undefined ? KIND[tag] : !g.plain && g.anchors.size === 1 ? "link" : "text";
    const isVisible = slot === "visible";
    const text = g.parts.join("").replace(/^\s+/, "");
    push({ kind, level: heading ? Number(tag.slice(1)) : null, text, selector: cssPath(container), rect: isVisible ? rectOf(container) : null, visible: isVisible, source: null });
  }

  // Attributes: alternative text, titles and ARIA labels.
  const ATTRS = [["alt", "alt", "img[alt], area[alt], input[type=image][alt]"], ["title-attr", "title", "body [title]"], ["aria-label", "aria-label", "[aria-label]"]];
  for (const [kind, attr, selector] of ATTRS) {
    for (const el of Array.from(document.querySelectorAll(selector))) {
      const text = el.getAttribute(attr) || "";
      if (!/\S/.test(text)) continue;
      const isVisible = visible(el);
      if (!isVisible && !INCLUDE_HIDDEN) continue;
      push({ kind, level: null, text, selector: cssPath(el), rect: isVisible ? rectOf(el) : null, visible: isVisible, source: attr });
    }
  }

  // Page metadata: what search engines and social networks show.
  push({ kind: "meta-title", level: null, text: document.title || "", selector: null, rect: null, visible: false, source: "title" });
  const description = document.querySelector('meta[name="description" i]');
  if (description !== null) push({ kind: "meta-description", level: null, text: description.getAttribute("content") || "", selector: null, rect: null, visible: false, source: "description" });
  for (const meta of Array.from(document.querySelectorAll('meta[property^="og:"]'))) {
    const property = meta.getAttribute("property") || "";
    if (!/^og:(title|description|site_name|image:alt)$/.test(property)) continue;
    push({ kind: "og", level: null, text: meta.getAttribute("content") || "", selector: null, rect: null, visible: false, source: property });
  }
  return { lang: document.documentElement.getAttribute("lang"), title: document.title || "", blocks, truncated };
})()`;
}
