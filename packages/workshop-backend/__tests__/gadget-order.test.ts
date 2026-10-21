import { describe, expect, it } from "vitest";
import { env, RpcStub as NativeRpcStub } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import type { AiChatAuthorInfo, GadgetMetadata, Overseer } from "@gadgets/workshop-shared/api";
import {
  isWorkspaceHomeTitle, moveGadget, normalizeGadgetOrder, sortByGadgetOrder,
} from "@gadgets/workshop-shared/gadget-order";
import type { OverseerDurableObject } from "../src/overseer.js";
import { openFakeOverseer } from "./fixtures";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>;
  }
}

// The saved gadget display order (GadgetMetadata.gadgetOrder): stored on the real Overseer over
// real storage, opened as the owner. The owner's user DO is faked.

const OWNER_USER_ID = "owner-user-do";
const OWNER: AiChatAuthorInfo = {
  type: "user", id: "olive@example.com", name: "Olive", commitEmail: "olive@commits.example",
};

let counter = 0;

async function withWorkspace(
    fn: (workspace: { impl: any, client: Overseer }) => Promise<void>): Promise<void> {
  let stub = env.TEST_OVERSEER.getByName(`gadget-order-${++counter}`);
  await runInDurableObject(stub, async (instance: OverseerDurableObject) => {
    let impl = (instance as unknown as { impl: any }).impl;
    impl.ownerId = OWNER_USER_ID;
    impl.ensureAmbientCapsules = async () => {};
    impl.markOutputsDirty = () => {};
    let owner = {
      id: OWNER_USER_ID,
      whoami: async () => OWNER,
      setGadgetLastActive: async () => {},
    };
    impl.users = { idFromString: (id: string) => id, get: () => owner };
    using notifyClosed = new NativeRpcStub<() => void>(() => {});
    using client = await instance.open(OWNER_USER_ID, OWNER.id, notifyClosed);
    await fn({ impl, client });
  });
}

let gadgetCounter = 0;

async function createGadgets(impl: any, client: Overseer, count: number): Promise<number[]> {
  let before = new Set([...impl.storage.gadgets.list()].map((g: { id: number }) => g.id));
  for (let i = 0; i < count; i++) {
    let name = `G${++gadgetCounter}`;
    using _gadget = await client.createGadget(name, undefined, name);
  }
  return [...impl.storage.gadgets.list()]
      .map((g: { id: number }) => g.id)
      .filter((id: number) => !before.has(id))
      .toSorted((a: number, b: number) => a - b);
}

describe("gadget order storage", () => {
  it("defaults to empty (id order) and saves a reorder", async () => {
    await withWorkspace(async ({ impl, client }) => {
      let [a, b, c] = await createGadgets(impl, client, 3);
      expect((await client.getMetadata()).gadgetOrder).toEqual([]);

      await client.setGadgetOrder([c!, a!, b!]);
      expect(impl.storage.gadgetOrder.get()).toEqual([c, a, b]);
      expect((await client.getMetadata()).gadgetOrder).toEqual([c, a, b]);
    });
  });

  it("drops unknown and duplicate ids and appends gadgets the request leaves out", async () => {
    await withWorkspace(async ({ impl, client }) => {
      let [a, b, c] = await createGadgets(impl, client, 3);
      await client.setGadgetOrder([c!, 999, c!, -1]);
      expect(impl.storage.gadgetOrder.get()).toEqual([c, a, b]);
    });
  });

  it("appends a gadget created after the order was saved", async () => {
    await withWorkspace(async ({ impl, client }) => {
      let [a, b] = await createGadgets(impl, client, 2);
      await client.setGadgetOrder([b!, a!]);
      let [d] = await createGadgets(impl, client, 1);
      let order = (await client.getMetadata()).gadgetOrder;
      expect(order).toEqual([b, a]);
      let gadgets = [{ id: a! }, { id: b! }, { id: d! }];
      expect(sortByGadgetOrder(gadgets, order).map(g => g.id)).toEqual([b, a, d]);
    });
  });

  it("drops a deleted gadget from the saved order", async () => {
    await withWorkspace(async ({ impl, client }) => {
      let [a, b, c] = await createGadgets(impl, client, 3);
      await client.setGadgetOrder([c!, b!, a!]);
      await impl.removeWorkpiece(b);
      expect(impl.storage.gadgetOrder.get()).toEqual([c, a]);
    });
  });

  it("pushes order changes to metadata subscribers", async () => {
    await withWorkspace(async ({ impl, client }) => {
      let [a, b] = await createGadgets(impl, client, 2);
      let seen: (number[] | undefined)[] = [];
      using callback = new NativeRpcStub((metadata: GadgetMetadata) => {
        seen.push(metadata.gadgetOrder && [...metadata.gadgetOrder]);
      });
      // @ts-expect-error Native RpcStub stands in for the capnweb stub type.
      using _subscription = await client.subscribeToMetadata(callback);
      await client.setGadgetOrder([b!, a!]);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(seen[0]).toEqual([]);
      expect(seen.at(-1)).toEqual([b, a]);
    });
  });

  it("denies reordering to use-role collaborators", async () => {
    let client = await openFakeOverseer({}, { role: "use" });
    await expect(client.setGadgetOrder([1, 2])).rejects.toThrow();
  });
});

describe("gadget order helpers", () => {
  it("sortByGadgetOrder puts named ids first, the rest by id, and ignores stale ids", () => {
    let items = [5, 1, 3, 2, 4].map(id => ({ id }));
    expect(sortByGadgetOrder(items, [4, 99, 2]).map(i => i.id)).toEqual([4, 2, 1, 3, 5]);
    expect(sortByGadgetOrder(items, undefined).map(i => i.id)).toEqual([1, 2, 3, 4, 5]);
    expect(sortByGadgetOrder(items, [3, 3, 1]).map(i => i.id)).toEqual([3, 1, 2, 4, 5]);
  });

  it("normalizeGadgetOrder names every existing id exactly once", () => {
    expect(normalizeGadgetOrder([3, 3, 7, 1], [1, 2, 3])).toEqual([3, 1, 2]);
    expect(normalizeGadgetOrder([], [2, 1])).toEqual([1, 2]);
  });

  it("moveGadget moves to the insertion index and clamps", () => {
    expect(moveGadget([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveGadget([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3]);
    expect(moveGadget([1, 2, 3], 1, 10)).toEqual([1, 3, 2]);
    expect(moveGadget([1, 2, 3], 5, 0)).toEqual([1, 2, 3]);
  });
});

describe("Workspace Home placement", () => {
  it("recognizes the Workspace Home by its Contents", () => {
    expect(isWorkspaceHomeTitle("Dashboard · Review · Workspace Home · Live")).toBe(true);
    expect(isWorkspaceHomeTitle("Workspace Home")).toBe(true);
    expect(isWorkspaceHomeTitle("Dashboard · Review · Workspace Home Stats · Live")).toBe(false);
    expect(isWorkspaceHomeTitle("Report · Review · Units · Live")).toBe(false);
    expect(isWorkspaceHomeTitle(undefined)).toBe(false);
  });

  it("sorts the Workspace Home first, ahead of the saved order", () => {
    let items = [
      { id: 1, title: "Report · Review · A · Live" },
      { id: 2, title: "Report · Review · B · Live" },
      { id: 9, title: "Dashboard · Review · Workspace Home · Live" },
    ];
    expect(sortByGadgetOrder(items, [2, 1, 9]).map(i => i.id)).toEqual([9, 2, 1]);
    expect(sortByGadgetOrder(items, undefined).map(i => i.id)).toEqual([9, 1, 2]);
  });
});
