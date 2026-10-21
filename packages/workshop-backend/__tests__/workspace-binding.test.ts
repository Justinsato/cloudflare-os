import { describe, expect, it } from "vitest";
import { RpcStub, env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import type { AiChatAuthorInfo, Overseer } from "@gadgets/workshop-shared/api";
import type { OverseerDurableObject } from "../src/overseer.js";
import { listWorkspaceGadgets, type WorkspaceImpl } from "../src/workspace-binding";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>;
  }
}

// Exercises the env.WORKSPACE binding (workspace-binding.ts): a gadget's live, read-only view of
// its own workspace's gadget list, served on the real Overseer over real storage. The owner's
// user DO is faked.

const OWNER_USER_ID = "owner-user-do";
const OWNER: AiChatAuthorInfo = { type: "user", id: "olive@example.com", name: "Olive" };

let counter = 0;
async function withWorkspace(
    fn: (workspace: { impl: any, client: Overseer }) => Promise<void>): Promise<void> {
  let stub = env.TEST_OVERSEER.getByName(`workspace-binding-${++counter}`);
  await runInDurableObject(stub, async (instance: OverseerDurableObject) => {
    let impl = (instance as unknown as { impl: any }).impl;
    impl.ownerId = OWNER_USER_ID;
    impl.ensureAmbientCapsules = async () => {};
    impl.markOutputsDirty = () => {};
    let owner = { id: OWNER_USER_ID, whoami: async () => OWNER, setGadgetLastActive: async () => {} };
    impl.users = { idFromString: (id: string) => id, get: () => owner };
    using notifyClosed = new RpcStub<() => void>(() => {});
    using client = await instance.open(OWNER_USER_ID, OWNER.id, notifyClosed);
    await fn({ impl, client });
  });
}

async function createGadget(impl: any, client: Overseer, title: string): Promise<number> {
  let before = new Set([...impl.storage.gadgets.list()].map((g: { id: number }) => g.id));
  using _gadget = await client.createGadget(title, undefined, title.replace(/\W/g, "_"));
  return [...impl.storage.gadgets.list()]
      .map((g: { id: number }) => g.id)
      .find((id: number) => !before.has(id))!;
}

async function openWorkspace(impl: any, gadgetId: number, chatId?: number): Promise<WorkspaceImpl> {
  return await impl.startGatekeeperSession(
      { type: "workspace" }, { from: "gadget", gadgetId, ...(chatId !== undefined && { chatId }) });
}

