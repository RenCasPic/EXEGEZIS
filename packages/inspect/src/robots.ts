/**
 * robots.txt, the part that matters here: the Disallow / Allow rules of the
 * groups that apply to every agent (`*`) or to EXEGEZIS by name. Longest
 * match wins, Allow wins ties (RFC 9309). Wildcards `*` and `$` are supported.
 */
export interface RobotsRules {
  allow: string[];
  disallow: string[];
}

export function parseRobots(text: string, agent = "exegezis-inspector"): RobotsRules {
  const rules: RobotsRules = { allow: [], disallow: [] };
  let groupAgents: string[] = [];
  let inRules = false;
  let applies = false;
  const specific: RobotsRules = { allow: [], disallow: [] };
  let specificFound = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line === "") continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (inRules) {
        groupAgents = [];
        inRules = false;
      }
      groupAgents.push(value.toLowerCase());
      applies = groupAgents.includes("*") || groupAgents.some((a) => a !== "*" && agent.startsWith(a));
      continue;
    }
    if (key !== "allow" && key !== "disallow") continue;
    inRules = true;
    if (!applies || value === "") continue;
    if (groupAgents.some((a) => a !== "*" && agent.startsWith(a))) {
      specificFound = true;
      specific[key].push(value);
    } else {
      rules[key].push(value);
    }
  }
  return specificFound ? specific : rules;
}

function matches(path: string, rule: string): boolean {
  const anchored = rule.endsWith("$");
  const body = (anchored ? rule.slice(0, -1) : rule).split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}

export function isAllowed(rules: RobotsRules, url: string): boolean {
  const u = new URL(url);
  const path = `${u.pathname}${u.search}`;
  const longest = (list: string[]) => Math.max(-1, ...list.filter((r) => matches(path, r)).map((r) => r.length));
  const allow = longest(rules.allow);
  const disallow = longest(rules.disallow);
  return disallow < 0 || allow >= disallow;
}
