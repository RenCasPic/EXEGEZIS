import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Add Mechanical Keyboard to cart" })).toBeVisible();
});

test("shows the catalog and an empty cart", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
  await expect(page.getByText("Your cart is empty")).toBeVisible();
  await expect(page.getByRole("link", { name: "Cart (0)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Checkout" })).toBeDisabled();
});

test("adding a product updates the cart and the badge", async ({ page }) => {
  await page.getByRole("button", { name: "Add Mechanical Keyboard to cart" }).click();
  await expect(page.locator("#cart-items")).toContainText("Mechanical Keyboard × 1");
  await expect(page.getByRole("link", { name: "Cart (1)" })).toBeVisible();
  await expect(page.locator("#total")).toHaveText("$89.90");
});

test("removing a product empties the cart", async ({ page }) => {
  await page.getByRole("button", { name: "Add Wireless Mouse to cart" }).click();
  await expect(page.locator("#cart-items")).toContainText("Wireless Mouse × 1");
  await page.getByRole("button", { name: "Remove Wireless Mouse" }).click();
  await expect(page.getByText("Your cart is empty")).toBeVisible();
  await expect(page.locator("#total")).toHaveText("$0.00");
});

test("applying a coupon shows the discount", async ({ page }) => {
  await page.getByRole("button", { name: "Add Mechanical Keyboard to cart" }).click();
  await page.getByLabel("Coupon code").fill("SAVE10");
  await page.getByRole("button", { name: "Apply coupon" }).click();
  await expect(page.getByText("Coupon SAVE10 applied")).toBeVisible();
  await expect(page.locator("#discount")).toHaveText("-$8.99");
  await expect(page.locator("#total")).toHaveText("$80.91");
});

test("checkout shows an order confirmation", async ({ page }) => {
  await page.getByRole("button", { name: "Add Wireless Mouse to cart" }).click();
  await page.getByRole("button", { name: "Checkout" }).click();
  await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible();
  await expect(page.locator("#confirmation-text")).toContainText("Total $29.90");
  await expect(page.getByText("Your cart is empty")).toBeVisible();
});
