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

/**
 * Layout facts for the mobile checks, measured on the page as it is shown:
 * sideways overflow and what causes it, touch targets smaller than 24×24 CSS
 * px (WCAG 2.2, 2.5.8; links inside a sentence are exempt), text smaller than
 * 12 px, the meta viewport, and fixed or sticky elements over the screen.
 */
/**
 * Installed before the page's own scripts (inspection mode): records the
 * Largest Contentful Paint, layout shifts (CLS by session windows: gaps under
 * 1 s, windows up to 5 s) and long tasks, for PERF_FACTS_SCRIPT. Top frame only.
 */
export const PERF_OBSERVER_SCRIPT = `(() => {
  if (window.top !== window || window.__exegezisPerf) return;
  const p = (window.__exegezisPerf = { lcp: null, cls: 0, win: 0, winStart: 0, last: 0, long: [] });
  const watch = (type, each) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(each)).observe({ type, buffered: true });
    } catch (e) {}
  };
  watch("largest-contentful-paint", (e) => { p.lcp = e.startTime; });
  watch("layout-shift", (e) => {
    if (e.hadRecentInput) return;
    if (p.win > 0 && e.startTime - p.last < 1000 && e.startTime - p.winStart < 5000) p.win += e.value;
    else { p.win = e.value; p.winStart = e.startTime; }
    p.last = e.startTime;
    if (p.win > p.cls) p.cls = p.win;
  });
  watch("longtask", (e) => { p.long.push([e.startTime, e.duration]); });
})()`;

/**
 * Lab performance of the page, read once it is ready (before axe runs, which
 * makes long tasks of its own): paints, CLS, Total Blocking Time after the
 * first paint, DOMContentLoaded and load, and the images drawn with their
 * file's pixels.
 */
export const PERF_FACTS_SCRIPT = `(() => {
  const p = window.__exegezisPerf || null;
  const nav = performance.getEntriesByType("navigation")[0];
  const paint = performance.getEntriesByName("first-contentful-paint")[0];
  const fcp = paint ? paint.startTime : null;
  const r = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
  let tbt = null;
  if (p) {
    tbt = 0;
    for (const [start, duration] of p.long) {
      const from = fcp === null ? start : Math.max(start, fcp);
      const blocking = start + duration - from - 50;
      if (start + duration > (fcp || 0) && blocking > 0) tbt += Math.min(duration - 50, blocking);
    }
  }
  const images = [];
  for (const img of Array.from(document.images)) {
    if (images.length >= 100) break;
    const src = img.currentSrc || "";
    if (!/^https?:/.test(src) || !img.complete || img.naturalWidth === 0) continue;
    const b = img.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) continue;
    images.push({ url: src, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, width: r(b.width), height: r(b.height) });
  }
  return {
    fcpMs: r(fcp),
    lcpMs: p ? r(p.lcp) : null,
    cls: p ? Math.round(p.cls * 1000) / 1000 : null,
    tbtMs: tbt === null ? null : Math.round(tbt),
    domContentLoadedMs: nav && nav.domContentLoadedEventEnd > 0 ? r(nav.domContentLoadedEventEnd) : null,
    loadMs: nav && nav.loadEventEnd > 0 ? r(nav.loadEventEnd) : null,
    images,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
})()`;

