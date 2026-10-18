// Client calls into a gadget all ride one long-lived WebSocket request, and the runtime fails the
// 11th concurrent dynamic worker invocation in a request outright ("Dynamic worker concurrency
// limit exceeded"). A workspace with many gadgets open fires that many at once on every
// reconnect, so the stub getGadgetFacet hands out queues calls past its limit instead.
//
// Runs a real gadget, loaded from a real commit, inside a real OverseerDurableObject.

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import type { OverseerDurableObject } from "../src/overseer.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>;
  }
}

const GADGET_ID = 1;

// Tracks how many calls are running inside the facet at once.
const SERVER_JS = `
import { DurableObject } from "cloudflare:workers";

export class Gadget extends DurableObject {
  running = 0;
  peak = 0;

  async slow(ms) {
    this.running++;
    this.peak = Math.max(this.peak, this.running);
    try {
      await new Promise(resolve => setTimeout(resolve, ms));
      return "done";
    } finally {
      this.running--;
    }
  }

  fail() {
    throw new Error("boom");
  }

  getPeak() {
    return this.peak;
  }
}
`;

let doCounter = 0;

async function withGadget(fn: (impl: any) => Promise<void>): Promise<void> {
  let stub = env.TEST_OVERSEER.getByName(`gadget-call-limit-${++doCounter}`);
  await runInDurableObject(stub, async (instance: OverseerDurableObject) => {
    let impl = (instance as unknown as { impl: any }).impl;
    let commitId = await impl.gitStore.writeFilesAsCommit(new Map([["server.js", SERVER_JS]]), {
      parents: [],
      author: { name: "Alice", email: "alice@example.com" },
      message: "test commit",
      timestamp: new Date(1700000000_000),
    });
    impl.storage.gadgets.put({
      type: "gadget", id: GADGET_ID, title: "G", created: new Date(0), bindingName: "G",
      bindings: {}, commitId,
    });
    await fn(impl);
  });
}

describe("gadget call limit", () => {
  it("queues calls past the limit instead of running them all at once",
      () => withGadget(async impl => {
    using gadget = await impl.getGadgetFacet(GADGET_ID);
    let results = await Promise.all(Array.from({ length: 20 }, () => gadget.slow(50)));
    expect(results).toEqual(Array(20).fill("done"));
    let peak = await gadget.getPeak();
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
  }));

  it("frees the slot when a call throws", () => withGadget(async impl => {
    using gadget = await impl.getGadgetFacet(GADGET_ID);
    let failures = await Promise.allSettled(Array.from({ length: 12 }, () => gadget.fail()));
    expect(failures.every(r => r.status === "rejected")).toBe(true);
    // Every slot came back: a full batch still runs.
    let results = await Promise.all(Array.from({ length: 8 }, () => gadget.slow(10)));
    expect(results).toEqual(Array(8).fill("done"));
  }));
});
