// Buggy Shop UI. Plain browser JavaScript, no build step.

const TOKEN_KEY = "buggy-shop-token";

const state = {
  token: null,
  products: [],
};

const $ = (id) => document.getElementById(id);

function formatMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
      ...options.headers,
    },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

async function ensureSession() {
  const saved = sessionStorage.getItem(TOKEN_KEY);
  if (saved) {
    state.token = saved;
    return;
  }
  const { token } = await api("/api/session", { method: "POST" });
  state.token = token;
  sessionStorage.setItem(TOKEN_KEY, token);
}

function renderProducts() {
  const list = $("product-list");
  list.replaceChildren(
    ...state.products.map((product) => {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `${product.name} — ${formatMoney(product.priceCents)}`;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Add to cart";
      button.setAttribute("aria-label", `Add ${product.name} to cart`);
      button.addEventListener("click", () => addToCart(product.id));
      item.append(label, button);
      return item;
    }),
  );
}

function renderCart(cart) {
  const list = $("cart-items");
  list.replaceChildren(
    ...cart.items.map((item) => {
      const row = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `${item.name} × ${item.quantity} — ${formatMoney(item.lineTotalCents)}`;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Remove";
      button.setAttribute("aria-label", `Remove ${item.name}`);
      button.addEventListener("click", () => removeFromCart(item.productId));
      row.append(label, button);
      return row;
    }),
  );
  $("cart-empty").hidden = cart.items.length > 0;
  $("subtotal").textContent = formatMoney(cart.subtotalCents);
  $("discount").textContent = cart.discountCents > 0 ? `-${formatMoney(cart.discountCents)}` : formatMoney(0);
  $("total").textContent = formatMoney(cart.totalCents);
  $("checkout").disabled = cart.items.length === 0;
}

function renderBadge(cart) {
  $("cart-badge").textContent = `Cart (${cart.itemCount})`;
}

async function addToCart(productId) {
  const cart = await api("/api/cart/items", {
    method: "POST",
    body: JSON.stringify({ productId, quantity: 1 }),
  });
  renderCart(cart);
  renderBadge(cart);
}

async function removeFromCart(productId) {
  const cart = await api(`/api/cart/items/${productId}`, { method: "DELETE" });
  renderCart(cart);
}

async function applyCoupon(event) {
  event.preventDefault();
  const code = $("coupon-code").value;
  try {
    const cart = await api("/api/cart/coupon", { method: "POST", body: JSON.stringify({ code }) });
    renderCart(cart);
    $("coupon-message").textContent = `Coupon ${cart.coupon} applied`;
  } catch (error) {
    console.warn("[shop] coupon rejected:", error.message);
    $("coupon-message").textContent = error.message;
  }
}

async function checkout() {
  const order = await api("/api/checkout", { method: "POST" });
  console.info(`[shop] order ${order.id} placed`);
  $("confirmation-text").textContent = `Order ${order.id} — Total ${formatMoney(order.totalCents)}`;
  $("confirmation").hidden = false;
  const emptyCart = { items: [], itemCount: 0, coupon: null, subtotalCents: 0, discountCents: 0, totalCents: 0 };
  renderCart(emptyCart);
  renderBadge(emptyCart);
  $("coupon-message").textContent = "";
}

function continueShopping() {
  $("confirmation").hidden = true;
}

async function init() {
  $("coupon-form").addEventListener("submit", applyCoupon);
  $("checkout").addEventListener("click", checkout);
  $("continue").addEventListener("click", continueShopping);

  await ensureSession();
  const [products, cart] = await Promise.all([api("/api/products"), api("/api/cart")]);
  state.products = products;
  renderProducts();
  renderCart(cart);
  renderBadge(cart);
  console.info("[shop] ready");
}

init().catch((error) => {
  console.error("[shop] failed to start:", error);
});
