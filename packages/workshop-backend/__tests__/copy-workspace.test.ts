// Brick: workspace copy (AuthenticatedApi.copyWorkspace). A source workspace exports a template of
// its permanent gadgets, their committed files and their bindings by what they reach; a fresh
// workspace builds from it, rebuilding every connection on its own owner's accounts and reporting
// the ones it can't. Runs the real OverseerImpl in a Durable Object, with the owner's user DO and
// gatekeeper creation faked at their boundaries.

import { describe, expect, it } from "vitest";
import { env, RpcStub as NativeRpcStub } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import type { AiChatAuthorInfo, Overseer, WorkspaceTemplate } from "@gadgets/workshop-shared/api";
import type { OverseerDurableObject } from "../src/overseer.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>;
  }
}

const OWNER_USER_ID = "owner-user-do";
const OWNER: AiChatAuthorInfo = { type: "user", id: "owner@example.com", name: "Owner" };

let doCounter = 0;

async function inWorkspace(fn: (impl: any, instance: OverseerDurableObject) => Promise<void>)
    : Promise<void> {
  let stub = env.TEST_OVERSEER.getByName(`copy-workspace-${++doCounter}`);
  await runInDurableObject(stub, async (instance: OverseerDurableObject) => {
    let impl = (instance as unknown as { impl: any }).impl;
    impl.ownerId = OWNER_USER_ID;
    impl.storage.title.put("Capital · Review · Loans · Monthly");
    await fn(impl, instance);
  });
}

async function commitFiles(impl: any, files: Record<string, string>): Promise<string> {
  return await impl.gitStore.writeFilesAsCommit(new Map(Object.entries(files)), {
    parents: [],
    author: { name: "Owner", email: "owner@example.com" },
    message: "test commit",
    timestamp: new Date(1700000000_000),
  });
}

function putGatekeeper(impl: any, spec: object, extra: object = {}): number {
  let id = impl.allocateWorkpieceId();
  impl.storage.gatekeepers.put({ id, class: {}, creationSpec: spec, ...extra });
  return id;
}

function bind(impl: any, gadgetId: number, name: string, target: number, pending?: object): void {
  let record = impl.getGadgetRecord(gadgetId);
  record.bindings[name] = { target, ...(pending ? { pending } : {}) };
  impl.storage.gadgets.put(record);
}

// A source with: a default gadget (Home) that binds a sibling; a Rent Roll gadget with a format
// and one of each connection kind, plus a pending edge and a dangling one; a pending gadget; and
// a saved display order that puts Rent Roll first.
async function buildSource(impl: any): Promise<{home: number, rentRoll: number}> {
  let home = impl.ensureDefaultGadget(await commitFiles(impl, { "index.ts": "home" }));
  let rentRoll = impl.createGadget("Rent Roll", "RENT_ROLL", undefined,
      { output: { noun: "report", icon: "table" } },
      await commitFiles(impl, { "index.ts": "rent roll", "ui/App.tsx": "<App/>" }));
  impl.createGadget("Draft", "DRAFT", 1);

  let pkm = putGatekeeper(impl, { type: "ambient", vendorId: "pkm", accountId: 3 });
  let sheet = putGatekeeper(impl,
      { type: "gatekeeper", vendorId: "google", typeUrlPattern: "https://docs.google.com/*" },
      { resourceUrl: "https://docs.google.com/spreadsheets/d/abc", resourceTitle: "Rent Roll" });
  let slack = putGatekeeper(impl, { type: "gatekeeper", vendorId: "slack",
      resourceUrl: "https://slack.com/c/ops", typeUrlPattern: "https://slack.com/c/*" });
  let model = putGatekeeper(impl,
      { type: "aiModel", modelId: "sonnet", provider: "anthropic", modelName: "claude-sonnet" });
  let spawner = putGatekeeper(impl, { type: "agentSpawner",
      config: { displayName: "Reviewer", modelId: null, env: {} } });

  bind(impl, home, "RENT_ROLL", rentRoll.id);
  bind(impl, home, "SHEET", sheet);
  bind(impl, rentRoll.id, "PKM", pkm);
  bind(impl, rentRoll.id, "SHEET", sheet);
  bind(impl, rentRoll.id, "SLACK", slack);
  bind(impl, rentRoll.id, "MODEL", model);
  bind(impl, rentRoll.id, "REVIEWER", spawner);
  bind(impl, rentRoll.id, "PROPOSED", pkm, { chatId: 1 });
  bind(impl, rentRoll.id, "GONE", 9999);

  impl.storage.boundHooks.put({ id: 1, actionId: 1, gatekeeperId: sheet, gadgetId: rentRoll.id });
  impl.storage.gadgetOrder.put([rentRoll.id, home]);
  return { home, rentRoll: rentRoll.id };
}

