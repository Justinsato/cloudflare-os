// Brick: the agent's workspace tools. listWorkspaces reads the initiator's own listing.
// createWorkspace and renameWorkspace apply at once and replay from their recorded results.
// requestWorkspacePlacement and requestWorkspaceShare never apply: they queue pending actions that
// only the workspace owner decides, and a placement also needs the owner to be a deployment admin
// because it changes everyone's sidebar. Drives the real runAgent against a real OverseerImpl, with
// pi's faux provider standing in for the model, and decides the requests through the real
// OverseerClientInterface.

import { describe, expect, it } from "vitest";
import { env, RpcStub as NativeRpcStub } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import {
  createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall, getCurrentSystemPrompt,
  getCurrentTools, type Context, type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { AiChatAuthorInfo, AiChatMessage, AiToolCall, Overseer } from "@gadgets/workshop-shared/api";
import type { OverseerDurableObject } from "../src/overseer.js";
import { runAgent } from "../src/agent";
import {
  WORKSPACE_PLACEMENTS_KEY, validatePlacement, validateWorkspaceTitle,
} from "../src/workspace-placements.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>;
  }
}

const OWNER_USER_ID = "owner-user-do";
const COLLABORATOR_USER_ID = "collaborator-user-do";
const OWNER: AiChatAuthorInfo = { type: "user", id: "owner@example.com", name: "Owner" };
const COLLABORATOR: AiChatAuthorInfo =
    { type: "user", id: "collab@example.com", name: "Collaborator" };
const CHAT_ID = 1;
const OTHER_WORKSPACE = "b".repeat(64);
const SHARED_WORKSPACE = "c".repeat(64);
const NEW_WORKSPACE = "d".repeat(64);

let doCounter = 0;

type Harness = {
  impl: any;
  instance: OverseerDurableObject;
  kv: Map<string, string>;
  // What the fakes saw.
  registered: {id: string, title: string}[];
  initialized: {id: string, ownerUserId: string, title: string}[];
  activated: string[];
  titleUpdates: {id: string, title: string}[];
  collaborators: {username: string, role: string}[];
};

async function withImpl(fn: (h: Harness) => Promise<void>, opts: {admins?: string[]} = {})
    : Promise<void> {
  let stub = env.TEST_OVERSEER.getByName(`agent-workspace-tools-${++doCounter}`);
  await runInDurableObject(stub, async (instance: OverseerDurableObject) => {
    let impl = (instance as unknown as { impl: any }).impl;
    let self = impl.ctx.id.toString();
    let h: Harness = {
      impl, instance, kv: new Map(), registered: [], initialized: [], activated: [],
      titleUpdates: [], collaborators: [],
    };
    impl.ownerId = OWNER_USER_ID;
    impl.storage.title.put("Untitled Workspace");
    // The placements live in BLUEPRINTS KV and admins in env.ADMINS; the test pool has neither.
    impl.env = Object.assign(Object.create(impl.env), {
      ADMINS: opts.admins ?? [OWNER.id],
      BLUEPRINTS: {
        get: async (key: string) => h.kv.get(key) ?? null,
        put: async (key: string, value: string) => { h.kv.set(key, value); },
      },
    });
    let listing = [
      { id: self, title: "Untitled Workspace", created: new Date(0), lastActive: new Date(0) },
      { id: OTHER_WORKSPACE, title: "Capital · Review · Loans · Monthly", created: new Date(0),
        lastActive: new Date(0), pinned: true },
      { id: SHARED_WORKSPACE, title: "Someone Else's", created: new Date(0),
        lastActive: new Date(0), owner: "someone-else" },
    ];
    let userDo = (profile: AiChatAuthorInfo) => ({
      whoami: async () => profile,
      whoamiIfExists: async () => profile,
      getChatContext: async () => ({ profile: OWNER }),
      recordSharedGadgetOpen: async () => {},
      listGadgets: async () => listing,
      getGadget: async (id: string) => listing.find(w => w.id === id) ?? null,
      newGadget: async (id: string, title: string) => {
        h.registered.push({id, title});
        listing.push({ id, title, created: new Date(0), lastActive: new Date(0) });
      },
      setGadgetLastActive: async (id: string) => { h.activated.push(id); },
      updateTitle: async (id: string, title: string) => { h.titleUpdates.push({id, title}); },
    });
    impl.users = {
      idFromString: (id: string) => id,
      idFromName: (name: string) => ({ toString: () => `${name}-do`, name }),
      get: (id: any) => userDo(
          id === OWNER_USER_ID || id?.name === OWNER.id ? OWNER : COLLABORATOR),
    };
    impl.overseers = {
      newUniqueId: () => ({ toString: () => NEW_WORKSPACE }),
      idFromString: (id: string) => id,
      get: (id: string) => ({
        initializeOwnedWorkspace: async (ownerUserId: string, title: string) => {
          h.initialized.push({id, ownerUserId, title});
        },
      }),
    };
    impl.wrapUserDo = (stub: unknown) => stub;
    impl.ensureAmbientCapsules = async () => {};
    impl.markOutputsDirty = () => {};
    impl.syncOutputsTo = async () => {};
    impl.getSharingManager = async () => ({
      addCollaborator: ({profile, role}: {profile: AiChatAuthorInfo, role: string}) => {
        h.collaborators.push({username: profile.id, role});
        return { profileId: profile.id, role };
      },
    });
    impl.authorizeCollaborator = async () => "build";
    impl.storage.chatMeta.put(
        { id: CHAT_ID, title: "Chat", started: new Date(0), lastActive: new Date(0) });
    addUserMessage(impl, "Hi");
    await fn(h);
  });
}

