/*
 * Plans, prices, limits and features: the only place they are defined.
 *
 * `available: false` marks what EXEGEZIS does not do yet (the cloud version,
 * accounts and payments, daily monitoring, alerts, integrations, branded
 * reports, the API, SSO…). The page shows it as «Coming soon»: it never
 * promises as available something that does not exist. A test checks it.
 * The words of each feature are in messages/{en,es}.json → pricing.features.<id>.
 *
 * The landing (apps/web/src/site, /producto) shows these
 * plans, and the app (apps/web, cloud mode) enforces `limits` on the server.
 * The numbers on the cards come from the same `limits`.
 */

export type PlanId = "free" | "pro" | "team" | "enterprise";

export interface PlanFeature {
  /** Key of pricing.features.<id> in the catalogs. */
  id: string;
  /** Does EXEGEZIS do this today? */
  available: boolean;
  /** Values for the text (limits). */
  values?: Record<string, number>;
}

/** What a plan allows. null: no limit. Enforced by the app on the server (cloud mode). */
export interface PlanLimits {
  /** Different sites (hosts) inspected or searched. */
  sites: number | null;
  /** Pages per inspection or search (--max-pages). */
  pagesPerInspection: number | null;
  /** Inspections started per calendar month (UTC). */
  inspectionsPerMonth: number | null;
  /** Search by meaning (uses AI). */
  meaningSearch: boolean;
  /**
   * AI balance per calendar month, in USD (search by meaning, AI plans).
   * TODO: the landing only says «AI balance included»; confirm these amounts.
   */
  aiBalanceUsd: number | null;
}

export const LIMITS = {
  free: { sites: 1, pagesPerInspection: 20, inspectionsPerMonth: 5, meaningSearch: false, aiBalanceUsd: 0 },
  pro: { sites: 5, pagesPerInspection: 500, inspectionsPerMonth: null, meaningSearch: true, aiBalanceUsd: 5 },
  team: { sites: 25, pagesPerInspection: 500, inspectionsPerMonth: null, meaningSearch: true, aiBalanceUsd: 20 },
  enterprise: { sites: null, pagesPerInspection: null, inspectionsPerMonth: null, meaningSearch: true, aiBalanceUsd: null },
} as const satisfies Record<PlanId, PlanLimits>;

/** Users on a team plan (shown on the card; teams with several users are not built yet). */
export const TEAM_USERS = 5;

export const PLAN_IDS: readonly PlanId[] = ["free", "pro", "team", "enterprise"];

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

export interface Plan {
  id: PlanId;
  /** USD per month; null: custom price (Enterprise). */
  monthly: number | null;
  /** «Most chosen»: thicker outline and a label. */
  highlighted: boolean;
  cta: "start" | "tryPro" | "startTeam" | "sales";
  limits: PlanLimits;
  /**
   * Paying needs accounts and payments, which do not exist yet: a paid plan
   * says so next to its price («Coming soon»), whatever its features.
   */
  purchasable: boolean;
  features: PlanFeature[];
}

export const PLANS: readonly Plan[] = [
  {
    id: "free",
    monthly: 0,
    highlighted: false,
    cta: "start",
    limits: LIMITS.free,
    purchasable: true,
    features: [
      { id: "sites", available: true, values: { count: LIMITS.free.sites } },
      { id: "pages", available: true, values: { count: LIMITS.free.pagesPerInspection } },
      { id: "inspectionsPerMonth", available: true, values: { count: LIMITS.free.inspectionsPerMonth } },
      { id: "exactSearch", available: true },
      { id: "evidenceReport", available: true },
    ],
  },
  {
    id: "pro",
    monthly: 29,
    highlighted: true,
    cta: "tryPro",
    limits: LIMITS.pro,
    purchasable: false,
    features: [
      { id: "sites", available: true, values: { count: LIMITS.pro.sites } },
      { id: "pages", available: true, values: { count: LIMITS.pro.pagesPerInspection } },
      { id: "dailyMonitoring", available: false },
      { id: "meaningSearch", available: true },
      { id: "privateAreas", available: true },
      { id: "exports", available: true },
    ],
  },
  {
    id: "team",
    monthly: 99,
    highlighted: false,
    cta: "startTeam",
    limits: LIMITS.team,
    purchasable: false,
    features: [
      { id: "sitesAndUsers", available: false, values: { sites: LIMITS.team.sites, users: TEAM_USERS } },
      { id: "everythingInPro", available: true },
      { id: "brandedReports", available: false },
      { id: "integrations", available: false },
      { id: "apiAndChecks", available: false },
      { id: "sharedTemplates", available: false },
    ],
  },
  {
    id: "enterprise",
    monthly: null,
    highlighted: false,
    cta: "sales",
    limits: LIMITS.enterprise,
    purchasable: false,
    features: [
      { id: "customSitesAndUsers", available: false },
      { id: "sso", available: false },
      { id: "complianceReports", available: false },
      { id: "selfHosted", available: false },
      { id: "prioritySupport", available: false },
    ],
  },
];

/** Annual billing: two months free (10 months for 12). */
export const ANNUAL_MONTHS_PAID = 10;

/** The monthly price shown with annual billing: price × 10 / 12, rounded. */
export function annualMonthly(monthly: number): number {
  return Math.round((monthly * ANNUAL_MONTHS_PAID) / 12);
}

/** What a year costs with annual billing. */
export function annualTotal(monthly: number): number {
  return monthly * ANNUAL_MONTHS_PAID;
}
