// A gadget can bind another gadget: the edge is recorded like a connection's, and removing the
// target severs it. (Calls through the loopback can't run under the vitest pool; they are
// exercised live.)

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import type { OverseerDurableObject } from "../src/overseer.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>;
  }
}

const CALLER = 1;
const TARGET = 2;

const CALLER_JS = `
import { DurableObject } from "cloudflare:workers";

export class Gadget extends DurableObject {
  async viaBinding(x) {
    return await this.env.TARGET.double(x);
  }

  hasTarget() {
    return "TARGET" in this.env;
  }
}
`;

const TARGET_JS = `
import { DurableObject } from "cloudflare:workers";

export class Gadget extends DurableObject {
  async double(x) {
    await new Promise(resolve => setTimeout(resolve, 10));
    return x * 2;
  }
}
`;

let doCounter = 0;

async function withGadgets(fn: (impl: any) => Promise<void>): Promise<void> {
  let stub = env.TEST_OVERSEER.getByName(`gadget-to-gadget-${++doCounter}`);
  await runInDurableObject(stub, async (instance: OverseerDurableObject) => {
    let impl = (instance as unknown as { impl: any }).impl;
    for (let [id, code, title] of [[CALLER, CALLER_JS, "Caller"], [TARGET, TARGET_JS, "Target"]] as const) {
      let commitId = await impl.gitStore.writeFilesAsCommit(new Map([["server.js", code]]), {
        parents: [],
        author: { name: "Alice", email: "alice@example.com" },
        message: "test commit",
        timestamp: new Date(1700000000_000),
      });
      impl.storage.gadgets.put({
        type: "gadget", id, title, created: new Date(0), bindingName: title.toUpperCase(),
        bindings: {}, commitId,
      });
    }
    await fn(impl);
  });
}

describe("gadget-to-gadget bindings", () => {
  it("records the edge and titles it by the target gadget", () => withGadgets(async impl => {
    impl.bindWorkpiece(CALLER, "TARGET", TARGET);
    expect(impl.getGadgetRecord(CALLER).bindings).toEqual({ TARGET: { target: TARGET } });
    expect(impl.bindingTargetTitle(TARGET)).toBe("Target");
  }));

  it("refuses binding a gadget to itself", () => withGadgets(async impl => {
    expect(() => impl.bindWorkpiece(CALLER, "SELF", CALLER)).toThrow(/cannot bind itself/);
  }));

  it("severs the edge when the target gadget is removed", () => withGadgets(async impl => {
    impl.bindWorkpiece(CALLER, "TARGET", TARGET);
    await impl.removeWorkpiece(TARGET);
    expect(impl.getGadgetRecord(CALLER).bindings).toEqual({});
  }));
});
