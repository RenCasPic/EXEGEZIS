import { expect, test } from "@playwright/test";

/*
 * Lab ground truth for docs/KNOWN_BUGS.md.
 *
 * Each test asserts the CORRECT behavior and is marked `test.fail()`: it is
 * expected to fail while the bug exists. If someone fixes a bug, its test
 * passes, Playwright reports "expected to fail, but passed", and the lab
 * documentation must be updated. This keeps the lab honest in both directions.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Add Mechanical Keyboard to cart" })).toBeVisible();
});

test("BUG-001: the cart badge reflects removed items", async ({ page }) => {
  test.fail(true, "BUG-001: badge is not updated after removing an item");
  await page.getByRole("button", { name: "Add Wireless Mouse to cart" }).click();
  await expect(page.getByRole("link", { name: "Cart (1)" })).toBeVisible();
  await page.getByRole("button", { name: "Remove Wireless Mouse" }).click();
  await expect(page.getByText("Your cart is empty")).toBeVisible();
  await expect(page.getByRole("link", { name: "Cart (0)" })).toBeVisible({ timeout: 2_000 });
});

test("BUG-002: the coupon discount applies to quantities", async ({ page }) => {
  test.fail(true, "BUG-002: discount ignores quantity");
  const add = page.getByRole("button", { name: "Add Mechanical Keyboard to cart" });
  await add.click();
  await expect(page.locator("#cart-items")).toContainText("× 1");
  await add.click();
  await expect(page.locator("#cart-items")).toContainText("× 2");
  await page.getByLabel("Coupon code").fill("SAVE10");
  await page.getByRole("button", { name: "Apply coupon" }).click();
  await expect(page.getByText("Coupon SAVE10 applied")).toBeVisible();
  // Subtotal $179.80 -> 10% is $17.98.
  await expect(page.locator("#discount")).toHaveText("-$17.98", { timeout: 2_000 });
  await expect(page.locator("#total")).toHaveText("$161.82", { timeout: 2_000 });
});

test("BUG-003: a new order does not include items that were already purchased", async ({ page }) => {
  test.fail(true, "BUG-003: server cart is not cleared after checkout");
  await page.getByRole("button", { name: "Add Mechanical Keyboard to cart" }).click();
  await expect(page.locator("#cart-items")).toContainText("Mechanical Keyboard × 1");
  await page.getByRole("button", { name: "Checkout" }).click();
  await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible();
  await page.getByRole("button", { name: "Continue shopping" }).click();

  await page.getByRole("button", { name: "Add Wireless Mouse to cart" }).click();
  await expect(page.locator("#cart-items")).toContainText("Wireless Mouse × 1");
  await expect(page.locator("#cart-items li")).toHaveCount(1, { timeout: 2_000 });
  await expect(page.locator("#total")).toHaveText("$29.90", { timeout: 2_000 });
});
