import type { ElementTarget } from "@exegezis/core";
import type { Locator, Page } from "playwright";

type AriaRole = Parameters<Page["getByRole"]>[0];

/**
 * Maps a declarative ElementTarget to a Playwright locator. Playwright
 * locators are strict: an action fails if the target matches more than one
 * element, which is what we want for deterministic, replayable actions.
 */
export function toLocator(page: Page, target: ElementTarget): Locator {
  if ("role" in target) {
    return page.getByRole(target.role as AriaRole, {
      ...(target.name === undefined ? {} : { name: target.name }),
      ...(target.exact === undefined ? {} : { exact: target.exact }),
    });
  }
  const exact = "exact" in target && target.exact !== undefined ? { exact: target.exact } : {};
  if ("label" in target) return page.getByLabel(target.label, exact);
  if ("text" in target) return page.getByText(target.text, exact);
  if ("placeholder" in target) return page.getByPlaceholder(target.placeholder, exact);
  if ("testId" in target) return page.getByTestId(target.testId);
  return page.locator(target.css);
}
