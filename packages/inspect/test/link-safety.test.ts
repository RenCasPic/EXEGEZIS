import { describe, expect, it } from "vitest";
import { actionReason, addressWords } from "../src/link-safety.js";
import { unsafeLinkMatcher } from "../src/index.js";

const O = "https://shop.test";
const never = (path: string) => expect(actionReason(`${O}${path}`), path).not.toBeNull();
const page = (path: string) => expect(actionReason(`${O}${path}`), path).toBeNull();

describe("link safety by design: addresses an inspection never requests", () => {
  it("splits an address into its words, camelCase and glued pieces included", () => {
    expect(addressWords("/api/deleteAccount")).toEqual(["api", "delete", "account"]);
    expect(addressWords("remove_item-now")).toEqual(["remove", "item", "now"]);
  });

  it("technical routes: /api/, /ajax/, /admin/, /wp-admin/, /wp-json/, /graphql…", () => {
    for (const p of ["/api/deleteAccount", "/api/products", "/ajax/load", "/admin/", "/admin/users", "/wp-admin/", "/wp-json/wp/v2/posts", "/graphql", "/wp-login.php", "/xmlrpc.php", "/cgi-bin/x", "/rest/v1/items"]) never(p);
  });

  it("action words anywhere, whole, glued, camelCase or hyphenated — the one that slipped through (deleteAccount) included", () => {
    for (const p of [
      "/account/deleteAccount",
      "/account/deleteaccount",
      "/user/delete",
      "/cart/removeItem/3",
      "/cart/remove-item?id=3",
      "/logout",
      "/log-out",
      "/log_out",
      "/user/logOutAll",
      "/signout",
      "/newsletter/unsubscribe?email=a%40b.c",
      "/orders/9/cancel",
      "/password/reset",
      "/email/confirm?t=1",
      "/cart/add-to-cart?id=1",
      "/addToCart/5",
      "/wishlist/add?item=2",
      "/cerrar-sesion",
      "/darse-de-baja",
      "/borrar-cuenta",
    ])
      never(p);
  });

  it("parameters that name an action or carry a one-time token", () => {
    for (const p of ["/?action=delete", "/page?do=logout", "/index.php?cmd=x", "/post?_wpnonce=abc123", "/x?csrf_token=1", "/item?_method=DELETE"]) never(p);
  });

  it("ordinary pages are still visited, even with ordinary words that could be actions in a short piece", () => {
    for (const p of ["/", "/products/42", "/blog/how-to-save-money-on-groceries", "/about-us", "/category/updates-and-news-2025", "/es/oracion-en-vivo", "/books?page=2", "/search?q=shoes", "/productos-del-mes", "/blog/borrador-de-ideas", "/drop-shipping-guide"]) page(p);
  });

  it("the weaker action words count in a short piece of the address", () => {
    for (const p of ["/cart/save", "/profile/update", "/checkout", "/confirm-email", "/order?step=pay"]) never(p);
  });

  it("the matcher used by the crawl: the address, the link's text, the site's own patterns", () => {
    const unsafe = unsafeLinkMatcher(["/private-area"]);
    expect(unsafe(`${O}/api/deleteAccount`, "")).not.toBeNull();
    expect(unsafe(`${O}/account`, "Log out")).not.toBeNull();
    expect(unsafe(`${O}/account`, "Añadir al carrito")).not.toBeNull();
    expect(unsafe(`${O}/private-area/x`, "")).not.toBeNull();
    expect(unsafe(`${O}/account`, "My account")).toBeNull();
  });
});
