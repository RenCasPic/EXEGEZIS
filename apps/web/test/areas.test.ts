import { medianRange, organizeGroups, rate, zoneOfGroup, zoneOfSelector } from "@exegezis/core";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { CATALOGS } from "../src/i18n/messages";
import { findingTitle, type InspectionsT } from "../src/lib/issue-labels";
import { buildAreasReport, buildReport } from "./inspection-fixture";

const count = (report: ReturnType<typeof buildAreasReport>) =>
  Object.fromEntries(
    organizeGroups(report.groups, report.findings).flatMap((a) => [
      [a.area, `${a.problems} ${a.worst ?? "-"}`],
      ...a.subareas.filter((s) => s.groups.length > 0).map((s) => [`${a.area}.${s.subarea}`, s.groups.map((g) => g.checkId).join(",")]),
    ]),
  );

describe("Frontend and Backend", () => {
  it("every problem in its area and subarea; another site's resource is an external service", () => {
    expect(count(buildAreasReport())).toEqual({
      frontend: "4 serious",
      "frontend.design": "a11y",
      "frontend.performance": "perf-vitals",
      "frontend.mobile": "mobile-tap-targets",
      "frontend.external": "heavy-resources",
      backend: "2 moderate",
      "backend.security": "security-headers",
      "backend.config": "site-config",
    });
  });

  it("an older report (v1, before the map) is organized the same way when it loads", () => {
    expect(count(buildReport())).toEqual({ frontend: "0 -", backend: "1 serious", "backend.responses": "failed-requests,failed-requests" });
  });

  it("keeps each problem's zone of the page", () => {
    expect(zoneOfSelector("header > nav > ul > li > a")).toBe("menu");
    expect(zoneOfSelector("footer > div > p > a")).toBe("footer");
    expect(zoneOfSelector("main > section > img")).toBe("content");
    expect(zoneOfSelector("div > span")).toBeNull();
    const report = buildAreasReport();
    const a11y = report.findings.filter((f) => f.checkId === "a11y");
    expect(zoneOfGroup(a11y)).toBe("menu");
    expect(zoneOfGroup(report.findings.filter((f) => f.checkId === "security-headers"))).toBeNull();
  });

  it("metrics as a median with their range, rated by Google's thresholds", () => {
    expect(medianRange([3, null, 1, 2])).toEqual({ median: 2, min: 1, max: 3, n: 3 });
    expect(medianRange([null])).toBeNull();
    expect([rate("lcpMs", 2400), rate("lcpMs", 3000), rate("lcpMs", 4100)]).toEqual(["good", "needs-improvement", "poor"]);
    expect([rate("cls", 0.1), rate("cls", 0.26)]).toEqual(["good", "poor"]);
  });
});

describe("the new checks' titles in Spanish", () => {
  const es = createTranslator({ locale: "es", messages: CATALOGS.es as never, namespace: "inspections" as never }) as unknown as InspectionsT;
  it.each([
    ["security-headers", "No Content-Security-Policy", "Sin Content-Security-Policy"],
    ["cookies", "Session cookie PHPSESSID without HttpOnly", "Cookie de sesión PHPSESSID sin HttpOnly"],
    ["slow-response", "The server takes 2.4 s to start answering (poor: over 1.8 s)", "El servidor tarda 2.4 s en empezar a responder (malo: más de 1,8 s)"],
    ["perf-vitals", "Total Blocking Time 900 ms (poor: over 600 ms)", "Total Blocking Time de 900 ms (malo: más de 600 ms)"],
    ["heavy-resources", "Image of 420 KB: hero.jpg", "Imagen de 420 KB: hero.jpg"],
    ["https", "The HTTPS certificate expires in 12 days", "El certificado HTTPS caduca en 12 días"],
    ["https", "The HTTPS certificate expires in 1 days", "El certificado HTTPS caduca en 1 día"],
    ["site-config", "The sitemap lists /gone, which answers 404", "El sitemap incluye /gone, que responde 404"],
    ["site-config", "Missing pages answer 200 («soft 404»)", "Las páginas que no existen responden 200 («soft 404»)"],
  ])("%s: %s", (check, en, translated) => {
    expect(findingTitle(es, "es", check, en)).toBe(translated);
  });
});
