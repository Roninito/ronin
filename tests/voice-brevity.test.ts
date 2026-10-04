import { describe, it, expect } from "bun:test";
import {
  buildSystemPrompt,
  isVoiceChat,
  VOICE_BREVITY_SECTION,
  type RoninContext,
} from "../src/utils/prompt.js";
import { buildAskPrompt } from "../src/dispatcher/tools.js";

const context: RoninContext = {
  duties: [],
  plugins: [],
  routes: [],
  architecture: "",
  hasArtifacts: false,
};

describe("voice brevity", () => {
  it("detects tray voice chats by id", () => {
    expect(isVoiceChat("ronin-tray-voice")).toBe(true);
    expect(isVoiceChat("ronin-tray-voice-v2")).toBe(true);
    expect(isVoiceChat("some-ui-chat")).toBe(false);
    expect(isVoiceChat("")).toBe(false);
  });

  it("brevity section demands sub-minute spoken replies", () => {
    expect(VOICE_BREVITY_SECTION).toContain("under a minute");
    expect(VOICE_BREVITY_SECTION).toContain("130 words");
  });

  it("sections flow into the built system prompt", () => {
    const prompt = buildSystemPrompt(context, {
      includeArchitecture: false,
      includeDutyList: false,
      includePluginList: false,
      memoryHint: false,
      sections: [VOICE_BREVITY_SECTION],
    });
    expect(prompt).toContain("VOICE BREVITY");
  });

  it("dispatcher ask prompt demands sub-minute answers", () => {
    const prompt = buildAskPrompt("{}", "what is blocked?");
    expect(prompt).toContain("under a minute");
    expect(prompt).toContain("what is blocked?");
  });
});
