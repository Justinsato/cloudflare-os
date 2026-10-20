import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { serializeAdminConfig } from "../src/admin-config.js";
import { DEFAULT_ADMIN_CONFIG, type AdminConfig } from "../src/storage-schema/admin-settings-storage.js";
import type { UserDurableObject } from "../src/user.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_USER: DurableObjectNamespace<UserDurableObject>;
  }
}

const RESOURCE = { urlPattern: "https://catalog.example.com/*", title: "Catalog", description: "" };

// Stand-ins for bound gatekeeper vendors: an ambient one (like COCKPIT, which advertises no
// resources), an ordinary resource vendor, and a resourceless vendor that isn't ambient.
const VENDORS = {
  cockpit: { describe: async () => ({ displayName: "Cockpit", autoProvisionsAccount: true }),
             getSupportedResources: async () => [] },
  catalog: { describe: async () => ({ displayName: "Catalog" }),
             getSupportedResources: async () => [RESOURCE] },
  empty: { describe: async () => ({ displayName: "Empty" }),
           getSupportedResources: async () => [] },
};

let userCounter = 0;
function withVendors<T>(f: (user: UserDurableObject) => Promise<T>,
                        config: Partial<AdminConfig> = {}) {
  const stub = env.TEST_USER.getByName(`user-gatekeeper-vendors-${++userCounter}`);
  return runInDurableObject(stub, async user => {
    const impl = user as unknown as { env: Cloudflare.Env, vendors: Map<string, unknown> };
    const [originalEnv, originalVendors] = [impl.env, impl.vendors];
    impl.env = {
      ...originalEnv,
      BLUEPRINTS: {
        get: async () => serializeAdminConfig({ ...DEFAULT_ADMIN_CONFIG, ...config }),
      } as unknown as KVNamespace,
    };
    impl.vendors = new Map(Object.entries(VENDORS));
    try {
      return await f(user);
    } finally {
      impl.env = originalEnv;
      impl.vendors = originalVendors;
    }
  });
}

const ids = (vendors: { id: string }[]) => vendors.map(v => v.id).toSorted();

describe("UserDurableObject.listGatekeeperVendors", () => {
  it("leaves ambient vendors out by default", () => withVendors(async user => {
    expect(ids(await user.listGatekeeperVendors())).toEqual(["catalog"]);
  }));

  it("lists ambient vendors, with no resources, when asked", () => withVendors(async user => {
    let vendors = await user.listGatekeeperVendors({ includeAmbient: true });
    expect(ids(vendors)).toEqual(["catalog", "cockpit"]);
    expect(vendors.find(v => v.id === "cockpit")?.supportedResources).toEqual([]);
  }));

  it("hides an ambient vendor the admin disabled", () => withVendors(async user => {
    expect(ids(await user.listGatekeeperVendors({ includeAmbient: true }))).toEqual(["catalog"]);
  }, { ambientGatekeeperModes: { cockpit: "disabled" } }));

  it("hides a gatekeeper the admin disabled outright", () => withVendors(async user => {
    expect(ids(await user.listGatekeeperVendors({ includeAmbient: true }))).toEqual(["catalog"]);
  }, { disabledGatekeepers: ["cockpit"] }));
});
