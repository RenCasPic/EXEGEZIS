import { describe, expect, it } from "vitest";
import { sameSite, siteOf } from "../src/same-site.js";

describe("the page's own site (first-party readiness)", () => {
  it("www, the bare domain and subdomains are the same site; ads and analytics are not", () => {
    expect(sameSite("www.jesushealingministry.net", "jesushealingministry.net")).toBe(true);
    expect(sameSite("www.jesushealingministry.net", "api.jesushealingministry.net")).toBe(true);
    expect(sameSite("www.jesushealingministry.net", "pagead2.googlesyndication.com")).toBe(false);
    expect(sameSite("www.jesushealingministry.net", "hit-video.pandavideo.com")).toBe(false);
  });

  it("knows country registries (co.uk, com.mx) and leaves addresses and single names as they are", () => {
    expect(siteOf("shop.example.co.uk")).toBe("example.co.uk");
    expect(siteOf("www.tienda.com.mx")).toBe("tienda.com.mx");
    expect(siteOf("127.0.0.1")).toBe("127.0.0.1");
    expect(siteOf("localhost")).toBe("localhost");
    expect(sameSite("127.0.0.1", "127.0.0.2")).toBe(false);
    expect(sameSite("", "")).toBe(false);
  });
});
