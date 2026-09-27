import { describe, expect, it } from "vitest";
import { filterHref } from "../src/lib/filter-query";

describe("filter forms", () => {
  it("builds the filtered URL from the typed text, keeping the other filters", () => {
    expect(filterHref("/investigations", [["status", "verified"], ["source", ""], ["q", "coupon"]], "")).toBe("/investigations?status=verified&q=coupon");
    expect(filterHref("/investigations", [["q", "  coupon  "]], "")).toBe("/investigations?q=coupon");
  });

  it("clearing the text goes back to the unfiltered list", () => {
    expect(filterHref("/investigations", [["q", ""]], "q=coupon")).toBe("/investigations");
  });

  it("does not navigate when nothing changed", () => {
    expect(filterHref("/investigations", [["q", "coupon"]], "q=coupon")).toBeNull();
  });
});
