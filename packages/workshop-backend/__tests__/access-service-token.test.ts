import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import server from "../src/server";

// The /api route verifies the Access assertion with jose; stand in for Cloudflare's signature check
// so each test decides which claims the "verified" assertion carries.
const joseMocks = vi.hoisted(() => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));
vi.mock("jose", () => joseMocks);

const origin = "https://workshop.example";
const clientId = "2e9cfbe14b2edfb0fef58e0129a11a71.access";
const accessEnv = {
  ...env,
  CF_ACCESS_AUD: "audience",
  CF_ACCESS_ISS: "https://team.cloudflareaccess.com",
  ACCESS_SERVICE_TOKEN_EMAILS: JSON.stringify({ [clientId]: "person@example.com" }),
};

// A plain GET passes the auth checks and then gets "only accepts POST or WebSocket" (400), so the
// status tells whether the request authenticated without opening an RPC session.
function apiRequest(): Request {
  return new Request(`${origin}/api`, {
    headers: { Origin: origin, "cf-access-jwt-assertion": "signed-token" },
  });
}

// The route also kicks off the bundled-blueprint install on first use; this test env has no
// blueprint storage, so answer that call as already complete.
const ctx = {
  waitUntil: (promise: Promise<unknown>) => { void promise; },
  passThroughOnException: () => {},
  props: {},
  exports: {
    AdminSettings: { getByName: () => ({ ensureBundledBlueprintsInstalled: async () => true }) },
  },
} as unknown as ExecutionContext;

async function fetchApi(workerEnv: typeof accessEnv): Promise<Response> {
  return await server.fetch(apiRequest(), workerEnv, ctx);
}

describe("/api with an Access service token", () => {
  beforeEach(() => joseMocks.jwtVerify.mockReset());

  it("admits a service token mapped to a user", async () => {
    joseMocks.jwtVerify.mockResolvedValue({ payload: { common_name: clientId, sub: "" } });
    expect((await fetchApi(accessEnv)).status).toBe(400);
  });

  it("refuses a service token that is not mapped", async () => {
    joseMocks.jwtVerify.mockResolvedValue({ payload: { common_name: "other.access", sub: "" } });
    const response = await fetchApi(accessEnv);
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Access JWT didn't specify email address.");
  });

  it("refuses every service token when the mapping is invalid JSON", async () => {
    joseMocks.jwtVerify.mockResolvedValue({ payload: { common_name: clientId, sub: "" } });
    const response = await fetchApi({ ...accessEnv, ACCESS_SERVICE_TOKEN_EMAILS: "{oops" });
    expect(response.status).toBe(403);
  });

  it("still admits a signed-in user's assertion", async () => {
    joseMocks.jwtVerify.mockResolvedValue({ payload: { email: "user@example.com", sub: "u1" } });
    expect((await fetchApi(accessEnv)).status).toBe(400);
  });
});
