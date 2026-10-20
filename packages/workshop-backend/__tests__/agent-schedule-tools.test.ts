// The agent's schedule tools and its view of the user's other workspaces. listSchedules reports
// every hook with the gatekeeper's own status and the last run/failure (with the error's text)
// recorded as firings pass through the workspace. requestScheduleChange never changes a hook: it
// queues a pending action whose card joins the chat, and only the workspace owner's approval
// applies it, through the Connections toggle/delete path. runScheduleNow fires an enabled
// Scheduled Tasks hook's callback once, outside its schedule. listWorkspaceOutputs reads only the
// initiator's own Outputs index, minus this workspace. Drives the real runAgent against a real
// OverseerImpl, with pi's faux provider standing in for the model.

import { describe, expect, it, vi } from "vitest";
import { env, RpcStub as NativeRpcStub } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import {
  createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall, getCurrentSystemPrompt,
  getCurrentTools, type Context, type TranscriptContext,
} from "@earendil-works/pi-ai";
import type {
  AiChatAuthorInfo, AiChatMessage, AiToolCall, OutputSummary, Overseer,
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
const SCHEDULER_GK = 5;
const EMAIL_GK = 6;
const DAILY_HOOK = 7;       // enabled scheduler hook
const WEEKLY_HOOK = 8;      // disabled scheduler hook
const INBOX_HOOK = 9;       // enabled non-scheduler hook

const SCHEDULE_CHANGE_GK = -3;

let doCounter = 0;

type FakeHook = {
  id: number; actionId: number; gatekeeperId: number; gadgetId: number; vendorId: string;
  controller: any; callback: any; description: { title: string, description: string };
  enabled: boolean;
};

type Harness = {
  impl: any;
  instance: OverseerDurableObject;
  hooks: Map<number, FakeHook>;
  onSchedule: ReturnType<typeof vi.fn>;
  controller: { enable: ReturnType<typeof vi.fn>, disable: ReturnType<typeof vi.fn>,
                getStatus: ReturnType<typeof vi.fn> };
  indexReads: string[];
  indexes: Map<string, OutputSummary[]>;
};

async function withHarness(fn: (h: Harness) => Promise<void>): Promise<void> {
  let stub = env.TEST_OVERSEER.getByName(`agent-schedule-tools-${++doCounter}`);
  await runInDurableObject(stub, async (instance: OverseerDurableObject) => {
    let impl = (instance as unknown as { impl: any }).impl;
    let indexReads: string[] = [];
    let indexes = new Map<string, OutputSummary[]>();
    impl.ownerId = OWNER_USER_ID;
    impl.users = {
      idFromString: (id: string) => id,
      idFromName: (name: string) => `named:${name}`,
      get: (id: string) => {
        let profile = id === OWNER_USER_ID ? OWNER : COLLABORATOR;
        return {
          whoami: async () => profile,
          getChatContext: async () => ({ profile: OWNER }),
          recordSharedGadgetOpen: async () => {},
          readOutputsIndex: async () => {
            indexReads.push(id);
            return indexes.get(id) ?? [];
          },
        };
      },
    };
    impl.wrapUserDo = (stub: unknown) => stub;
    impl.ensureAmbientCapsules = async () => {};
    impl.markOutputsDirty = () => {};
    impl.syncOutputsTo = async () => {};
    impl.getSharingManager = async () => ({});
    impl.authorizeCollaborator = async () => "build";
    // No admin config in the test KV (defaults apply), and a loopback stand-in for the hook
    // initiator enableHook hands the gatekeeper.
    impl.env = { ...impl.env, BLUEPRINTS: { get: async () => null } };
    (instance as any).env = impl.env;
    let realCtx = impl.ctx;
    impl.ctx = new Proxy(realCtx, {
      get(target, prop) {
        if (prop === "exports") {
          return { ...target.exports,
                   GatekeeperHookLoopback: ({ props }: { props: object }) => ({ loopback: props }) };
        }
        let value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    impl.storage.gadgets.put({
      type: "gadget", id: APP_ID, title: "Sales Tracker", created: new Date(0),
      bindingName: "APP", bindings: {},
    });
    impl.storage.gatekeepers.put({ id: SCHEDULER_GK, resourceTitle: "Scheduled Tasks", class: {} });
    impl.storage.gatekeepers.put({ id: EMAIL_GK, resourceTitle: "Inbox", class: {} });
    impl.storage.chatMeta.put(
        { id: CHAT_ID, title: "Chat", started: new Date(0), lastActive: new Date(0) });
    impl.storage.chats.put({
      chatId: CHAT_ID, sequence: impl.nextChatSequence(CHAT_ID), timestamp: new Date(0),
      author: OWNER, type: "message", message: "Hi",
    });

    // Hook records hold live stubs, which the DO's structured-clone storage can't take from a
    // test, so serve the collection from a map (as observer-scope-restart.test.ts does).
    let onSchedule = vi.fn(async (_firing: unknown) => {});
    let controller = {
      enable: vi.fn(async () => {}),
      disable: vi.fn(async () => {}),
      getStatus: vi.fn(async () => ({
        externalId: "sched-daily", state: "dead", cadence: "daily at 07:00",
        timeZone: "America/Chicago", endedAt: Date.UTC(2026, 9, 19, 12), failureCode:
            "callback_failed", occurrences: { count: 10, used: 3 },
      })),
    };
    let hooks = new Map<number, FakeHook>();
    let addHook = (hook: Omit<FakeHook, "actionId" | "gadgetId">) =>
        hooks.set(hook.id, { actionId: 900 + hook.id, gadgetId: APP_ID, ...hook });
    addHook({
      id: DAILY_HOOK, gatekeeperId: SCHEDULER_GK, vendorId: "scheduler", controller,
      callback: { onSchedule }, enabled: true,
      description: { title: "Daily pipeline digest", description: "Email the pipeline summary." },
    });
    addHook({
      id: WEEKLY_HOOK, gatekeeperId: SCHEDULER_GK, vendorId: "scheduler",
      controller: { enable: vi.fn(async () => {}), disable: vi.fn(async () => {}),
                    getStatus: vi.fn(async () => { throw new Error("not called when off"); }) },
      callback: { onSchedule: vi.fn() }, enabled: false,
      description: { title: "Weekly cleanup", description: "Archive closed deals." },
    });
    addHook({
      id: INBOX_HOOK, gatekeeperId: EMAIL_GK, vendorId: "email",
      // A gatekeeper without getStatus(): on a real stub the call rejects.
      controller: { getStatus: async () => { throw new Error("getStatus is not implemented"); } },
      callback: { deliver: vi.fn() }, enabled: true,
      description: { title: "New mail", description: "Wake on new mail." },
    });
    impl.storage.boundHooks = {
      get: (id: number) => hooks.get(id),
      put: (record: FakeHook) => hooks.set(record.id, record),
      delete: (id: number) => hooks.delete(id),
      list: () => [...hooks.values()],
    };

    await fn({ impl, instance, hooks, onSchedule, controller, indexReads, indexes });
  });
}

function addUserMessage(impl: any, message: string): void {
  impl.storage.chats.put({
    chatId: CHAT_ID, sequence: impl.nextChatSequence(CHAT_ID),
    timestamp: new Date(Date.now() + 60_000 * impl.nextChatSequence(CHAT_ID)),
    author: OWNER, type: "message", message,
  });
}

type StepContext = Context & { tools: string[] };

async function runScriptedTurn(
    impl: any, steps: ReturnType<typeof fauxAssistantMessage>[],
    initiator: AiChatAuthorInfo = OWNER): Promise<StepContext[]> {
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
      { type: "agent", id: "faux-model", name: "Faux" }, new AbortController().signal, initiator,
      { provider: "cloudflare", model: "faux-model", apiToken: "" } as any);
  return contexts;
}

async function runToolTurn(impl: any, calls: ReturnType<typeof fauxToolCall>[],
                           initiator: AiChatAuthorInfo = OWNER): Promise<StepContext[]> {
  return runScriptedTurn(impl, [
    fauxAssistantMessage(calls, { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxText("Done.")),
  ], initiator);
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

function toolResultTexts(context: Context): string[] {
  return context.messages.flatMap(message => message.role === "toolResult"
      ? [message.content.map(part => part.type === "text" ? part.text : "").join("")]
      : []);
}

function changeRequests(impl: any): any[] {
  return [...impl.storage.actions.list()]
      .filter((record: any) => record.gatekeeperId === SCHEDULE_CHANGE_GK);
}

async function openAs(instance: OverseerDurableObject, userId: string): Promise<Overseer> {
  return await instance.open(
      userId, `${userId}-profile`, new NativeRpcStub<() => void>(() => {})) as Overseer;
}

// Await a stub call's rejection with a single handler (see overseer-hooks.test.ts).
async function rejectionOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (err) {
    return String(err);
  }
  throw new Error("expected the call to reject");
}

describe("tool set", () => {
  it("offers the four tools to the main agent and documents them in the system prompt",
      () => withHarness(async ({ impl }) => {
    let [context] = await runScriptedTurn(impl, [fauxAssistantMessage(fauxText("Done."))]);

    expect(context.tools).toEqual(expect.arrayContaining([
      "listSchedules", "requestScheduleChange", "runScheduleNow", "listWorkspaceOutputs",
    ]));
    expect(context.systemPrompt).toMatch(/After registering a schedule, call `listSchedules`/);
    expect(context.systemPrompt).toMatch(/use `requestScheduleChange`: it only asks the workspace owner/);
    expect(context.systemPrompt)
        .toMatch(/Before building a new Gadget, call `listWorkspaceOutputs`/);
  }));
});

describe("listSchedules", () => {
  it("lists every hook with its gadget, the scheduler's status and the last run's error",
      () => withHarness(async ({ impl, instance, onSchedule }) => {
    // A real firing, through startHook's per-firing wrapper, whose callback throws.
    onSchedule.mockImplementationOnce(async () => {
      throw new Error("Sheet \"Pipeline\" not found");
    });
    let { callback } = await instance.startHook(DAILY_HOOK);
    let failure = await rejectionOf((callback as any).onSchedule({
      scheduleId: "sched-daily", runId: "run-1", scheduledTime: 0, actualTime: 0,
      timeZone: "America/Chicago",
    }));
    expect(failure).toMatch(/Sheet "Pipeline" not found/);

    let contexts = await runToolTurn(impl, [fauxToolCall("listSchedules", {})]);
    let { schedules } = JSON.parse(toolResultTexts(contexts[1])[0]);

    expect(schedules).toHaveLength(3);
    let daily = schedules.find((s: any) => s.hookId === DAILY_HOOK);
    expect(daily).toMatchObject({
      title: "Daily pipeline digest",
      description: "Email the pipeline summary.",
      enabled: true,
      connection: "Scheduled Tasks",
      gadget: { id: APP_ID, title: "Sales Tracker" },
      status: {
        externalId: "sched-daily", state: "dead", cadence: "daily at 07:00",
        timeZone: "America/Chicago", endedAt: "2026-10-19T12:00:00.000Z",
        failureCode: "callback_failed", occurrences: { count: 10, used: 3 },
      },
      lastRun: {
        method: "onSchedule", outcome: "failed", stage: "callback", runId: "run-1",
        error: "Sheet \"Pipeline\" not found",
      },
      lastFailure: { outcome: "failed", error: "Sheet \"Pipeline\" not found" },
    });
    expect(Date.parse(daily.lastRun.at)).not.toBeNaN();

    // A disabled hook has no gatekeeper-side state, and its controller isn't asked.
    let weekly = schedules.find((s: any) => s.hookId === WEEKLY_HOOK);
    expect(weekly).toMatchObject({ enabled: false, title: "Weekly cleanup" });
    expect(weekly).not.toHaveProperty("status");
    expect(weekly).not.toHaveProperty("lastRun");

    // A gatekeeper that can't report says so instead of failing the listing.
    let inbox = schedules.find((s: any) => s.hookId === INBOX_HOOK);
    expect(inbox.statusError).toMatch(/didn't report this schedule's state/);
    expect(inbox).toMatchObject({ connection: "Inbox", enabled: true });

    // The recorded output is what the call returned.
    expect(callsNamed(impl, "listSchedules")[0].output!.schedules).toHaveLength(3);
  }));

  it("keeps the last failure when a later run succeeds, and forgets a deleted hook's runs",
      () => withHarness(async ({ impl, instance, onSchedule }) => {
    onSchedule.mockImplementationOnce(async () => { throw new Error("quota exceeded"); });
    let first = await instance.startHook(DAILY_HOOK);
    await rejectionOf((first.callback as any).onSchedule({ runId: "run-1" }));
    let second = await instance.startHook(DAILY_HOOK);
    await (second.callback as any).onSchedule({ runId: "run-2" });

    let [info] = (await impl.listSchedules()).filter((s: any) => s.hookId === DAILY_HOOK);
    expect(info.lastRun).toMatchObject({ outcome: "succeeded", runId: "run-2" });
    expect(info.lastFailure).toMatchObject({ outcome: "failed", runId: "run-1",
                                             error: "quota exceeded" });

    await impl.deleteHook(DAILY_HOOK);
    expect(impl.storage.hookRuns.get(DAILY_HOOK)).toBeUndefined();
  }));
});

describe("requestScheduleChange", () => {
  async function request(impl: any, hookId: number, action: string, reason = "It keeps failing.")
      : Promise<any> {
    let contexts = await runToolTurn(impl, [
      fauxToolCall("requestScheduleChange", { hookId, action, reason }),
    ]);
    let texts = toolResultTexts(contexts[1]);
    return JSON.parse(texts[texts.length - 1]);
  }

  it("queues an approval card naming the schedule, gadget, change and reason, changing nothing",
      () => withHarness(async ({ impl, hooks, controller }) => {
    let result = await request(impl, DAILY_HOOK, "disable");

    expect(result).toMatchObject({
      hookId: DAILY_HOOK, title: "Daily pipeline digest", action: "disable",
      status: "pendingOwnerApproval",
    });
    expect(result.message).toMatch(/pending the workspace owner's approval/);
    let [record] = changeRequests(impl);
    expect(result.actionId).toBe(record.id);
    expect(record).toMatchObject({
      type: "action", state: "pending", action: DAILY_HOOK,
      hookChange: { hookId: DAILY_HOOK, change: "disable" },
      caller: { from: "agent", chatId: CHAT_ID },
      description: {
        title: 'Disable schedule "Daily pipeline digest"',
        implementsRevert: false,
        fields: [
          { label: "Schedule", kind: "inline", value: "Daily pipeline digest" },
          { label: "Gadget", kind: "inline", value: "Sales Tracker" },
          { label: "Change", kind: "inline", value: "Disable" },
          { label: "Reason", kind: "text", value: "It keeps failing." },
        ],
      },
    });
    // Nothing applied.
    expect(hooks.get(DAILY_HOOK)!.enabled).toBe(true);
    expect(controller.disable).not.toHaveBeenCalled();
    // The card follows the step that made the call.
    let messages = chatMessages(impl);
    let cardIndex = messages.findIndex(msg => msg.type === "action" && msg.actionId === record.id);
    let callIndex = messages.findIndex(msg => msg.type === "message" &&
        msg.toolCalls?.some(call => call.toolName === "requestScheduleChange"));
    expect(callIndex).toBeGreaterThanOrEqual(0);
    expect(cardIndex).toBeGreaterThan(callIndex);
  }));

  it("applies a disable through the Connections path when the owner approves",
      () => withHarness(async ({ impl, instance, hooks, controller }) => {
    await request(impl, DAILY_HOOK, "disable");
    let [record] = changeRequests(impl);

    let owner = await openAs(instance, OWNER_USER_ID);
    await owner.approveAction(record.id);

    expect(controller.disable).toHaveBeenCalledTimes(1);
    expect(hooks.get(DAILY_HOOK)!.enabled).toBe(false);
    expect(impl.storage.actions.get(record.id)).toMatchObject({
      state: "approved", resolvedBy: OWNER, autoApproved: false,
    });
    await expect(owner.approveAction(record.id)).rejects.toThrow(/not pending/);
  }));

  it("enables through the same path, with its gatekeeper-side enable and record flip",
      () => withHarness(async ({ impl, instance, hooks }) => {
    await request(impl, WEEKLY_HOOK, "enable", "The user wants the weekly cleanup back.");
    let [record] = changeRequests(impl);

    let owner = await openAs(instance, OWNER_USER_ID);
    await owner.approveAction(record.id);

    let hook = hooks.get(WEEKLY_HOOK)!;
    expect(hook.controller.enable).toHaveBeenCalledTimes(1);
    expect(hook.controller.enable.mock.calls[0][1]).toEqual(
        { workspaceId: impl.ctx.id.toString(), gadgetId: APP_ID });
    expect(hook.enabled).toBe(true);
  }));

  it("deletes the hook when the owner approves a delete", () => withHarness(async (h) => {
    await request(h.impl, DAILY_HOOK, "delete");
    let [record] = changeRequests(h.impl);

    let owner = await openAs(h.instance, OWNER_USER_ID);
    await owner.approveAction(record.id);

    expect(h.hooks.has(DAILY_HOOK)).toBe(false);
    expect(h.controller.disable).toHaveBeenCalledTimes(1);
    expect(h.impl.storage.actions.get(record.id).state).toBe("approved");
  }));

  it("leaves the hook alone when the owner rejects", () => withHarness(async (h) => {
    await request(h.impl, DAILY_HOOK, "delete");
    let [record] = changeRequests(h.impl);

    let owner = await openAs(h.instance, OWNER_USER_ID);
    await owner.rejectAction(record.id);

    expect(h.hooks.get(DAILY_HOOK)!.enabled).toBe(true);
    expect(h.controller.disable).not.toHaveBeenCalled();
    expect(h.impl.storage.actions.get(record.id)).toMatchObject(
        { state: "rejected", resolvedBy: OWNER });
    await expect(owner.approveAction(record.id)).rejects.toThrow(/not pending/);
  }));

  it("refuses a build collaborator's decision either way", () => withHarness(async (h) => {
    await request(h.impl, DAILY_HOOK, "disable");
    let [record] = changeRequests(h.impl);

    let collaborator = await openAs(h.instance, COLLABORATOR_USER_ID);
    await expect(collaborator.approveAction(record.id))
        .rejects.toThrow(/Only the workspace owner can approve a change to a schedule/);
    await expect(collaborator.rejectAction(record.id))
        .rejects.toThrow(/Only the workspace owner/);

    expect(h.hooks.get(DAILY_HOOK)!.enabled).toBe(true);
    expect(h.impl.storage.actions.get(record.id).state).toBe("pending");
  }));

  it("is never applied by the auto-approval path", () => withHarness(async (h) => {
    await request(h.impl, DAILY_HOOK, "disable");
    let [record] = changeRequests(h.impl);

    await expect(h.impl.applyPendingAction(record, OWNER, true))
        .rejects.toThrow(/isn't applied through a connection/);
    await h.impl.drainAutoApprovals(SCHEDULE_CHANGE_GK);

    expect(h.hooks.get(DAILY_HOOK)!.enabled).toBe(true);
    expect(h.controller.disable).not.toHaveBeenCalled();
    expect(h.impl.storage.actions.get(record.id).state).toBe("pending");
  }));

  it("replays without queueing again, and reuses a pending request for the same change",
      () => withHarness(async ({ impl }) => {
    let first = await request(impl, DAILY_HOOK, "disable");

    // Replay of the first turn plus a repeat of the same request.
    addUserMessage(impl, "Again");
    let repeat = await request(impl, DAILY_HOOK, "disable", "Still failing.");
    expect(repeat).toMatchObject({ actionId: first.actionId, alreadyPending: true });

    // A different change to the same hook is its own request.
    addUserMessage(impl, "Delete it instead");
    let other = await request(impl, DAILY_HOOK, "delete");
    expect(other.actionId).not.toBe(first.actionId);

    expect(changeRequests(impl)).toHaveLength(2);
    expect(chatMessages(impl).filter(msg => msg.type === "action")).toHaveLength(2);
  }));

  it("refuses an unknown hook, a change that does nothing, and an empty reason",
      () => withHarness(async ({ impl }) => {
    await runToolTurn(impl, [
      fauxToolCall("requestScheduleChange", { hookId: 999, action: "delete", reason: "x" }),
      fauxToolCall("requestScheduleChange", { hookId: DAILY_HOOK, action: "enable", reason: "x" }),
      fauxToolCall("requestScheduleChange", { hookId: WEEKLY_HOOK, action: "disable",
                                              reason: "x" }),
      fauxToolCall("requestScheduleChange", { hookId: DAILY_HOOK, action: "delete",
                                              reason: "  " }),
    ]);

    let calls = callsNamed(impl, "requestScheduleChange");
    expect(calls.map(call => call.output)).toEqual([undefined, undefined, undefined, undefined]);
    expect(calls[0].error).toMatch(/No such schedule: 999/);
    expect(calls[1].error).toMatch(/already enabled/);
    expect(calls[2].error).toMatch(/already disabled/);
    expect(calls[3].error).toMatch(/Give a reason/);
    expect(changeRequests(impl)).toEqual([]);
  }));
});

describe("runScheduleNow", () => {
  it("fires an enabled schedule's callback once with a fresh runId and a manual marker",
      () => withHarness(async ({ impl, onSchedule }) => {
    let contexts = await runToolTurn(impl, [
      fauxToolCall("runScheduleNow", { hookId: DAILY_HOOK }),
    ]);

    expect(onSchedule).toHaveBeenCalledTimes(1);
    let firing = onSchedule.mock.calls[0][0] as any;
    expect(firing).toMatchObject({
      scheduleId: "sched-daily", timeZone: "America/Chicago", manual: true,
    });
    expect(firing.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(firing.scheduledTime).toBe(firing.actualTime);

    let result = JSON.parse(toolResultTexts(contexts[1])[0]);
    expect(result).toMatchObject({
      hookId: DAILY_HOOK, title: "Daily pipeline digest", scheduleId: "sched-daily",
      runId: firing.runId, outcome: "succeeded",
    });
    // It went through observation authorization, like a scheduler delivery.
    expect([...impl.storage.actions.list()].some((record: any) =>
        record.type === "observation" &&
        record.description.title === "Run scheduled task now: Daily pipeline digest"))
        .toBe(true);
    // And it is the hook's last run, marked manual.
    let [info] = (await impl.listSchedules()).filter((s: any) => s.hookId === DAILY_HOOK);
    expect(info.lastRun).toMatchObject({ outcome: "succeeded", manual: true,
                                         runId: firing.runId });

    // Replay returns the recorded result and never fires again.
    addUserMessage(impl, "Thanks");
    await runScriptedTurn(impl, [fauxAssistantMessage(fauxText("Done."))]);
    expect(onSchedule).toHaveBeenCalledTimes(1);
  }));

  it("reports the callback's error", () => withHarness(async ({ impl, onSchedule }) => {
    onSchedule.mockImplementationOnce(async () => { throw new Error("Token expired"); });

    let contexts = await runToolTurn(impl, [
      fauxToolCall("runScheduleNow", { hookId: DAILY_HOOK }),
    ]);

    let result = JSON.parse(toolResultTexts(contexts[1])[0]);
    expect(result).toMatchObject({ outcome: "failed", error: "Token expired" });
    let [info] = (await impl.listSchedules()).filter((s: any) => s.hookId === DAILY_HOOK);
    expect(info.lastFailure).toMatchObject({ manual: true, error: "Token expired" });
  }));

  it("refuses a disabled schedule, a hook that isn't a schedule, and an unknown id",
      () => withHarness(async ({ impl, hooks }) => {
    await runToolTurn(impl, [
      fauxToolCall("runScheduleNow", { hookId: WEEKLY_HOOK }),
      fauxToolCall("runScheduleNow", { hookId: INBOX_HOOK }),
      fauxToolCall("runScheduleNow", { hookId: 999 }),
    ]);

    let calls = callsNamed(impl, "runScheduleNow");
    expect(calls.map(call => call.output)).toEqual([undefined, undefined, undefined]);
    expect(calls[0].error).toMatch(/is disabled. Only enabled schedules can be run now/);
    expect(calls[1].error).toMatch(/isn't a scheduled task/);
    expect(calls[2].error).toMatch(/No such schedule: 999/);
    expect(hooks.get(WEEKLY_HOOK)!.callback.onSchedule).not.toHaveBeenCalled();
    expect(hooks.get(INBOX_HOOK)!.callback.deliver).not.toHaveBeenCalled();
  }));
});

describe("listWorkspaceOutputs", () => {
  function output(workspaceId: string, workspaceTitle: string, title: string,
                  extra: Partial<OutputSummary> = {}): OutputSummary {
    return {
      workspaceId, workpieceId: 1, title, workspaceTitle, created: new Date(0),
      lastActive: new Date(0), ...extra,
    };
  }

  it("lists the initiator's other workspaces by title only, excluding this one",
      () => withHarness(async ({ impl, indexes, indexReads }) => {
    let self = impl.ctx.id.toString();
    indexes.set(`named:${OWNER.id}`, [
      output("ws-a", "Leasing", "Rent Roll Tracker", {
        output: { id: "sheet", noun: "spreadsheet", plural: "spreadsheets", icon: "table" as any },
      }),
      output(self, "This Workspace", "Sales Tracker"),
      output("ws-b", "Acquisitions", "Deal Memo", {
        owner: { type: "user", id: "partner@example.com", name: "Partner" }, role: "build",
      }),
      output("ws-a", "Leasing", "Vacancy Board"),
    ]);

    let contexts = await runToolTurn(impl, [fauxToolCall("listWorkspaceOutputs", {})]);
    let result = JSON.parse(toolResultTexts(contexts[1])[0]);

    expect(indexReads).toEqual([`named:${OWNER.id}`]);
    expect(result).toEqual({
      workspaces: [
        { workspaceTitle: "Leasing", gadgets: [
          { title: "Rent Roll Tracker", format: "spreadsheet" },
          { title: "Vacancy Board" },
        ] },
        { workspaceTitle: "Acquisitions", gadgets: [{ title: "Deal Memo" }] },
      ],
    });
    // Nothing else from those workspaces reaches the model: no ids, owners or roles.
    let text = toolResultTexts(contexts[1])[0];
    expect(text).not.toContain("ws-a");
    expect(text).not.toContain("partner@example.com");
    expect(callsNamed(impl, "listWorkspaceOutputs")[0].output).toEqual(result);
  }));

  it("reads the initiator's index, so a collaborator sees only what is theirs to see",
      () => withHarness(async ({ impl, indexes, indexReads }) => {
    indexes.set(`named:${OWNER.id}`, [output("ws-private", "Owner Only", "Private Model")]);
    indexes.set(`named:${COLLABORATOR.id}`, [output("ws-c", "Shared Ops", "Work Orders")]);

    let contexts = await runToolTurn(
        impl, [fauxToolCall("listWorkspaceOutputs", {})], COLLABORATOR);
    let result = JSON.parse(toolResultTexts(contexts[1])[0]);

    expect(indexReads).toEqual([`named:${COLLABORATOR.id}`]);
    expect(result.workspaces).toEqual(
        [{ workspaceTitle: "Shared Ops", gadgets: [{ title: "Work Orders" }] }]);
    expect(JSON.stringify(result)).not.toContain("Owner Only");
  }));
});
