import { expect, test, type APIRequestContext } from "@playwright/test";

async function newSession(request: APIRequestContext): Promise<Record<string, string>> {
  const response = await request.post("/api/session");
  expect(response.status()).toBe(201);
  const { token } = (await response.json()) as { token: string };
  return { authorization: `Bearer ${token}` };
}

test("lists the catalog", async ({ request }) => {
  const response = await request.get("/api/products");
  expect(response.ok()).toBe(true);
  const products = (await response.json()) as { id: string }[];
  expect(products.map((p) => p.id)).toEqual(["keyboard", "mouse", "monitor"]);
});

test("rejects cart access without a session", async ({ request }) => {
  const response = await request.get("/api/cart");
  expect(response.status()).toBe(401);
});

test("adds an item to the cart", async ({ request }) => {
  const headers = await newSession(request);
  const response = await request.post("/api/cart/items", { headers, data: { productId: "keyboard", quantity: 1 } });
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ itemCount: 1, subtotalCents: 8990, totalCents: 8990 });
});

test("applies a 10% coupon", async ({ request }) => {
  const headers = await newSession(request);
  await request.post("/api/cart/items", { headers, data: { productId: "keyboard", quantity: 1 } });
  const response = await request.post("/api/cart/coupon", { headers, data: { code: "SAVE10" } });
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ coupon: "SAVE10", subtotalCents: 8990, discountCents: 899, totalCents: 8091 });
});

test("rejects an unknown coupon", async ({ request }) => {
  const headers = await newSession(request);
  const response = await request.post("/api/cart/coupon", { headers, data: { code: "FREE100" } });
  expect(response.status()).toBe(400);
});

test("clears the cart", async ({ request }) => {
  const headers = await newSession(request);
  await request.post("/api/cart/items", { headers, data: { productId: "mouse", quantity: 1 } });
  const response = await request.delete("/api/cart", { headers });
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ items: [], itemCount: 0, totalCents: 0 });
});

test("places an order", async ({ request }) => {
  const headers = await newSession(request);
  await request.post("/api/cart/items", { headers, data: { productId: "mouse", quantity: 1 } });
  const response = await request.post("/api/checkout", { headers });
  expect(response.status()).toBe(201);
  expect(await response.json()).toMatchObject({ id: expect.stringMatching(/^ORD-\d+$/), totalCents: 2990 });
});

test("refuses to check out an empty cart", async ({ request }) => {
  const headers = await newSession(request);
  const response = await request.post("/api/checkout", { headers });
  expect(response.status()).toBe(400);
});