export const LAYOUT_FACTS_SCRIPT = `(() => {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const path = (el) => {
    if (el.id) return "#" + CSS.escape(el.id);
    const parts = [];
    let e = el;
    for (let depth = 0; e && e.nodeType === 1 && e !== document.body && depth < 4; depth++) {
      let part = e.tagName.toLowerCase();
      if (e.id) { parts.unshift("#" + CSS.escape(e.id)); break; }
      const same = e.parentElement ? Array.from(e.parentElement.children).filter((c) => c.tagName === e.tagName) : [];
      if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(e) + 1) + ")";
      parts.unshift(part);
      e = e.parentElement;
    }
    return parts.join(" > ");
  };
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0;
  };
  const label = (el) => (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || el.getAttribute("value") || "").replace(/\\s+/g, " ").trim().slice(0, 60);

  const scrollWidth = document.documentElement.scrollWidth;
  const overflowing = [];
  if (scrollWidth > vw + 1) {
    for (const el of document.body ? document.body.querySelectorAll("*") : []) {
      if (overflowing.length >= 5) break;
      const r = el.getBoundingClientRect();
      if (r.right <= vw + 1 || r.width === 0) continue;
      let clipped = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if (ox !== "visible") { clipped = true; break; }
      }
      if (clipped) continue;
      // Only the outermost element that sticks out.
      if (overflowing.some((o) => o.el.contains(el))) continue;
      overflowing.push({ el, selector: path(el), right: Math.round(r.right) });
    }
  }

  const targets = [];
  const interactive = "a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=checkbox], [role=tab], [onclick]";
  for (const el of document.querySelectorAll(interactive)) {
    if (targets.length >= 30) break;
    if (!shown(el)) continue;
    // A field inside its <label>: the label is what a finger taps.
    const lab = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) ? el.closest("label") : null;
    const r = (lab && shown(lab) ? lab : el).getBoundingClientRect();
    // Compared as recorded (whole pixels): 23.6 px is reported as 24 and is not short.
    if (Math.round(r.width) >= 24 && Math.round(r.height) >= 24) continue;
    // Visually hidden (sr-only, a styled checkbox's real input): not a target on the screen.
    if (r.width < 2 || r.height < 2) continue;
    // WCAG exception: a link inside a sentence or a block of text.
    if (el.tagName === "A") {
      const parent = el.parentElement;
      const text = parent ? (parent.textContent || "").replace(/\\s+/g, " ").trim() : "";
      const own = (el.textContent || "").replace(/\\s+/g, " ").trim();
      if (parent && text.length > own.length + 20 && getComputedStyle(el).display === "inline") continue;
    }
    targets.push({ selector: path(el), width: Math.round(r.width), height: Math.round(r.height), text: label(el) });
  }

  const small = [];
  let smallCount = 0;
  const walker = document.body ? document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT) : null;
  const seen = new Set();
  for (let n = walker ? walker.nextNode() : null; n; n = walker.nextNode()) {
    if ((n.textContent || "").trim().length < 2) continue;
    const el = n.parentElement;
    if (!el || seen.has(el) || !shown(el)) continue;
    seen.add(el);
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (!(size < 12)) continue;
    smallCount++;
    if (small.length < 10) small.push({ selector: path(el), fontSize: Math.round(size * 10) / 10, text: (n.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 60) });
  }

  const meta = document.querySelector('meta[name="viewport" i]');
  const content = meta ? meta.getAttribute("content") || "" : null;
  const parts = {};
  for (const kv of (content || "").split(/[,;]/)) {
    const [k, v] = kv.split("=").map((x) => (x || "").trim().toLowerCase());
    if (k) parts[k] = v || "";
  }
  const maxScale = parts["maximum-scale"] !== undefined ? parseFloat(parts["maximum-scale"]) : null;
  const blocksZoom = parts["user-scalable"] === "no" || parts["user-scalable"] === "0" || (maxScale !== null && !isNaN(maxScale) && maxScale < 2);

  const fixed = [];
  let covered = 0;
  for (const el of document.body ? document.body.querySelectorAll("*") : []) {
    const pos = getComputedStyle(el).position;
    if (pos !== "fixed" && pos !== "sticky") continue;
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    if (w * h === 0) continue;
    if (fixed.some((f) => f.el.contains(el))) continue;
    covered += w * h;
    fixed.push({ el, selector: path(el), position: pos, top: Math.round(r.top), height: Math.round(h), share: Math.round((w * h * 1000) / (vw * vh)) / 1000 });
  }

  return {
    viewport: { width: vw, height: vh },
    scrollWidth,
    overflowing: overflowing.map(({ selector, right }) => ({ selector, right })),
    smallTargets: targets,
    smallText: { count: smallCount, samples: small },
    metaViewport: { content, blocksZoom },
    fixed: { coveredShare: Math.min(1, Math.round((covered * 1000) / Math.max(1, vw * vh)) / 1000), elements: fixed.slice(0, 5).map(({ selector, position, top, height, share }) => ({ selector, position, top, height, share })) },
  };
})()`;

export const PAGE_FACTS_SCRIPT = `(() => {
  const text = (document.body ? document.body.innerText : "").slice(0, 5000);
  const markers = [];
  // A CAPTCHA inside a form with fields of its own (contact, sign-up) belongs to that form: no wall.
  const inForm = (el) => {
    const form = el.closest("form");
    return form !== null && form.querySelectorAll("input:not([type=hidden]):not([type=submit]), textarea, select").length >= 2;
  };
  // Only a CAPTCHA the visitor sees, at a widget's size: the hidden iframes of an invisible
  // reCAPTCHA or of ads (0×0, size=invisible) are no challenge.
  const frames = Array.from(document.querySelectorAll("iframe"))
    .filter((f) => !inForm(f))
    .filter((f) => {
      const r = f.getBoundingClientRect();
      const st = getComputedStyle(f);
      return r.width >= 100 && r.height >= 50 && st.visibility !== "hidden" && st.display !== "none" && !/size=invisible/i.test(f.src || "");
    })
    .map((f) => f.src || "");
  const framePatterns = [["recaptcha", /recaptcha/i], ["hcaptcha", /hcaptcha/i], ["turnstile", /challenges\\.cloudflare\\.com|turnstile/i]];
  for (const [name, pattern] of framePatterns) if (frames.some((src) => pattern.test(src))) markers.push(name + " iframe");
  const dd = frames.some((src) => /captcha-delivery\\.com/i.test(src));
  if (dd) markers.push("datadome iframe");
  for (const selector of [".g-recaptcha", ".h-captcha", ".cf-turnstile", "#challenge-form", "#cf-challenge-running", "#challenge-stage", "#px-captcha"]) {
    const found = document.querySelector(selector);
    if (found !== null && !inForm(found)) markers.push(selector);
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
      cspMeta: (document.querySelector('meta[http-equiv="Content-Security-Policy" i]') || {}).content || null,
      referrerMeta: (document.querySelector('meta[name="referrer" i]') || {}).content || null,
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
    cspMeta: z.string().nullable(),
    referrerMeta: z.string().nullable(),
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
