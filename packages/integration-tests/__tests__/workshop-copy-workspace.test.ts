// Brick: AuthenticatedApi.copyWorkspace end to end, through the real Worker. A copy carries every
// gadget's committed code into a new workspace owned by the caller, or (admins only) by a user
// who has signed in once; the caller's own access to the source is what gates it.
import type { RpcStub } from "capnweb";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { AuthenticatedApi, Overseer, WorkpieceId } from "@gadgets/workshop-shared/api";
import { diffFiles, type CodeContent } from "@gadgets/workshop-shared/code-change";
import { ADMIN_USERNAME, type Harness, startHarness } from "../src/harness.js";
import { mockChatCompletion } from "../src/mock-model.js";
import { NetworkInterceptor } from "../src/network-interceptor.js";
import { connect, nextUsernames, signUp, waitFor, WorkpieceRecorder } from "../src/rpc-client.js";

let harness: Harness | undefined;
const network = new NetworkInterceptor({ handlers: [mockChatCompletion("Test chat")] });

beforeAll(async () => {
  network.install();
  harness = await startHarness({ gatekeepers: [] });
});

afterAll(async () => {
  try {
    await harness?.server.close();
    expect(network.getUnmockedCalls()).toEqual([]);
  } finally {
    network.uninstall();
  }
});

function requireHarness(): Harness {
  if (harness === undefined) throw new Error("Workshop harness did not start");
  return harness;
}

const ui = (gadgetId: WorkpieceId, text?: string): CodeContent =>
  new Map([[gadgetId, new Map(text === undefined ? [] : [["client.js", text]])]]);

const APP_UI = "export default 'rent roll';\n";

async function headOf(workpieces: WorkpieceRecorder, gadgetId: WorkpieceId, after?: string) {
  return waitFor(`a head for gadget ${gadgetId}`, async () => {
    const summary = workpieces.summaries.get(gadgetId);
    return summary?.type === "gadget" && summary.commitId !== undefined &&
        summary.commitId !== after ? summary.commitId : null;
  });
}

// A workspace with one committed gadget, "Rent Roll", whose UI is APP_UI.
async function seedWorkspace(owner: RpcStub<AuthenticatedApi>): Promise<string> {
  using workspace = await owner.newWorkspace();
  const workpieces = new WorkpieceRecorder();
  using _subscription = await workspace.subscribeToWorkpieces(workpieces);
  await workpieces.loaded;
  using gadget = workspace.createGadget("Rent Roll", undefined, "RENT_ROLL");
  const gadgetId = await gadget.getId();
  const empty = await headOf(workpieces, gadgetId);
  const seed = await workspace.newChat("Seed", null);
  await workspace.submitCodeChange(seed, {
    generation: 0, revision: 0, clientId: "seed", seq: 1,
    pins: [{ gadgetId, baseCommit: empty }],
    change: diffFiles(ui(gadgetId), ui(gadgetId, APP_UI)),
  });
  expect(await workspace.mergeChanges(seed)).toEqual({ outcome: "merged" });
  await headOf(workpieces, gadgetId, empty);
  await workspace.setTitle("Capital · Review · Rent Roll · Monthly");
  return (await workspace.getMetadata()).id;
}

async function uiOf(workspace: RpcStub<Overseer>, title: string): Promise<string | undefined> {
  const workpieces = new WorkpieceRecorder();
  using _subscription = await workspace.subscribeToWorkpieces(workpieces);
  await workpieces.loaded;
  const summary = [...workpieces.summaries.values()].find(
      s => s.type === "gadget" && s.title === title);
  if (!summary) return undefined;
  using gadget = await workspace.getGadget(summary.id);
  return (await gadget.getUiBundle())?.jsCode;
}

it("copies a workspace for its owner, its build collaborators, and (as an admin) for another user",
    async () => {
  const [ownerName, buildName, useName, strangerName, newName] =
      nextUsernames("owner", "builder", "user", "stranger", "newhire");
  using ownerPublic = connect(requireHarness().url);
  using owner = await signUp(ownerPublic, ownerName!);
  await expect(owner.copyWorkspace("not-an-id")).rejects.toThrow(/Not a workspace id/);
  const sourceId = await seedWorkspace(owner);

  // The owner copies it: same title by default, same code, listed at once.
  const copy = await owner.copyWorkspace(sourceId);
  expect(copy.title).toBe("Capital · Review · Rent Roll · Monthly");
  expect(copy.report).toEqual({
    gadgets: ["Rent Roll"], bound: [], unbound: [], hooksNotCopied: 0,
  });
  expect(copy.id).not.toBe(sourceId);
  expect((await owner.listWorkspaces()).map(w => w.id)).toContain(copy.id);
  {
    using copied = await owner.openGadget(copy.id);
    expect(await uiOf(copied, "Rent Roll")).toBe(APP_UI);
  }

  // A build collaborator copies into their own account; a use collaborator and a stranger can't.
  using builderPublic = connect(requireHarness().url);
  using builder = await signUp(builderPublic, buildName!);
  using userPublic = connect(requireHarness().url);
  using user = await signUp(userPublic, useName!);
  using strangerPublic = connect(requireHarness().url);
  using stranger = await signUp(strangerPublic, strangerName!);
  {
    using source = await owner.openGadget(sourceId);
    expect(await source.addCollaborator(buildName!, "build")).not.toBeNull();
    expect(await source.addCollaborator(useName!, "use")).not.toBeNull();
  }
  const builderCopy = await builder.copyWorkspace(sourceId, { title: "Ops · Review · Rent Roll" });
  expect(builderCopy.title).toBe("Ops · Review · Rent Roll");
  expect((await builder.listWorkspaces()).find(w => w.id === builderCopy.id)?.owner).toBeUndefined();
  await expect(user.copyWorkspace(sourceId)).rejects.toThrow(/only has permission to use/);
  await expect(stranger.copyWorkspace(sourceId)).rejects.toThrow();

  // Only an admin may copy into someone else's account, and only once they have signed in.
  await expect(owner.copyWorkspace(sourceId, { forUser: strangerName }))
      .rejects.toThrow(/Only an admin/);
  using adminPublic = connect(requireHarness().url);
  using admin = await signUp(adminPublic, ADMIN_USERNAME);
  {
    using source = await owner.openGadget(sourceId);
    expect(await source.addCollaborator(ADMIN_USERNAME, "build")).not.toBeNull();
  }
  await expect(admin.copyWorkspace(sourceId, { forUser: newName }))
      .rejects.toThrow(/has not signed in to this OS yet/);
  using newPublic = connect(requireHarness().url);
  using newHire = await signUp(newPublic, newName!);
  const forNewHire = await admin.copyWorkspace(sourceId, { forUser: newName });
  expect((await newHire.listWorkspaces()).map(w => w.id)).toContain(forNewHire.id);
  expect((await admin.listWorkspaces()).map(w => w.id)).not.toContain(forNewHire.id);
  {
    using copied = await newHire.openGadget(forNewHire.id);
    expect((await copied.getMetadata()).owner).toBeUndefined();
    expect(await uiOf(copied, "Rent Roll")).toBe(APP_UI);
  }
});