describe("env.WORKSPACE", () => {
  it("lists the workspace's gadgets live, marking the caller", () =>
      withWorkspace(async ({ impl, client }) => {
    let home = await createGadget(impl, client, "Workspace Home");
    let a = await createGadget(impl, client, "Alpha");
    let b = await createGadget(impl, client, "Beta");
    let workspace = await openWorkspace(impl, home);

    expect(workspace.listGadgets()).toEqual([
      { id: home, title: "Workspace Home", self: true },
      { id: a, title: "Alpha", self: false },
      { id: b, title: "Beta", self: false },
    ]);

    // The same session sees renames, reorders, additions and removals without any resync. The
    // Workspace Home stays first whatever the saved order says.
    impl.setGadgetTitle(a, "Alpha · Renamed");
    await client.setGadgetOrder([b, a, home]);
    let c = await createGadget(impl, client, "Gamma");
    await impl.removeWorkpiece(b);
    expect(workspace.listGadgets()).toEqual([
      { id: home, title: "Workspace Home", self: true },
      { id: a, title: "Alpha · Renamed", self: false },
      { id: c, title: "Gamma", self: false },
    ]);
  }));

  it("is only minted for gadgets", () => withWorkspace(async ({ impl }) => {
    expect(() => impl.startGatekeeperSession({ type: "workspace" }, { from: "agent", chatId: 1 }))
        .toThrow(/only available to gadgets/);
    expect(() => impl.startGatekeeperSession({ type: "workspace" }, { from: "hook" }))
        .toThrow(/only available to gadgets/);
  }));

  it("is read-only: the session offers listGadgets and nothing else", () =>
      withWorkspace(async ({ impl, client }) => {
    let home = await createGadget(impl, client, "Home");
    let workspace = await openWorkspace(impl, home) as any;
    let methods = Object.getOwnPropertyNames(Object.getPrototypeOf(workspace))
        .filter(name => name !== "constructor");
    expect(methods).toEqual(["listGadgets"]);
  }));

  it("is in every gadget's env, beneath a legacy binding of the same name", () =>
      withWorkspace(async ({ impl }) => {
    impl.makeBindingLoopback = (target: unknown) => target;
    impl.storage.gadgets.put({ type: "gadget", id: 100, title: "G", created: new Date(0),
                               bindingName: "G100", bindings: {} });
    expect(impl.getEnvForLoader(100, { from: "gadget", gadgetId: 100 }).WORKSPACE)
        .toEqual({ type: "workspace" });

    impl.storage.gatekeepers.put({ id: 1, resourceTitle: "Conn", class: {} as any });
    impl.storage.gadgets.put({ type: "gadget", id: 101, title: "G", created: new Date(0),
                               bindingName: "G101", bindings: { WORKSPACE: { target: 1 } } });
    expect(impl.getEnvForLoader(101, { from: "gadget", gadgetId: 101 }).WORKSPACE)
        .toEqual({ type: "gatekeeper", id: 1 });

    // Not in the agent's executeCode env: the agent has its own gadget tools.
    expect(impl.getEnvForAgent(1, {}, "exec-1")).not.toHaveProperty("WORKSPACE");
  }));

  it("reserves the name for new gadget bindings", () => withWorkspace(async ({ impl }) => {
    impl.storage.gatekeepers.put({ id: 1, resourceTitle: "Conn", class: {} as any });
    impl.storage.gadgets.put({ type: "gadget", id: 100, title: "G", created: new Date(0),
                               bindingName: "G100", bindings: { CONN: { target: 1 } } });
    expect(() => impl.bindWorkpiece(100, "WORKSPACE", 1)).toThrow(/`WORKSPACE` is reserved/);
    expect(() => impl.renameBinding(100, "CONN", "WORKSPACE")).toThrow(/`WORKSPACE` is reserved/);
  }));

  it("describeBinding serves the Workspace API", () => withWorkspace(async ({ impl }) => {
    let description = impl.describeWorkspaceBinding("env.WORKSPACE (in gadget HOME's env)");
    expect(description).toContain("Binding: env.WORKSPACE (in gadget HOME's env)");
    expect(description).toContain("interface Workspace");
    expect(description).toContain(
        "listGadgets(): Promise<{id: number, title: string, self: boolean}[]>");
  }));
});

describe("listWorkspaceGadgets", () => {
  let records = [
    { id: 3, type: "gadget" as const, title: "C" },
    { id: 1, type: "gadget" as const, title: "A" },
    { id: 2, type: "worktree" as const, title: "Repo" },
    { id: 4, type: "gadget" as const, title: "Draft", pending: { chatId: 7 } },
    { id: 5, type: "gadget" as const, title: "Other draft", pending: { chatId: 8 } },
  ];
  let host = (order: number[] = []) => ({ listWorkpieces: () => records, getGadgetOrder: () => order });

  it("lists committed gadgets only, in saved order then creation order", () => {
    expect(listWorkspaceGadgets(host([3]), undefined, 1)).toEqual([
      { id: 3, title: "C", self: false },
      { id: 1, title: "A", self: true },
    ]);
  });

  it("shows a chat's own provisional gadgets to that chat's preview only", () => {
    expect(listWorkspaceGadgets(host(), 7, undefined).map(g => g.id)).toEqual([1, 3, 4]);
    expect(listWorkspaceGadgets(host(), 9, undefined).map(g => g.id)).toEqual([1, 3]);
  });
});
