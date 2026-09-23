import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import telegramPlugin, { resolveChatId } from "../plugins/telegram.js";
import { getConfigService, resetConfigService } from "../src/config/ConfigService.js";

const TEST_ROOT = join(process.cwd(), ".test-telegram");

describe("Telegram Plugin", () => {
  const originalChatId = process.env.TELEGRAM_CHAT_ID;
  const originalConfigPath = process.env.RONIN_CONFIG_PATH;

  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) {
      rmSync(TEST_ROOT, { recursive: true });
    }
    mkdirSync(TEST_ROOT, { recursive: true });
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.RONIN_CONFIG_PATH;
    resetConfigService();

    const configPath = join(TEST_ROOT, "config.json");
    writeFileSync(configPath, JSON.stringify({ telegram: { chatId: "" } }, null, 2));
    process.env.RONIN_CONFIG_PATH = configPath;
    await getConfigService().load();
  });

  afterEach(() => {
    if (originalChatId !== undefined) {
      process.env.TELEGRAM_CHAT_ID = originalChatId;
    } else {
      delete process.env.TELEGRAM_CHAT_ID;
    }
    if (originalConfigPath !== undefined) {
      process.env.RONIN_CONFIG_PATH = originalConfigPath;
    } else {
      delete process.env.RONIN_CONFIG_PATH;
    }
    resetConfigService();
    if (existsSync(TEST_ROOT)) {
      rmSync(TEST_ROOT, { recursive: true });
    }
  });

  describe("resolveChatId", () => {
    it("returns an explicit chatId when provided", () => {
      expect(resolveChatId("@mychannel")).toBe("@mychannel");
      expect(resolveChatId(123456)).toBe(123456);
    });

    it("throws when no chatId is available", () => {
      expect(() => resolveChatId()).toThrow("No Telegram chatId provided");
      expect(() => resolveChatId("")).toThrow("No Telegram chatId provided");
    });

    it("falls back to TELEGRAM_CHAT_ID env", () => {
      process.env.TELEGRAM_CHAT_ID = "env-default";
      expect(resolveChatId()).toBe("env-default");
    });

    it("prefers config.telegram.chatId over env", async () => {
      process.env.TELEGRAM_CHAT_ID = "env-default";
      const cfg = getConfigService();
      await cfg.load();
      await cfg.set("telegram.chatId", "config-default");
      expect(resolveChatId()).toBe("config-default");
    });

    it("prefers explicit argument over config/env", async () => {
      process.env.TELEGRAM_CHAT_ID = "env-default";
      const cfg = getConfigService();
      await cfg.load();
      await cfg.set("telegram.chatId", "config-default");
      expect(resolveChatId("explicit")).toBe("explicit");
    });
  });

  describe("toolMetadata", () => {
    it("declares chatId optional for sendMessage", () => {
      const meta = telegramPlugin.toolMetadata?.sendMessage;
      expect(meta).toBeDefined();
      expect(meta?.parameters?.required).toEqual(["botId", "text"]);
    });

    it("declares chatId optional for sendPhoto", () => {
      const meta = telegramPlugin.toolMetadata?.sendPhoto;
      expect(meta).toBeDefined();
      expect(meta?.parameters?.required).toEqual(["botId", "photo"]);
    });
  });
});
