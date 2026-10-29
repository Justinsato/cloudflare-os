import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { serializeAdminConfig } from "../src/admin-config.js";
import { DEFAULT_ADMIN_CONFIG } from "../src/storage-schema/admin-settings-storage.js";
import type { UserDurableObject } from "../src/user.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_USER: DurableObjectNamespace<UserDurableObject>;
  }
}

// The Workshop hands an auto-provisioning vendor the user's verified email, so a gatekeeper can scope
// what the account reads to that user. The stand-in vendor records the argument, then refuses, so
// nothing is persisted and each test reads back exactly one call.
type Impl = {
  env: Cloudflare.Env;
  vendors: Map<string, unknown>;
  storage: {
    created: { put(value: boolean): void };
    profile: { put(value: { type: "user"; name: string; id: string }): void };
    passwordHashHash: { put(value: Uint8Array): void };
  };
};

let userCounter = 0;
async function provisionAs(setup: (impl: Impl) => void): Promise<unknown[][]> {
  const stub = env.TEST_USER.getByName(`user-create-account-email-${++userCounter}`);
  return runInDurableObject(stub, async user => {
    const impl = user as unknown as Impl;
    const [originalEnv, originalVendors] = [impl.env, impl.vendors];
    const calls: unknown[][] = [];
    impl.env = {
      ...originalEnv,
      BLUEPRINTS: { get: async () => serializeAdminConfig(DEFAULT_ADMIN_CONFIG) } as unknown as KVNamespace,
    };
    impl.vendors = new Map(Object.entries({
      pkm: {
        describe: async () => ({ displayName: "PKM", autoProvisionsAccount: true }),
        getSupportedResources: async () => [],
        createAccount: async (...args: unknown[]) => {
          calls.push(args);
          throw new Error("stand-in vendor: no account");
        },
      },
    }));
    try {
      setup(impl);
      await expect(user.provisionAmbientAccount("pkm")).rejects.toThrow("stand-in vendor");
      return calls;
    } finally {
      impl.env = originalEnv;
      impl.vendors = originalVendors;
    }
  });
}

function signedIn(id: string) {
  return (impl: Impl) => {
    impl.storage.created.put(true);
    impl.storage.profile.put({ type: "user", name: id.split("@")[0]!, id });
  };
}

describe("UserDurableObject auto-provisioned accounts", () => {
  it("passes the verified email of an Access sign-in", async () => {
    expect(await provisionAs(signedIn("ji@mosserco.com"))).toEqual([[{ userEmail: "ji@mosserco.com" }]]);
  });

  it("passes nothing for a password account", async () => {
    expect(await provisionAs(impl => {
      signedIn("alice")(impl);
      impl.storage.passwordHashHash.put(new Uint8Array([1, 2, 3]));
    })).toEqual([[]]);
  });

  it("passes nothing when the profile id is not an email", async () => {
    expect(await provisionAs(signedIn("alice"))).toEqual([[]]);
  });
});
