import { describe, expect, it } from "vitest";
import { hasVerificationMeta } from "../src/lib/site-ownership";

describe("proving a site is yours (the meta tag)", () => {
  const token = "0123456789abcdef0123456789abcdef";
  it("finds the tag in any attribute order and quoting", () => {
    expect(hasVerificationMeta(`<head><meta name="exegezis-site-verification" content="${token}"></head>`, token)).toBe(true);
    expect(hasVerificationMeta(`<meta content='${token}' NAME='exegezis-site-verification' />`, token)).toBe(true);
    expect(hasVerificationMeta(`<meta name=exegezis-site-verification content=${token}>`, token)).toBe(true);
  });

  it("never accepts another token, another name or the token alone in the text", () => {
    expect(hasVerificationMeta(`<meta name="exegezis-site-verification" content="other">`, token)).toBe(false);
    expect(hasVerificationMeta(`<meta name="google-site-verification" content="${token}">`, token)).toBe(false);
    expect(hasVerificationMeta(`<p>exegezis-site-verification ${token}</p>`, token)).toBe(false);
  });
});
