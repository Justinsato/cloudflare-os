// The `env.WORKSPACE` binding: a read-only view of the workspace a gadget belongs to, present in
// every gadget's env (beneath any binding of the same name, which shadows it).
//
// Minted per loopback session by the overseer's binding-loopback dispatch (startGatekeeperSession,
// target type "workspace"). It grants nothing the gadget's users can't already see: the titles
// and ids of the workspace's committed gadgets, the same list the workspace's gadget picker shows
// every collaborator. A launcher (a "Workspace Home") reads it at render time instead of keeping
// its own copy, so its rows never go stale and always carry the id that opens the right gadget.

import { RpcTarget } from "cloudflare:workers";
import { sortByGadgetOrder } from "@gadgets/workshop-shared/gadget-order";
import type { WorkpieceId } from "@gadgets/workshop-shared/api";

/** The name of the `Workspace` binding in every gadget's env. */
export const WORKSPACE_BINDING_NAME = "WORKSPACE";

/** One gadget of the workspace, as `env.WORKSPACE.listGadgets()` returns it. */
export type WorkspaceGadget = {
  id: WorkpieceId;
  title: string;
  /** True on the calling gadget's own entry, so a launcher can leave itself out. */
  self: boolean;
};

/** What the binding reads from the overseer. */
export interface WorkspaceBindingHost {
  /** Every workpiece record (gadgets and worktrees). */
  listWorkpieces(): Iterable<{
    id: WorkpieceId;
    type: "gadget" | "worktree";
    title: string;
    pending?: { chatId: number };
  }>;
  /** The saved gadget display order (GadgetMetadata.gadgetOrder). */
  getGadgetOrder(): readonly WorkpieceId[];
}

/**
 * The gadgets `chatId`'s caller may see: committed gadgets, plus gadgets still provisional to that
 * chat (a chat's own preview sees what it is proposing; no other caller does). Worktrees are never
 * listed. Sorted by the workspace's saved order, then creation order.
 */
export function listWorkspaceGadgets(host: WorkspaceBindingHost, chatId: number | undefined,
                                     selfId: WorkpieceId | undefined): WorkspaceGadget[] {
  let visible: WorkspaceGadget[] = [];
  for (let record of host.listWorkpieces()) {
    if (record.type !== "gadget") continue;
    if (record.pending && record.pending.chatId !== chatId) continue;
    visible.push({ id: record.id, title: record.title, self: record.id === selfId });
  }
  return sortByGadgetOrder(visible, host.getGadgetOrder());
}

/** The RpcTarget behind a gadget's `env.WORKSPACE` session. */
export class WorkspaceImpl extends RpcTarget {
  constructor(private host: WorkspaceBindingHost, private chatId: number | undefined,
              private selfId: WorkpieceId | undefined) {
    super();
  }

  /** The workspace's gadgets, in the order its gadget picker shows them. */
  listGadgets(): WorkspaceGadget[] {
    return listWorkspaceGadgets(this.host, this.chatId, this.selfId);
  }
}

/** The agent-facing contract, for the describeBinding tool. */
export const WORKSPACE_BINDING_TYPES = `\
interface Workspace {
  // Every gadget of this workspace (including the calling gadget), in the order the workspace's
  // gadget picker shows them. Read-only. Call it each time you render: the list is live, so
  // renamed, added and removed gadgets show up without any stored copy to keep in sync.
  // \`self\` is true on the calling gadget's own entry.
  listGadgets(): Promise<{id: number, title: string, self: boolean}[]>;
}
`;
