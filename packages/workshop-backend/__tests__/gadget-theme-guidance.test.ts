// The workspace has one light/dark switch that every gadget frame follows (see GadgetUI in
// workshop-frontend). The agent's system prompt must steer it away from building per-gadget theme
// toggles and toward styles that follow that switch. Drives the real runAgent with pi's faux
// provider and checks the prompt the model actually saw.

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import {
  createFauxCore, fauxAssistantMessage, fauxText, getCurrentSystemPrompt,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { AiChatAuthorInfo } from "@gadgets/workshop-shared/api";
import type { OverseerDurableObject } from "../src/overseer.js";
import { runAgent } from "../src/agent";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>;
  }
}

const OWNER: AiChatAuthorInfo = { type: "user", id: "owner@example.com", name: "Owner" };
const CHAT_ID = 1;

describe("gadget theme guidance", () => {
  it("tells the agent never to build a theme toggle and how to follow the workspace switch",
      async () => {
    let stub = env.TEST_OVERSEER.getByName("gadget-theme-guidance");
    let prompts: string[] = [];
    await runInDurableObject(stub, async (instance: OverseerDurableObject) => {
      let impl = (instance as unknown as { impl: any }).impl;
      impl.storage.chatMeta.put(
          { id: CHAT_ID, title: "Chat", started: new Date(0), lastActive: new Date(0) });
      impl.storage.chats.put({
        chatId: CHAT_ID, sequence: impl.nextChatSequence(CHAT_ID), timestamp: new Date(0),
        author: OWNER, type: "message", message: "Make me a dashboard",
      });
      let faux = createFauxCore({ models: [{ id: "faux-model" }] });
      faux.setResponses([(context: TranscriptContext) => {
        prompts.push(getCurrentSystemPrompt(context.messages) ?? "");
        return fauxAssistantMessage(fauxText("Done."));
      }]);
      await runAgent(impl, { model: faux.getModel(), stream: faux.stream }, CHAT_ID,
          { type: "agent", id: "faux-model", name: "Faux" }, new AbortController().signal, OWNER,
          { provider: "cloudflare", model: "faux-model", apiToken: "" } as any);
    });

    expect(prompts).toHaveLength(1);
    let prompt = prompts[0];
    expect(prompt).toContain(
        "NEVER build a theme or dark-mode toggle (or a light/dark/system dropdown) into a Gadget.");
    expect(prompt).toContain("The workspace has one light/dark switch and every Gadget follows it.");
    expect(prompt).toContain('`:root[data-theme="dark"]`');
    expect(prompt).toContain("`@media (prefers-color-scheme: dark)`");
    expect(prompt).toContain("`window.gadgetTheme`");
    expect(prompt).toContain("`gadget-theme` event");
  });
});
