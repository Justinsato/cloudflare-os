// Brick: remintDeadAmbientAccount replaces a user's auto-provisioned account only when its stub no
// longer answers (the Worker that minted it is gone), and never touches a live one.

import { describe, expect, it } from "vitest";
import { env, RpcTarget } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import type { UserDurableObject } from "../src/user.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_USER: DurableObjectNamespace<UserDurableObject>;
  }
}

class Account extends RpcTarget {
  constructor(private alive: boolean, private tag: string) { super(); }
  async describe() {
    if (!this.alive) throw new Error("Network connection lost.");
    return { displayName: this.tag, singleton: { tsType: "Parcel" } };
  }
}

let counter = 0;
async function withUser(alive: boolean,
    fn: (user: UserDurableObject, impl: any, minted: string[]) => Promise<void>): Promise<void> {
  const stub = env.TEST_USER.getByName(`user-remint-ambient-${++counter}`);
  await runInDurableObject(stub, async user => {
    const impl = user as any;
    const originalVendors = impl.vendors;
    const minted: string[] = [];
    impl.vendors = new Map(Object.entries({
      parcel: {
        describe: async () => ({ displayName: "Parcel", autoProvisionsAccount: true }),
        getSupportedResources: async () => [],
        createAccount: async () => { minted.push("parcel"); return new Account(true, "fresh"); },
      },
    }));
    // Account stubs only persist when they come from a real service, so the collection is an
    // in-memory stand-in with the same get/put/delete surface.
    const accounts = new Map<number, any>();
    const originalAccounts = impl.storage.connectedAccounts;
    Object.defineProperty(impl.storage, "connectedAccounts", { configurable: true, value: {
      get: (id: number) => accounts.get(id),
      put: (rec: any) => { accounts.set(rec.id, rec); },
      delete: (id: number) => { accounts.delete(id); },
    } });
    accounts.set(9, {
      id: 9, account: new Account(alive, "old"),
      description: { displayName: "old", singleton: { tsType: "Parcel" } },
      vendorId: "parcel", autoProvisioned: true,
    });
    impl.storage.nextAccountId.put(10);
    try {
      await fn(user, impl, minted);
    } finally {
      impl.vendors = originalVendors;
      Object.defineProperty(impl.storage, "connectedAccounts",
          { configurable: true, value: originalAccounts });
    }
  });
}

describe("UserDurableObject.remintDeadAmbientAccount", () => {
  it("replaces a dead auto-provisioned account", () => withUser(false, async (user, impl, minted) => {
    expect(await user.remintDeadAmbientAccount("Parcel")).toEqual({ accountId: 10, reminted: true });
    expect(minted).toEqual(["parcel"]);
    expect(impl.storage.connectedAccounts.get(9)).toBeUndefined();
    expect(impl.storage.connectedAccounts.get(10).vendorId).toBe("parcel");
  }));

  it("leaves a live account alone", () => withUser(true, async (user, impl, minted) => {
    expect(await user.remintDeadAmbientAccount("parcel")).toEqual({ accountId: 9, reminted: false });
    expect(minted).toEqual([]);
    expect(impl.storage.connectedAccounts.get(9)).toBeDefined();
  }));

  it("returns null when the user has no account for the vendor",
      () => withUser(true, async user => {
    expect(await user.remintDeadAmbientAccount("stacks")).toBeNull();
  }));
});