describe("exportTemplate", () => {
  it("carries permanent gadgets in display order, with bindings by what they reach",
      () => inWorkspace(async impl => {
    await buildSource(impl);
    let template: WorkspaceTemplate = await impl.exportTemplate();

    expect(template.title).toBe("Capital · Review · Loans · Monthly");
    expect(template.gadgets.map(g => g.title)).toEqual(["Rent Roll", "Capital · Review · Loans · Monthly"]);
    expect(template.defaultGadget).toBe(1);
    expect(template.hookCount).toBe(1);

    let [rentRoll, home] = template.gadgets;
    expect(Object.fromEntries(rentRoll.files))
        .toEqual({ "index.ts": "rent roll", "ui/App.tsx": "<App/>" });
    expect(rentRoll.output).toEqual({ noun: "report", icon: "table" });
    expect(rentRoll.bindingName).toBe("RENT_ROLL");
    expect(rentRoll.bindings).toEqual({
      PKM: { kind: "ambient", vendorId: "pkm" },
      SHEET: { kind: "gatekeeper", vendorId: "google", typeUrlPattern: "https://docs.google.com/*",
               resourceUrl: "https://docs.google.com/spreadsheets/d/abc", title: "Rent Roll" },
      SLACK: { kind: "gatekeeper", vendorId: "slack", typeUrlPattern: "https://slack.com/c/*",
               resourceUrl: "https://slack.com/c/ops" },
      MODEL: { kind: "aiModel", modelId: "sonnet", provider: "anthropic",
               modelName: "claude-sonnet" },
      REVIEWER: { kind: "agentSpawner", title: "Reviewer" },
    });
    expect(home.bindings).toEqual({
      RENT_ROLL: { kind: "gadget", gadget: 0 },
      SHEET: rentRoll.bindings.SHEET,
    });
  }));
});

type Fakes = {
  provisioned: string[];
  created: {spec: any}[];
  activated: string[];
};

// The new owner's user DO, as buildFromTemplate reaches it: one Google account, no Slack, the
// pkm singleton provisionable, and an AI model named "sonnet".
function fakeOwner(impl: any): Fakes {
  let fakes: Fakes = { provisioned: [], created: [], activated: [] };
  let userDo = {
    whoami: async () => OWNER,
    provisionAmbientAccount: async (vendorId: string) => {
      if (vendorId !== "pkm") throw new Error(`The "${vendorId}" gatekeeper is disabled.`);
      fakes.provisioned.push(vendorId);
    },
    listAccountIdsForVendor: async (vendorId: string) => vendorId === "google" ? [7] : [],
    getGatekeeperClassFor: async (accountId: number, url: string) => {
      expect(accountId).toBe(7);
      expect(url).toBe("https://docs.google.com/spreadsheets/d/abc");
      return { class: "google-class", vendorId: "google",
               typeUrlPattern: "https://docs.google.com/*" };
    },
    getChatContext: async (modelId: string) => ({
      profile: OWNER,
      aiModel: { profile: { type: "ai", id: modelId, name: "Sonnet" },
                 config: { provider: "anthropic", model: "claude-sonnet" } },
    }),
    setWorkspaceLastActive: async (id: string) => { fakes.activated.push(id); },
    syncWorkspaceOutputs: async () => {},
  };
  impl.users = { idFromString: (id: string) => id, get: () => userDo };
  impl.wrapUserDo = (stub: unknown) => stub;
  impl.ensureAmbientCapsules = async () => {
    if (![...impl.storage.gatekeepers.list()].some((gk: any) => gk.creationSpec?.type === "ambient")) {
      putGatekeeper(impl, { type: "ambient", vendorId: "pkm", accountId: 41 });
    }
  };
  // The test pool's ctx.exports has no model gatekeeper classes; the class is opaque here anyway.
  let ctx = impl.ctx;
  impl.ctx = Object.assign(Object.create(ctx), {
    id: ctx.id,
    exports: { LanguageModelGatekeeper: () => "lm-class", DecisionModelGatekeeper: () => "dm-class" },
  });
  impl.addGatekeeper = async (_cls: unknown, spec: any) => {
    fakes.created.push({ spec });
    let id = putGatekeeper(impl, spec);
    return { getId: async () => id };
  };
  return fakes;
}

