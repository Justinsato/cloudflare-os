import { describe, expect, it, vi } from "vitest";
import {
  accessRateLimitKey, accessSessionEmail, parseAccessServiceTokenEmails, verifyCfAccessJwt,
} from "../src/access.js";

const joseMocks = vi.hoisted(() => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn().mockResolvedValue({ payload: { sub: "user-1" } }),
}));

vi.mock("jose", () => joseMocks);

const accessEnv = {
  CF_ACCESS_AUD: "workshop-audience",
  CF_ACCESS_ISS: "https://team.cloudflareaccess.com",
};

describe("verifyCfAccessJwt", () => {
  it("reuses the remote JWK set for requests with the same issuer", async () => {
    const request = new Request("https://workshop.example/api", {
      headers: { "cf-access-jwt-assertion": "signed-token" },
    });
    const otherEnv = {
      ...accessEnv,
      CF_ACCESS_ISS: "https://other-team.cloudflareaccess.com",
    };

    await verifyCfAccessJwt(request, accessEnv);
    await verifyCfAccessJwt(request, accessEnv);
    await verifyCfAccessJwt(request, otherEnv);

    expect(joseMocks.createRemoteJWKSet).toHaveBeenCalledTimes(2);
    expect(joseMocks.createRemoteJWKSet).toHaveBeenNthCalledWith(
      1, new URL("https://team.cloudflareaccess.com/cdn-cgi/access/certs"),
    );
    expect(joseMocks.createRemoteJWKSet).toHaveBeenNthCalledWith(
      2, new URL("https://other-team.cloudflareaccess.com/cdn-cgi/access/certs"),
    );
  });

  it("rejects missing and invalid assertions", async () => {
    const requestWithoutToken = new Request("https://workshop.example/api/client-errors");
    const verifier = vi.fn();
    const missing = await verifyCfAccessJwt(requestWithoutToken, accessEnv, verifier);
    expect(missing).toBeNull();
    expect(verifier).not.toHaveBeenCalled();

    const requestWithToken = new Request("https://workshop.example/api/client-errors", {
      headers: { "cf-access-jwt-assertion": "invalid" },
    });
    verifier.mockRejectedValue(new Error("invalid signature"));
    const invalid = await verifyCfAccessJwt(requestWithToken, accessEnv, verifier);
    expect(invalid).toBeNull();
  });

  it("returns claims only after verification", async () => {
    const request = new Request("https://workshop.example/api", {
      headers: { "cf-access-jwt-assertion": "signed-token" },
    });
    const verifier = vi.fn().mockResolvedValue({
      sub: "user-1", email: "person@example.com",
    });

    await expect(verifyCfAccessJwt(request, accessEnv, verifier)).resolves.toEqual({
      sub: "user-1", email: "person@example.com",
    });
  });
});

describe("accessRateLimitKey", () => {
  it("uses the verified subject and hashes email only as a fallback", async () => {
    await expect(accessRateLimitKey({ sub: "user-1", email: "person@example.com" }))
      .resolves.toBe("access-sub:user-1");
    const emailKey = await accessRateLimitKey({ email: "person@example.com" });
    expect(emailKey).toMatch(/^access-email:[0-9a-f]{64}$/);
    expect(emailKey).not.toContain("person@example.com");
  });
});

describe("parseAccessServiceTokenEmails", () => {
  const clientId = "2e9cfbe14b2edfb0fef58e0129a11a71.access";

  it("reads a JSON string or an object binding", () => {
    const json = JSON.stringify({ [clientId]: "person@example.com" });
    expect([...parseAccessServiceTokenEmails(json)]).toEqual([[clientId, "person@example.com"]]);
    expect([...parseAccessServiceTokenEmails({ [clientId]: "person@example.com" })])
      .toEqual([[clientId, "person@example.com"]]);
  });

  it("treats an unset value as no mappings without warning", () => {
    const warn = vi.fn();
    expect(parseAccessServiceTokenEmails(undefined, warn).size).toBe(0);
    expect(parseAccessServiceTokenEmails("", warn).size).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("treats invalid JSON and non-object values as no mappings and warns", () => {
    for (const raw of ["{not json", "[]", "\"person@example.com\"", "42", "null", ["x"]]) {
      const warn = vi.fn();
      expect(parseAccessServiceTokenEmails(raw, warn).size).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
    }
  });

  it("skips entries whose email is not a non-empty string", () => {
    const warn = vi.fn();
    const map = parseAccessServiceTokenEmails(
      JSON.stringify({ good: "person@example.com", empty: "", number: 7 }), warn);
    expect([...map]).toEqual([["good", "person@example.com"]]);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("accessSessionEmail", () => {
  const mappings = new Map([["token-id.access", "person@example.com"]]);

  it("uses the email of a user assertion", () => {
    expect(accessSessionEmail({ email: "user@example.com" }, mappings)).toBe("user@example.com");
  });

  it("maps a known service token to its user", () => {
    expect(accessSessionEmail({ common_name: "token-id.access", sub: "" }, mappings))
      .toBe("person@example.com");
  });

  it("refuses unknown service tokens and assertions with neither claim", () => {
    expect(accessSessionEmail({ common_name: "other.access" }, mappings)).toBeNull();
    expect(accessSessionEmail({ common_name: "token-id.access" }, new Map())).toBeNull();
    expect(accessSessionEmail({ sub: "user-1" }, mappings)).toBeNull();
    expect(accessSessionEmail({ email: "", common_name: 5 }, mappings)).toBeNull();
  });
});
