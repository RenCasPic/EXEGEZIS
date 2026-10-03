import { ENGINE_MESSAGES, ENGINE_MESSAGES_EN } from "@exegezis/core";
import type { Locale } from "./locales";
import enCommon from "../../messages/en/common.json";
import enShell from "../../messages/en/shell.json";
import enHome from "../../messages/en/home.json";
import enInspections from "../../messages/en/inspections.json";
import enSearches from "../../messages/en/searches.json";
import enInvestigations from "../../messages/en/investigations.json";
import enReproductions from "../../messages/en/reproductions.json";
import enPlanner from "../../messages/en/planner.json";
import enRootCauses from "../../messages/en/rootCauses.json";
import enFixes from "../../messages/en/fixes.json";
import enBenchmarks from "../../messages/en/benchmarks.json";
import enProjects from "../../messages/en/projects.json";
import enOverview from "../../messages/en/overview.json";
import enSettings from "../../messages/en/settings.json";
import enAccess from "../../messages/en/access.json";
import enJobs from "../../messages/en/jobs.json";
import enLabels from "../../messages/en/labels.json";
import enEvidence from "../../messages/en/evidence.json";
import enAccount from "../../messages/en/account.json";
import esCommon from "../../messages/es/common.json";
import esShell from "../../messages/es/shell.json";
import esHome from "../../messages/es/home.json";
import esInspections from "../../messages/es/inspections.json";
import esSearches from "../../messages/es/searches.json";
import esInvestigations from "../../messages/es/investigations.json";
import esReproductions from "../../messages/es/reproductions.json";
import esPlanner from "../../messages/es/planner.json";
import esRootCauses from "../../messages/es/rootCauses.json";
import esFixes from "../../messages/es/fixes.json";
import esBenchmarks from "../../messages/es/benchmarks.json";
import esProjects from "../../messages/es/projects.json";
import esOverview from "../../messages/es/overview.json";
import esSettings from "../../messages/es/settings.json";
import esAccess from "../../messages/es/access.json";
import esJobs from "../../messages/es/jobs.json";
import esLabels from "../../messages/es/labels.json";
import esEvidence from "../../messages/es/evidence.json";
import esAccount from "../../messages/es/account.json";

/**
 * The catalogs, one file per area and language (apps/web/messages/<locale>/<area>.json),
 * merged into one object per language. A test checks that both languages have
 * exactly the same keys and no empty text. The engine's messages come from
 * @exegezis/core, the one catalog the engine, the CLI and the web share.
 */
export const AREAS = ["common", "shell", "home", "inspections", "searches", "investigations", "reproductions", "planner", "rootCauses", "fixes", "benchmarks", "projects", "overview", "settings", "access", "jobs", "labels", "evidence", "account"] as const;

const EN = { engine: ENGINE_MESSAGES_EN, common: enCommon, shell: enShell, home: enHome, inspections: enInspections, searches: enSearches, investigations: enInvestigations, reproductions: enReproductions, planner: enPlanner, rootCauses: enRootCauses, fixes: enFixes, benchmarks: enBenchmarks, projects: enProjects, overview: enOverview, settings: enSettings, access: enAccess, jobs: enJobs, labels: enLabels, evidence: enEvidence, account: enAccount };
const ES = { engine: ENGINE_MESSAGES.es, common: esCommon, shell: esShell, home: esHome, inspections: esInspections, searches: esSearches, investigations: esInvestigations, reproductions: esReproductions, planner: esPlanner, rootCauses: esRootCauses, fixes: esFixes, benchmarks: esBenchmarks, projects: esProjects, overview: esOverview, settings: esSettings, access: esAccess, jobs: esJobs, labels: esLabels, evidence: esEvidence, account: esAccount };

export type Messages = typeof EN;

export function loadMessages(locale: Locale): Messages {
  return (locale === "es" ? ES : EN) as unknown as Messages;
}

export const CATALOGS: Record<Locale, unknown> = { en: EN, es: ES };
