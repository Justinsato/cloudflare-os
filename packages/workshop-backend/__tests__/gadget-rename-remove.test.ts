// The agent's renameGadget and removeGadget tools. renameGadget applies at once, through the same
// registry write as the Outputs page's rename, and replays from its recorded result without
// renaming again. removeGadget never removes: it queues a pending action whose approval card
// joins the chat, and only the workspace owner's approval removes the gadget (rejection keeps it,
// and a build collaborator can decide neither way). Drives the real runAgent against a real
// OverseerImpl, with pi's faux provider standing in for the model, and decides the requests
// through the real OverseerClientInterface.

import { describe, expect, it } from "vitest";
import { env, RpcStub as NativeRpcStub } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import {
  createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall, getCurrentSystemPrompt,
  getCurrentTools, type Context, type TranscriptContext,
} from "@earendil-works/pi-ai";
import type {
  AiChatAuthorInfo, AiChatMessage, AiToolCall, Overseer,
} from "@gadgets/workshop-shared/api";
import type { OverseerDurableObject } from "../src/overseer.js";
import { runAgent } from "../src/agent";

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
const APP_ID = 100;
const OTHER_ID = 101;

let doCounter = 0;

async function withImpl(fn: (impl: any, instance: OverseerDurableObject) => Promise<void>)
    : Promise<void> {
  let stub = env.TEST_OVERSEER.getByName(`gadget-rename-remove-${++doCounter}`);
  await runInDurableObject(stub, async (instance: OverseerDurableObject) => {
    let impl = (instance as unknown as { impl: any }).impl;
    impl.ownerId = OWNER_USER_ID;
    // The user DOs open() and the approval paths reach: each answers with its own profile.
    impl.users = {
      idFromString: (id: string) => id,
      get: (id: string) => {
        let profile = id === OWNER_USER_ID ? OWNER : COLLABORATOR;
        return {
          whoami: async () => profile,
          getChatContext: async () => ({ profile: OWNER }),
          recordSharedGadgetOpen: async () => {},
        };
      },
    };
    impl.wrapUserDo = (stub: unknown) => stub;
    impl.ensureAmbientCapsules = async () => {};
    impl.markOutputsDirty = () => {};
    impl.syncOutputsTo = async () => {};
    // A non-owner opens as a "build" collaborator.
    impl.getSharingManager = async () => ({});
    impl.authorizeCollaborator = async () => "build";
    await fn(impl, instance);
  });
}

// Two accepted gadgets and a chat with one user message, ready for a turn.
function seedWorkspace(impl: any): void {
  impl.storage.gadgets.put({
    type: "gadget", id: APP_ID, title: "Sales Tracker", created: new Date(0),
    bindingName: "APP", bindings: {},
  });
  impl.storage.gadgets.put({
    type: "gadget", id: OTHER_ID, title: "Notes", created: new Date(0),
    bindingName: "OTHER", bindings: {},
  });
  impl.storage.chatMeta.put(
      { id: CHAT_ID, title: "Chat", started: new Date(0), lastActive: new Date(0) });
  impl.storage.chats.put({
    chatId: CHAT_ID, sequence: impl.nextChatSequence(CHAT_ID), timestamp: new Date(0),
    author: OWNER, type: "message", message: "Hi",
  });
}

// Appends a user message, so another turn can be run.
function addUserMessage(impl: any, message: string): void {
  impl.storage.chats.put({
    chatId: CHAT_ID, sequence: impl.nextChatSequence(CHAT_ID),
    // Workers clocks don't advance without I/O, and timestamps are indexed uniquely per chat.
    timestamp: new Date(Date.now() + 60_000 * impl.nextChatSequence(CHAT_ID)),
    author: OWNER, type: "message", message,
  });
}

type StepContext = Context & { tools: string[] };

// Runs one agent turn whose model answers each step with the next scripted response, returning
// the context (and offered tools) the model saw at each step.
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

