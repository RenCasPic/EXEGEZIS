/*
 * Plans, prices, limits and features: the only place they are defined.
 *
 * `available: false` marks what EXEGEZIS does not do yet (the cloud version,
 * accounts and payments, daily monitoring, alerts, integrations, branded
 * reports, the API, SSO…). The page shows it as «Coming soon»: it never
 * promises as available something that does not exist. A test checks it.
 * The words of each feature are in messages/{en,es}.json → pricing.features.<id>.
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

export interface Plan {
  id: PlanId;
  /** USD per month; null: custom price (Enterprise). */
  monthly: number | null;
  /** «Most chosen»: thicker outline and a label. */
  highlighted: boolean;
  cta: "start" | "tryPro" | "startTeam" | "sales";
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
    purchasable: true,
    features: [
      { id: "sites", available: true, values: { count: 1 } },
      { id: "pages", available: true, values: { count: 20 } },
      { id: "inspectionsPerMonth", available: true, values: { count: 5 } },
      { id: "exactSearch", available: true },
      { id: "evidenceReport", available: true },
    ],
  },
  {
    id: "pro",
    monthly: 29,
    highlighted: true,
    cta: "tryPro",
    purchasable: false,
    features: [
      { id: "sites", available: true, values: { count: 5 } },
      { id: "pages", available: true, values: { count: 500 } },
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
    purchasable: false,
    features: [
      { id: "sitesAndUsers", available: false, values: { sites: 25, users: 5 } },
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