describe("buildFromTemplate", () => {
  async function exported(): Promise<WorkspaceTemplate> {
    let template!: WorkspaceTemplate;
    await inWorkspace(async impl => {
      await buildSource(impl);
      template = await impl.exportTemplate();
    });
    return template;
  }

  it("rebuilds gadgets, code and connections on the new owner's accounts",
      async () => {
    let template = await exported();
    await inWorkspace(async impl => {
      impl.storage.title.put("Copy");
      let fakes = fakeOwner(impl);
      let report = await impl.buildFromTemplate(template);

      let gadgets = [...impl.storage.gadgets.list()];
      expect(gadgets).toHaveLength(2);
      let rentRoll = gadgets.find((g: any) => g.title === "Rent Roll");
      let home = gadgets.find((g: any) => g.id === impl.defaultGadgetId);
      expect(home.title).toBe("Capital · Review · Loans · Monthly");
      expect(home.bindingName).toBe("GADGET");
      expect(rentRoll.bindingName).toBe("RENT_ROLL");
      expect(rentRoll.output).toEqual({ noun: "report", icon: "table" });
      expect(rentRoll.upstream).toEqual({});
      expect(impl.storage.gadgetOrder.get()).toEqual([rentRoll.id, home.id]);

      let files = await impl.gitStore.readCommitFiles(rentRoll.commitId);
      expect(Object.fromEntries(files)).toEqual({ "index.ts": "rent roll", "ui/App.tsx": "<App/>" });

      // The sibling edge points at the copy; the sheet is one connection, shared by both gadgets
      // as in the source; the ambient pkm record is the new owner's.
      expect(home.bindings.RENT_ROLL.target).toBe(rentRoll.id);
      expect(home.bindings.SHEET.target).toBe(rentRoll.bindings.SHEET.target);
      let gatekeepers = new Map([...impl.storage.gatekeepers.list()].map((gk: any) => [gk.id, gk]));
      expect(gatekeepers.get(rentRoll.bindings.PKM.target).creationSpec)
          .toEqual({ type: "ambient", vendorId: "pkm", accountId: 41 });
      expect(gatekeepers.get(rentRoll.bindings.SHEET.target).creationSpec).toEqual({
        type: "gatekeeper", vendorId: "google", typeUrlPattern: "https://docs.google.com/*",
        resourceUrl: "https://docs.google.com/spreadsheets/d/abc",
      });
      expect(gatekeepers.get(rentRoll.bindings.MODEL.target).creationSpec).toEqual({
        type: "aiModel", modelId: "sonnet", provider: "anthropic", modelName: "claude-sonnet",
      });
      expect(fakes.created.filter(c => c.spec.type === "gatekeeper")).toHaveLength(1);
      expect(fakes.provisioned).toEqual(["pkm"]);
      expect(rentRoll.bindings.SLACK).toBeUndefined();
      expect(rentRoll.bindings.REVIEWER).toBeUndefined();

      expect(report.gadgets).toEqual(["Rent Roll", "Capital · Review · Loans · Monthly"]);
      expect(report.hooksNotCopied).toBe(1);
      expect(report.bound).toHaveLength(5);
      expect(report.unbound).toEqual([
        { gadget: "Rent Roll", binding: "SLACK",
          reason: "No connected slack account. Connect one, then bind https://slack.com/c/ops." },
        { gadget: "Rent Roll", binding: "REVIEWER",
          reason: expect.stringMatching(/Agent spawner "Reviewer" is not copied/) },
      ]);
    });
  });

  it("reports an ambient connection the new owner can't have", async () => {
    let template = await exported();
    template.gadgets[0].bindings = { BACK9: { kind: "ambient", vendorId: "back9" } };
    await inWorkspace(async impl => {
      fakeOwner(impl);
      let report = await impl.buildFromTemplate(template);
      expect(report.unbound).toEqual([{ gadget: "Rent Roll", binding: "BACK9",
          reason: `The "back9" gatekeeper is disabled.` }]);
    });
  });

  it("refuses a workspace that already has gadgets", async () => {
    let template = await exported();
    await inWorkspace(async impl => {
      fakeOwner(impl);
      impl.ensureDefaultGadget(await commitFiles(impl, {}));
      await expect(impl.buildFromTemplate(template)).rejects.toThrow(/while it is empty/);
    });
  });
});

describe("exportWorkspaceTemplate", () => {
  async function openAs(instance: OverseerDurableObject, role: "build" | "use"): Promise<Overseer> {
    let impl = (instance as unknown as { impl: any }).impl;
    let userDo = {
      whoami: async () => OWNER,
      whoamiIfExists: async () => OWNER,
      getChatContext: async () => ({ profile: OWNER }),
      recordSharedGadgetOpen: async () => {},
      getGadget: async () => ({ id: impl.ctx.id.toString(), title: "T", created: new Date(0) }),
    };
    impl.users = { idFromString: (id: string) => id, get: () => userDo };
    impl.wrapUserDo = (stub: unknown) => stub;
    impl.ensureAmbientCapsules = async () => {};
    impl.authorizeCollaborator = async () => role;
    return await instance.open("collaborator-user-do", "collab-profile",
        new NativeRpcStub<() => void>(() => {})) as Overseer;
  }

  it("is open to the build role and refused to the use role",
      () => inWorkspace(async (impl, instance) => {
    impl.ensureDefaultGadget(await commitFiles(impl, { "index.ts": "home" }));
    let build = await openAs(instance, "build");
    expect((await build.exportWorkspaceTemplate()).gadgets).toHaveLength(1);
    let use = await openAs(instance, "use");
    await expect(use.exportWorkspaceTemplate()).rejects.toThrow(/only has permission to use/);
  }));
});
