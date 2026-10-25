import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { OperatorApi } from "../src/server";
import { ADMIN_CONFIG_KEY } from "../src/storage-schema/blueprints-kv";

// The binding's props name the user; the user DO decides whether that user may sign in. Stand in
// for both so each test controls who exists and what the admin config allows.
const opened: unknown[][] = [];
const workspace = { listChats: async () => [] };

function operator(
    email: string | undefined,
    signIn: (email: string, allowCreate: boolean) => Promise<boolean>,
    adminConfig: Record<string, unknown> = {}) {
  const users = {
    idFromName: (name: string) => ({ toString: () => `user:${name}`, name }),
    get: () => ({ authenticateFromCfAccess: signIn }),
  };
  const ctx = {
    props: email === undefined ? {} : { email },
    waitUntil: (promise: Promise<unknown>) => { void promise; },
    passThroughOnException: () => {},
    exports: {
      UserDurableObject: users,
      OverseerDurableObject: {
        idFromString: (id: string) => {
          if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("bad id");
          return { toString: () => id };
        },
        get: () => ({ open: async (...args: unknown[]) => { opened.push(args); return workspace; } }),
      },
      AdminSettings: {},
    },
  } as unknown as ExecutionContext<{ email?: string }>;
  // Admin config lives in the BLUEPRINTS KV namespace under ADMIN_CONFIG_KEY.
  const blueprints = { get: async (key: string) => key === ADMIN_CONFIG_KEY ? JSON.stringify(adminConfig) : null };
  return new OperatorApi(ctx, { ...env, BLUEPRINTS: blueprints } as unknown as typeof env);
}

describe("OperatorApi", () => {
  it("signs in as the binding's configured user", async () => {
    const signIn = vi.fn(async () => false);
    const api = await operator("person@example.com", signIn).authenticate();
    expect(signIn).toHaveBeenCalledWith("person@example.com", expect.any(Boolean));
    expect(typeof api.listGadgets).toBe("function");
    expect(typeof api.getPreferredModel).toBe("function");
  });

  it("opens a workspace as that user through the workspace Durable Object's own stub", async () => {
    const api = await operator("person@example.com", vi.fn(async () => false)).authenticate();
    const id = "a".repeat(64);
    expect(await api.openGadget(id)).toBe(workspace);
    expect(opened.at(-1)?.slice(0, 2)).toEqual(["user:person@example.com", "person@example.com"]);
    await expect(api.openGadget("not-an-id")).rejects.toThrow();
  });

  it("refuses a binding with no configured user", async () => {
    const signIn = vi.fn(async () => false);
    await expect(operator(undefined, signIn).authenticate()).rejects.toThrow(/props\.email/);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("creates no account the deployment would not let the user create by signing in", async () => {
    const signIn = vi.fn(async (_email: string, allowCreate: boolean) => {
      if (!allowCreate) throw new Error("New sign-ups are currently disabled on this deployment.");
      return true;
    });
    await expect(operator("new@example.com", signIn, { signupsEnabled: false }).authenticate())
      .rejects.toThrow(/sign-ups/);
    expect(signIn).toHaveBeenCalledWith("new@example.com", false);
  });
});
