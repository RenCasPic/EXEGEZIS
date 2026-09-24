import { randomBytes } from "node:crypto";

export interface Product {
  id: string;
  name: string;
  priceCents: number;
}

export const PRODUCTS: readonly Product[] = [
  { id: "keyboard", name: "Mechanical Keyboard", priceCents: 8990 },
  { id: "mouse", name: "Wireless Mouse", priceCents: 2990 },
  { id: "monitor", name: "Monitor 27 inch", priceCents: 19990 },
];

/** Coupon code -> percentage off. */
export const COUPONS: Readonly<Record<string, number>> = { SAVE10: 10 };

interface CartLine {
  productId: string;
  quantity: number;
}

interface Cart {
  lines: CartLine[];
  coupon: string | null;
}

export interface CartItemView {
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

export interface CartView {
  items: CartItemView[];
  itemCount: number;
  coupon: string | null;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

export interface Order {
  id: string;
  items: CartItemView[];
  coupon: string | null;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  createdAt: string;
}

interface Session {
  cart: Cart;
  orders: Order[];
}

export class ShopError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function emptyCart(): Cart {
  return { lines: [], coupon: null };
}

function findProduct(productId: string): Product {
  const product = PRODUCTS.find((p) => p.id === productId);
  if (product === undefined) throw new ShopError(404, `Unknown product "${productId}"`);
  return product;
}

function discountBase(items: readonly CartItemView[]): number {
  return items.reduce((sum, item) => sum + item.unitPriceCents, 0);
}

export function priceCart(cart: Cart): CartView {
  const items = cart.lines.map((line) => {
    const product = findProduct(line.productId);
    return {
      productId: product.id,
      name: product.name,
      unitPriceCents: product.priceCents,
      quantity: line.quantity,
      lineTotalCents: product.priceCents * line.quantity,
    };
  });
  const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
  const percent = cart.coupon === null ? 0 : (COUPONS[cart.coupon] ?? 0);
  const discountCents = Math.round((discountBase(items) * percent) / 100);
  return {
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    coupon: cart.coupon,
    subtotalCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
  };
}

/** In-memory shop state. Each session (browser tab) has its own cart. */
export class Shop {
  private readonly sessions = new Map<string, Session>();
  private nextOrderNumber = 1001;

  createSession(): string {
    const token = randomBytes(24).toString("base64url");
    this.sessions.set(token, { cart: emptyCart(), orders: [] });
    return token;
  }

  getSession(token: string | undefined): Session {
    const session = token === undefined ? undefined : this.sessions.get(token);
    if (session === undefined) throw new ShopError(401, "Invalid or missing session token");
    return session;
  }

  viewCart(session: Session): CartView {
    return priceCart(session.cart);
  }

  addItem(session: Session, productId: string, quantity: number): CartView {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new ShopError(400, "Quantity must be an integer between 1 and 99");
    }
    findProduct(productId);
    const line = session.cart.lines.find((l) => l.productId === productId);
    if (line === undefined) {
      session.cart.lines.push({ productId, quantity });
    } else {
      line.quantity += quantity;
    }
    return priceCart(session.cart);
  }

  removeItem(session: Session, productId: string): CartView {
    const index = session.cart.lines.findIndex((l) => l.productId === productId);
    if (index === -1) throw new ShopError(404, `Product "${productId}" is not in the cart`);
    session.cart.lines.splice(index, 1);
    return priceCart(session.cart);
  }

  applyCoupon(session: Session, code: string): CartView {
    const normalized = code.trim().toUpperCase();
    if (COUPONS[normalized] === undefined) throw new ShopError(400, `Coupon "${code}" is not valid`);
    session.cart.coupon = normalized;
    return priceCart(session.cart);
  }

  clearCart(session: Session): CartView {
    session.cart = emptyCart();
    return priceCart(session.cart);
  }

  checkout(session: Session): Order {
    if (session.cart.lines.length === 0) throw new ShopError(400, "Cart is empty");
    const priced = priceCart(session.cart);
    const order: Order = {
      id: `ORD-${this.nextOrderNumber++}`,
      items: priced.items,
      coupon: priced.coupon,
      subtotalCents: priced.subtotalCents,
      discountCents: priced.discountCents,
      totalCents: priced.totalCents,
      createdAt: new Date().toISOString(),
    };
    session.orders.push(order);
    return order;
  }

  listOrders(session: Session): Order[] {
    return session.orders;
  }
}