function addUserMessage(impl: any, message: string): void {
  impl.storage.chats.put({
    chatId: CHAT_ID, sequence: impl.nextChatSequence(CHAT_ID),
    // Workers clocks don't advance without I/O, and timestamps are indexed uniquely per chat.
    timestamp: new Date(Date.now() + 60_000 * impl.nextChatSequence(CHAT_ID)),
    author: OWNER, type: "message", message,
  });
}

type StepContext = Context & { tools: string[] };

async function runScriptedTurn(
    impl: any, steps: ReturnType<typeof fauxAssistantMessage>[]): Promise<StepContext[]> {
  let faux = createFauxCore({ models: [{ id: "faux-model" }] });
  let contexts: StepContext[] = [];
  faux.setResponses(steps.map(step => (context: TranscriptContext) => {
    contexts.push({
      systemPrompt: getCurrentSystemPrompt(context.messages),
      messages: structuredClone(context.messages),
      tools: getCurrentTools(context.messages).map(tool => tool.name),
    });
    return step;
  }));
  await runAgent(impl, { model: faux.getModel(), stream: faux.stream }, CHAT_ID,
      { type: "agent", id: "faux-model", name: "Faux" }, new AbortController().signal, OWNER,
      { provider: "cloudflare", model: "faux-model", apiToken: "" } as any);
  return contexts;
}