// Runs a turn making the given tool calls in one step, then finishing.
async function runToolTurn(impl: any, calls: ReturnType<typeof fauxToolCall>[])
    : Promise<StepContext[]> {
  return runScriptedTurn(impl, [
    fauxAssistantMessage(calls, { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxText("Done.")),
  ]);
}

function chatMessages(impl: any): AiChatMessage[] {
  return ([...impl.storage.chats.list()] as AiChatMessage[])
      .filter(msg => msg.chatId === CHAT_ID);
}

function callsNamed<Name extends AiToolCall["toolName"]>(impl: any, name: Name)
    : Extract<AiToolCall, { toolName: Name }>[] {
  return chatMessages(impl)
      .flatMap(msg => msg.type === "message" ? msg.toolCalls ?? [] : [])
      .filter((call): call is Extract<AiToolCall, { toolName: Name }> => call.toolName === name);
}

// The text of each tool result the model was shown, in order.
function toolResultTexts(context: Context): string[] {
  return context.messages.flatMap(message => message.role === "toolResult"
      ? [message.content.map(part => part.type === "text" ? part.text : "").join("")]
      : []);
}

function removalActions(impl: any): any[] {
  return [...impl.storage.actions.list()].filter((record: any) => record.gatekeeperId === -2);
}

async function openAs(instance: OverseerDurableObject, userId: string): Promise<Overseer> {
  return await instance.open(
      userId, `${userId}-profile`, new NativeRpcStub<() => void>(() => {})) as Overseer;
}

describe("renameGadget", () => {
  it("renames through the registry and reports the old and new title",
      () => withImpl(async impl => {
    seedWorkspace(impl);
    let renamedEvents: string[] = [];
    impl.storage.gadgets.subscribe({
      add: () => {},
      remove: () => {},
      update: (_old: any, record: any) => {
        if (record.id === APP_ID) renamedEvents.push(record.title);
      },
    });

    let contexts = await runToolTurn(impl, [
      fauxToolCall("renameGadget", { gadget: "APP", title: "  Pipeline Tracker  " }),
      // By numeric workpiece id, the handle on a gadget with no binding in the env.
      fauxToolCall("renameGadget", { gadget: String(OTHER_ID), title: "Meeting Notes" }),
    ]);

    expect(contexts[0].tools).toEqual(expect.arrayContaining(["renameGadget", "removeGadget"]));
    expect(impl.storage.gadgets.get(APP_ID).title).toBe("Pipeline Tracker");
    expect(impl.storage.gadgets.get(OTHER_ID).title).toBe("Meeting Notes");
    // Subscribers (tabs, the Outputs index) saw the write, as they do the Outputs page's rename.
    expect(renamedEvents).toContain("Pipeline Tracker");

    let calls = callsNamed(impl, "renameGadget");
    expect(calls.map(call => call.output)).toEqual([
      { gadgetId: APP_ID, oldTitle: "Sales Tracker", title: "Pipeline Tracker" },
      { gadgetId: OTHER_ID, oldTitle: "Notes", title: "Meeting Notes" },
    ]);
    expect(JSON.parse(toolResultTexts(contexts[1])[0]))
        .toEqual({ gadgetId: APP_ID, oldTitle: "Sales Tracker", title: "Pipeline Tracker" });
  }));

  it("validates titles as createGadget does and refuses what isn't a gadget",
      () => withImpl(async impl => {
    seedWorkspace(impl);
    impl.storage.gatekeepers.put({ id: 5, resourceTitle: "Some DB", class: {} as any });

    await runToolTurn(impl, [
      fauxToolCall("renameGadget", { gadget: "APP", title: "   " }),
      fauxToolCall("renameGadget", { gadget: "NOPE", title: "X" }),
      fauxToolCall("renameGadget", { gadget: "999", title: "X" }),
      fauxToolCall("renameGadget", { gadget: "5", title: "X" }),
    ]);

    expect(impl.storage.gadgets.get(APP_ID).title).toBe("Sales Tracker");
    let calls = callsNamed(impl, "renameGadget");
    expect(calls.map(call => call.output)).toEqual([undefined, undefined, undefined, undefined]);
    expect(calls[0].error).toMatch(/A gadget requires a non-empty title/);
    expect(calls[1].error).toMatch(/There is no gadget named "NOPE" in your env/);
    expect(calls[2].error).toMatch(/No such gadget: 999/);
    expect(calls[3].error).toMatch(/external resource, not a gadget/);
  }));

  it("replays from the recorded result without renaming again", () => withImpl(async impl => {
    seedWorkspace(impl);
    let live = await runToolTurn(impl, [
      fauxToolCall("renameGadget", { gadget: "APP", title: "Pipeline Tracker" }),
    ]);

    // The owner renames it by hand afterwards. Replaying the agent's call must neither re-apply
    // its title nor fail.
    impl.setGadgetTitle(APP_ID, "Renamed By Hand");
    addUserMessage(impl, "Again");
    let replayed = await runScriptedTurn(impl, [fauxAssistantMessage(fauxText("Done."))]);

    expect(impl.storage.gadgets.get(APP_ID).title).toBe("Renamed By Hand");
    expect(toolResultTexts(replayed[0])).toEqual(toolResultTexts(live[1]));
    expect(callsNamed(impl, "renameGadget")).toHaveLength(1);
  }));
});

describe("removeGadget", () => {
  // Runs the turn that requests APP's removal, returning the pending action record.
  async function requestRemoval(impl: any): Promise<any> {
    let contexts = await runToolTurn(impl, [
      fauxToolCall("removeGadget", { gadget: "APP", reason: "Replaced by the new pipeline." }),
    ]);
    let result = JSON.parse(toolResultTexts(contexts[1])[0]);
    expect(result).toMatchObject({
      gadgetId: APP_ID, title: "Sales Tracker", status: "pendingOwnerApproval",
    });
    expect(result.message).toMatch(/pending the workspace owner's approval/);
    let [record] = removalActions(impl);
    expect(result.actionId).toBe(record.id);
    return record;
  }

  it("queues an approval card and leaves the gadget in place", () => withImpl(async impl => {
    seedWorkspace(impl);
    let record = await requestRemoval(impl);

    expect(impl.storage.gadgets.get(APP_ID)).toBeDefined();
    expect(record).toMatchObject({
      type: "action", state: "pending", action: APP_ID, resourceTitle: "Sales Tracker",
      caller: { from: "agent", chatId: CHAT_ID },
      description: {
        title: 'Remove gadget "Sales Tracker"',
        implementsRevert: false,
        fields: [
          { label: "Gadget", kind: "inline", value: "Sales Tracker" },
          { label: "Reason", kind: "text", value: "Replaced by the new pipeline." },
        ],
      },
    });
    expect(record.description.awaitDecision).toBeUndefined();
    // The card the chat renders: an "action" message after the step that made the call.
    let messages = chatMessages(impl);
    let cardIndex = messages.findIndex(
        msg => msg.type === "action" && msg.actionId === record.id);
    let callIndex = messages.findIndex(msg => msg.type === "message" &&
        msg.toolCalls?.some(call => call.toolName === "removeGadget"));
    expect(cardIndex).toBeGreaterThan(callIndex);
    expect(callIndex).toBeGreaterThanOrEqual(0);
  }));

  it("replays without queueing again, and a repeat request reuses the pending one",
      () => withImpl(async impl => {
    seedWorkspace(impl);
    let record = await requestRemoval(impl);

    addUserMessage(impl, "Again");
    let contexts = await runToolTurn(impl, [
      fauxToolCall("removeGadget", { gadget: "APP", reason: "Still not needed." }),
    ]);

    expect(removalActions(impl)).toHaveLength(1);
    let texts = toolResultTexts(contexts[1]);
    let repeat = JSON.parse(texts[texts.length - 1]);
    expect(repeat).toMatchObject({ actionId: record.id, alreadyPending: true });
    // Only the first request's card is in the chat.
    expect(chatMessages(impl).filter(msg => msg.type === "action")).toHaveLength(1);
  }));

  it("refuses a gadget still provisional to the chat, and an empty reason",
      () => withImpl(async impl => {
    seedWorkspace(impl);
    await runToolTurn(impl, [
      fauxToolCall("createGadget", { title: "Draft", bindingName: "DRAFT" }),
    ]);
    addUserMessage(impl, "Remove it");
    await runToolTurn(impl, [
      fauxToolCall("removeGadget", { gadget: "DRAFT", reason: "Not needed." }),
      fauxToolCall("removeGadget", { gadget: "APP", reason: "  " }),
    ]);

    let calls = callsNamed(impl, "removeGadget");
    expect(calls[0].error).toMatch(/hasn't been accepted yet/);
    expect(calls[1].error).toMatch(/Give a reason/);
    expect(removalActions(impl)).toEqual([]);
  }));

  it("removes the gadget when the owner approves", () => withImpl(async (impl, instance) => {
    seedWorkspace(impl);
    let record = await requestRemoval(impl);

    let owner = await openAs(instance, OWNER_USER_ID);
    await owner.approveAction(record.id);

    expect(impl.storage.gadgets.get(APP_ID)).toBeUndefined();
    expect(impl.storage.gadgets.get(OTHER_ID)).toBeDefined();
    expect(impl.storage.actions.get(record.id)).toMatchObject({
      state: "approved", resolvedBy: OWNER, autoApproved: false,
    });
    await expect(owner.approveAction(record.id)).rejects.toThrow(/not pending/);
  }));

  it("keeps the gadget when the owner rejects", () => withImpl(async (impl, instance) => {
    seedWorkspace(impl);
    let record = await requestRemoval(impl);

    let owner = await openAs(instance, OWNER_USER_ID);
    await owner.rejectAction(record.id);

    expect(impl.storage.gadgets.get(APP_ID)).toMatchObject({ title: "Sales Tracker" });
    expect(impl.storage.actions.get(record.id)).toMatchObject(
        { state: "rejected", resolvedBy: OWNER });
    await expect(owner.approveAction(record.id)).rejects.toThrow(/not pending/);
    expect(impl.storage.gadgets.get(APP_ID)).toBeDefined();
  }));

  it("refuses a build collaborator's decision either way", () => withImpl(async (impl, instance) => {
    seedWorkspace(impl);
    let record = await requestRemoval(impl);

    let collaborator = await openAs(instance, COLLABORATOR_USER_ID);
    await expect(collaborator.approveAction(record.id))
        .rejects.toThrow(/Only the workspace owner can approve removing a gadget/);
    await expect(collaborator.rejectAction(record.id))
        .rejects.toThrow(/Only the workspace owner/);

    expect(impl.storage.gadgets.get(APP_ID)).toBeDefined();
    expect(impl.storage.actions.get(record.id).state).toBe("pending");

    // The owner can still decide.
    let owner = await openAs(instance, OWNER_USER_ID);
    await owner.approveAction(record.id);
    expect(impl.storage.gadgets.get(APP_ID)).toBeUndefined();
  }));

  it("is never applied through the gatekeeper path", () => withImpl(async impl => {
    seedWorkspace(impl);
    let record = await requestRemoval(impl);

    await expect(impl.applyPendingAction(record, OWNER, true))
        .rejects.toThrow(/isn't applied through a connection/);
    expect(impl.storage.gadgets.get(APP_ID)).toBeDefined();
    expect(impl.storage.actions.get(record.id).state).toBe("pending");
  }));
});

describe("system prompt", () => {
  it("documents both tools and gives the id of a gadget with no env binding",
      () => withImpl(async impl => {
    seedWorkspace(impl);
    // A chat whose frozen env never got OTHER (seeded before it existed) can only reach it by id.
    impl.storage.chatContext.put({ chatId: CHAT_ID, bindings: { APP: APP_ID } });

    let [context] = await runScriptedTurn(impl, [fauxAssistantMessage(fauxText("Done."))]);

    expect(context.systemPrompt).toContain("renameGadget");
    expect(context.systemPrompt).toContain("Never rename a Gadget to include the workspace's name");
    expect(context.systemPrompt).toMatch(/owner, who must approve before anything is removed/);
    expect(context.systemPrompt)
        .toContain(`## Gadget "Notes" (no binding in your env; workpiece id ${OTHER_ID})`);
  }));
});
