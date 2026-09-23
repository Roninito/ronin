/**
 * ToolRouter name-resolution tests.
 *
 * Verifies alias/suffix resolution, including the spurious `local_` prefix
 * models sometimes emit for plugin tools.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { ToolRouter } from "../src/tools/ToolRouter.js";
import type { DutyAPI } from "../src/types/index.js";

function buildApi(): DutyAPI {
  return {
    events: {
      emit: () => {},
      on: () => {},
      off: () => {},
      beam: () => {},
      query: async () => undefined,
      reply: () => {},
      getRegisteredEvents: () => [],
    },
    memory: {
      store: async () => {},
      retrieve: async () => undefined,
      search: async () => [],
      addContext: async () => "",
      getRecent: async () => [],
      forget: async () => true,
      forgetByKeyPrefix: async () => 0,
      countByKeyPrefix: async () => 0,
      addConversation: async () => "",
      getConversations: async () => [],
      getBlackboard: async () => "",
      setBlackboard: async () => {},
      appendBlackboard: async () => {},
      getRootDir: () => "",
    },
  } as unknown as DutyAPI;
}

describe("ToolRouter.resolveToolName aliases", () => {
  let router: ToolRouter;

  beforeEach(() => {
    process.env.RONIN_QUIET = "1";
    router = new ToolRouter(buildApi());
    router.register({
      name: "local.speech.say",
      description: "Say something",
      parameters: { type: "object", properties: {} },
      provider: "local",
      handler: async () => ({ success: true, data: "ok" }),
    });
    router.register({
      name: "obsidian_getVaults",
      description: "List vaults",
      parameters: { type: "object", properties: {} },
      provider: "plugin:obsidian",
      handler: async () => ({ success: true, data: [] }),
    });
    router.register({
      name: "email_getInbox",
      description: "Get inbox",
      parameters: { type: "object", properties: {} },
      provider: "plugin:email",
      handler: async () => ({ success: true, data: [] }),
    });
  });

  it("resolves exact registered names", async () => {
    const result = await router.execute({ id: "t1", name: "obsidian_getVaults", arguments: {} }, { conversationId: "c1" });
    expect(result.success).toBe(true);
    expect(result.metadata.toolName).toBe("obsidian_getVaults");
  });

  it("resolves local.speech.say from alias 'say'", async () => {
    const result = await router.execute({ id: "t2", name: "say", arguments: {} }, { conversationId: "c1" });
    expect(result.success).toBe(true);
    expect(result.metadata.toolName).toBe("local.speech.say");
  });

  it("resolves plugin tools with spurious local_ prefix", async () => {
    const result = await router.execute({ id: "t3", name: "local_obsidian_getVaults", arguments: {} }, { conversationId: "c1" });
    expect(result.success).toBe(true);
    expect(result.metadata.toolName).toBe("obsidian_getVaults");
  });

  it("resolves local.* style names via underscore-to-dot conversion", async () => {
    const result = await router.execute({ id: "t4", name: "local_speech_say", arguments: {} }, { conversationId: "c1" });
    expect(result.success).toBe(true);
    expect(result.metadata.toolName).toBe("local.speech.say");
  });

  it("reports failure clearly for genuinely unknown tools", async () => {
    const result = await router.execute({ id: "t5", name: "does_not_exist", arguments: {} }, { conversationId: "c1" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});