async function runToolTurn(impl: any, calls: ReturnType<typeof fauxToolCall>[])
    : Promise<StepContext[]> {
  return runScriptedTurn(impl, [
    fauxAssistantMessage(calls, { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxText("Done.")),
  ]);
}

function callsNamed<Name extends AiToolCall["toolName"]>(impl: any, name: Name)
    : Extract<AiToolCall, { toolName: Name }>[] {
  return ([...impl.storage.chats.list()] as AiChatMessage[])
      .filter(msg => msg.chatId === CHAT_ID)
      .flatMap(msg => msg.type === "message" ? msg.toolCalls ?? [] : [])
      .filter((call): call is Extract<AiToolCall, { toolName: Name }> => call.toolName === name);
}

function toolResultTexts(context: Context): string[] {
  return context.messages.flatMap(message => message.role === "toolResult"
      ? [message.content.map(part => part.type === "text" ? part.text : "").join("")]
      : []);
}

function actionsUnder(impl: any, sentinel: number): any[] {
  return [...impl.storage.actions.list()].filter((record: any) => record.gatekeeperId === sentinel);
}

async function openAs(instance: OverseerDurableObject, userId: string): Promise<Overseer> {
  return await instance.open(
      userId, `${userId}-profile`, new NativeRpcStub<() => void>(() => {})) as Overseer;
}

function placements(h: Harness): Record<string, unknown> {
  return JSON.parse(h.kv.get(WORKSPACE_PLACEMENTS_KEY) ?? "{}");
}

describe("validation", () => {
  it("enforces the naming convention and placement shape", () => {
    expect(validateWorkspaceTitle("  Capital · Review · Loans · Monthly ")).toBe(
        "Capital · Review · Loans · Monthly");
    expect(() => validateWorkspaceTitle("  ")).toThrow(/non-empty title/);
    expect(() => validateWorkspaceTitle("Mofo Tools")).toThrow(/never start with Mofo/);
    expect(() => validateWorkspaceTitle("back9 Jobs")).toThrow(/never start with/);
    // A brand word later in the title is fine.
    expect(validateWorkspaceTitle("Ops · Review · Back9 Jobs · Weekly")).toBe(
        "Ops · Review · Back9 Jobs · Weekly");
    expect(() => validateWorkspaceTitle("x".repeat(121))).toThrow(/too long/);

    expect(validatePlacement({group: " Portfolio ", theme: "dual"}))
        .toEqual({group: "Portfolio", theme: "dual"});
    expect(validatePlacement({})).toBeNull();
    expect(() => validatePlacement({theme: "Dual Theme"})).toThrow(/site theme name/);
    expect(() => validatePlacement({group: "  "})).toThrow(/non-empty label/);
  });
});

describe("listWorkspaces", () => {
  it("lists the initiator's workspaces with ids, ownership and placements",
      () => withImpl(async h => {
    h.kv.set(WORKSPACE_PLACEMENTS_KEY, JSON.stringify({[OTHER_WORKSPACE]: {group: "Capital"}}));
    let contexts = await runToolTurn(h.impl, [fauxToolCall("listWorkspaces", {})]);

    expect(contexts[0].tools).toEqual(expect.arrayContaining([
      "listWorkspaces", "createWorkspace", "renameWorkspace", "requestWorkspacePlacement",
      "requestWorkspaceShare",
    ]));
    let self = h.impl.ctx.id.toString();
    expect(JSON.parse(toolResultTexts(contexts[1])[0])).toEqual({
      workspaces: [
        { id: self, title: "Untitled Workspace", url: `/workspace/${self}`, owned: true,
          current: true },
        { id: OTHER_WORKSPACE, title: "Capital · Review · Loans · Monthly",
          url: `/workspace/${OTHER_WORKSPACE}`, owned: true, pinned: true,
          placement: {group: "Capital"} },
        { id: SHARED_WORKSPACE, title: "Someone Else's", url: `/workspace/${SHARED_WORKSPACE}`,
          owned: false },
      ],
    });
  }));
});

describe("createWorkspace", () => {
  it("creates a listed workspace owned by the initiator, at once", () => withImpl(async h => {
    let contexts = await runToolTurn(h.impl, [
      fauxToolCall("createWorkspace", { title: " Capital · Track · Draws · Weekly " }),
    ]);

    let title = "Capital · Track · Draws · Weekly";
    expect(h.registered).toEqual([{id: NEW_WORKSPACE, title}]);
    expect(h.initialized).toEqual([{id: NEW_WORKSPACE, ownerUserId: `${OWNER.id}-do`, title}]);
    // Never provisional: marked active so the home listing shows it before anyone opens it.
    expect(h.activated.filter(id => id === NEW_WORKSPACE)).toHaveLength(1);
    let output = JSON.parse(toolResultTexts(contexts[1])[0]);
    expect(output).toMatchObject({
      workspaceId: NEW_WORKSPACE, title, url: `/workspace/${NEW_WORKSPACE}`,
    });
    expect(output.placement).toBeUndefined();
    expect(actionsUnder(h.impl, -4)).toEqual([]);
  }));

  it("queues the requested placement for approval, and refuses a bad title or reason",
      () => withImpl(async h => {
    await runToolTurn(h.impl, [
      fauxToolCall("createWorkspace", { title: "Brick Inbox" }),
      fauxToolCall("createWorkspace", { title: "Ops · Triage · Inbox · Daily", group: "Tools" }),
      fauxToolCall("createWorkspace", {
        title: "Ops · Triage · Inbox · Daily", group: "Tools and settings", theme: "dual",
        reason: "It is an operator tool.",
      }),
    ]);

    let calls = callsNamed(h.impl, "createWorkspace");
    expect(calls[0].error).toMatch(/never start with Mofo, Brick or Back9/);
    expect(calls[1].error).toMatch(/Give a reason with the group or theme/);
    // Neither failed call left a workspace behind.
    expect(h.registered).toHaveLength(1);
    let [record] = actionsUnder(h.impl, -4);
    expect(calls[2].output).toMatchObject({
      workspaceId: NEW_WORKSPACE, placement: {actionId: record.id, status: "pendingOwnerApproval"},
    });
    expect(record.workspacePlacement).toEqual({
      workspaceId: NEW_WORKSPACE, workspaceTitle: "Ops · Triage · Inbox · Daily",
      group: "Tools and settings", theme: "dual",
    });
    expect(h.kv.get(WORKSPACE_PLACEMENTS_KEY)).toBeUndefined();
  }));

  it("replays from the recorded result without creating again", () => withImpl(async h => {
    let live = await runToolTurn(h.impl, [
      fauxToolCall("createWorkspace", { title: "Capital · Track · Draws · Weekly" }),
    ]);
    addUserMessage(h.impl, "Again");
    let replayed = await runScriptedTurn(h.impl, [fauxAssistantMessage(fauxText("Done."))]);

    expect(h.registered).toHaveLength(1);
    expect(toolResultTexts(replayed[0])).toEqual(toolResultTexts(live[1]));
  }));
});

describe("renameWorkspace", () => {
  it("renames this workspace through the owner's listing", () => withImpl(async h => {
    let contexts = await runToolTurn(h.impl, [
      fauxToolCall("renameWorkspace", { title: "Capital · Review · Loans · Monthly" }),
      fauxToolCall("renameWorkspace", { title: "Mofo Loans" }),
    ]);

    let self = h.impl.ctx.id.toString();
    expect(h.impl.storage.title.get()).toBe("Capital · Review · Loans · Monthly");
    expect(h.titleUpdates).toEqual([{id: self, title: "Capital · Review · Loans · Monthly"}]);
    expect(JSON.parse(toolResultTexts(contexts[1])[0])).toEqual({
      workspaceId: self, oldTitle: "Untitled Workspace", title: "Capital · Review · Loans · Monthly",
    });
    expect(callsNamed(h.impl, "renameWorkspace")[1].error).toMatch(/never start with Mofo/);
  }));
});

describe("requestWorkspacePlacement", () => {
  async function requestPlacement(h: Harness, input: Record<string, unknown> = {}): Promise<any> {
    await runToolTurn(h.impl, [fauxToolCall("requestWorkspacePlacement", {
      workspaceId: OTHER_WORKSPACE, group: "Capital", reason: "It is capital work.", ...input,
    })]);
    let records = actionsUnder(h.impl, -4);
    return records[records.length - 1];
  }

  it("queues a card naming the workspace, group and reason", () => withImpl(async h => {
    let record = await requestPlacement(h);
    expect(record).toMatchObject({
      type: "action", state: "pending", caller: { from: "agent", chatId: CHAT_ID },
      workspacePlacement: {
        workspaceId: OTHER_WORKSPACE, workspaceTitle: "Capital · Review · Loans · Monthly",
        group: "Capital",
      },
      description: {
        title: 'Place workspace "Capital · Review · Loans · Monthly"',
        fields: [
          { label: "Workspace", kind: "inline", value: "Capital · Review · Loans · Monthly" },
          { label: "Sidebar group", kind: "inline", value: "Capital" },
          { label: "Reason", kind: "text", value: "It is capital work." },
        ],
      },
    });
    let card = [...h.impl.storage.chats.list()].find(
        (msg: any) => msg.type === "action" && msg.actionId === record.id);
    expect(card).toBeDefined();
  }));

  it("refuses a workspace the initiator doesn't own, and reuses a pending request",
      () => withImpl(async h => {
    await runToolTurn(h.impl, [
      fauxToolCall("requestWorkspacePlacement", {
        workspaceId: SHARED_WORKSPACE, group: "Capital", reason: "Mine now.",
      }),
      fauxToolCall("requestWorkspacePlacement", { group: "Capital", reason: "  " }),
      fauxToolCall("requestWorkspacePlacement", { reason: "Nothing asked." }),
    ]);
    let calls = callsNamed(h.impl, "requestWorkspacePlacement");
    expect(calls[0].error).toMatch(/owned by you/);
    expect(calls[1].error).toMatch(/Give a reason/);
    expect(calls[2].error).toMatch(/Ask for a group, a theme, or both/);

    addUserMessage(h.impl, "Place it");
    let first = await requestPlacement(h);
    addUserMessage(h.impl, "Again");
    await requestPlacement(h);
    expect(actionsUnder(h.impl, -4)).toHaveLength(1);
    expect(callsNamed(h.impl, "requestWorkspacePlacement").at(-1)!.output)
        .toMatchObject({ actionId: first.id, alreadyPending: true });
  }));

  it("writes the placement when an admin owner approves, keeping the other half",
      () => withImpl(async h => {
    h.kv.set(WORKSPACE_PLACEMENTS_KEY, JSON.stringify({[OTHER_WORKSPACE]: {theme: "dual"}}));
    let record = await requestPlacement(h);
    let owner = await openAs(h.instance, OWNER_USER_ID);
    await owner.approveAction(record.id);

    expect(placements(h)).toEqual({[OTHER_WORKSPACE]: {group: "Capital", theme: "dual"}});
    expect(h.impl.storage.actions.get(record.id)).toMatchObject(
        { state: "approved", resolvedBy: OWNER, autoApproved: false });
    await expect(owner.approveAction(record.id)).rejects.toThrow(/not pending/);
  }));

  it("refuses an owner who isn't an admin, and a collaborator either way",
      () => withImpl(async h => {
    let record = await requestPlacement(h);
    let collaborator = await openAs(h.instance, COLLABORATOR_USER_ID);
    await expect(collaborator.approveAction(record.id)).rejects.toThrow(/Only the workspace owner/);
    await expect(collaborator.rejectAction(record.id)).rejects.toThrow(/Only the workspace owner/);

    let owner = await openAs(h.instance, OWNER_USER_ID);
    await expect(owner.approveAction(record.id)).rejects.toThrow(/Only an admin/);
    expect(h.kv.get(WORKSPACE_PLACEMENTS_KEY)).toBeUndefined();
    expect(h.impl.storage.actions.get(record.id).state).toBe("pending");

    await owner.rejectAction(record.id);
    expect(h.impl.storage.actions.get(record.id)).toMatchObject(
        { state: "rejected", resolvedBy: OWNER });
  }, { admins: ["someone-else@example.com"] }));

  it("is never applied through the gatekeeper path", () => withImpl(async h => {
    let record = await requestPlacement(h);
    await expect(h.impl.applyPendingAction(record, OWNER, true))
        .rejects.toThrow(/isn't applied through a connection/);
    expect(h.impl.storage.actions.get(record.id).state).toBe("pending");
  }));
});

describe("requestWorkspaceShare", () => {
  it("adds the collaborator only when the owner approves", () => withImpl(async h => {
    let contexts = await runToolTurn(h.impl, [fauxToolCall("requestWorkspaceShare", {
      email: " Collab@Example.com ", role: "use", reason: "Ji reviews the outputs.",
    })]);
    let [record] = actionsUnder(h.impl, -5);
    expect(JSON.parse(toolResultTexts(contexts[1])[0])).toMatchObject({
      email: "collab@example.com", role: "use", actionId: record.id,
      status: "pendingOwnerApproval",
    });
    expect(record.workspaceShare).toEqual({email: "collab@example.com", role: "use"});
    expect(h.collaborators).toEqual([]);

    let collaborator = await openAs(h.instance, COLLABORATOR_USER_ID);
    await expect(collaborator.approveAction(record.id)).rejects.toThrow(/Only the workspace owner/);

    let owner = await openAs(h.instance, OWNER_USER_ID);
    await owner.approveAction(record.id);
    expect(h.collaborators).toEqual([{username: "collab@example.com", role: "use"}]);
    expect(h.impl.storage.actions.get(record.id)).toMatchObject({ state: "approved" });
  }));

  it("refuses a bad email or reason and keeps a rejected request unshared",
      () => withImpl(async h => {
    await runToolTurn(h.impl, [
      fauxToolCall("requestWorkspaceShare", { email: "nobody", role: "use", reason: "x" }),
      fauxToolCall("requestWorkspaceShare", { email: "a@b.co", role: "build", reason: " " }),
      fauxToolCall("requestWorkspaceShare", { email: "a@b.co", role: "build", reason: "Builds." }),
    ]);
    let calls = callsNamed(h.impl, "requestWorkspaceShare");
    expect(calls[0].error).toMatch(/sign-in email/);
    expect(calls[1].error).toMatch(/Give a reason/);
    let [record] = actionsUnder(h.impl, -5);
    let owner = await openAs(h.instance, OWNER_USER_ID);
    await owner.rejectAction(record.id);
    expect(h.collaborators).toEqual([]);
    expect(h.impl.storage.actions.get(record.id).state).toBe("rejected");
  }));
});

describe("system prompt", () => {
  it("documents the workspace tools and the naming convention", () => withImpl(async h => {
    let [context] = await runScriptedTurn(h.impl, [fauxAssistantMessage(fauxText("Done."))]);
    expect(context.systemPrompt).toContain("createWorkspace");
    expect(context.systemPrompt).toContain("Category · Action · Contents · Cadence");
    expect(context.systemPrompt).toMatch(/started from Home already runs in a new workspace/);
    expect(context.systemPrompt).toContain("You can't delete workspaces.");
  }));
});
