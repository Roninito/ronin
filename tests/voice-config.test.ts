import { describe, it, expect } from "bun:test";
import type { DutyAPI } from "../src/types/index.js";
import VoiceConfigDuty from "../duties/voice-config.js";

function localReq(url: string, init: RequestInit = {}): Request {
  return new Request(url, { ...init, headers: { ...init.headers, Host: "localhost" } });
}

function createMockAPI(options: {
  speech?: Record<string, unknown>;
  plugins?: Record<string, (...args: unknown[]) => Promise<unknown>>;
  loadedPlugins?: string[];
}): {
  api: DutyAPI;
  routes: Map<string, (req: Request) => Response | Promise<Response>>;
  sets: Array<{ path: string; value: unknown }>;
} {
  const routes = new Map<string, (req: Request) => Response | Promise<Response>>();
  const sets: Array<{ path: string; value: unknown }> = [];
  const speech = {
    stt: { backend: "whisper", elevenlabsApiKey: "", ...(options.speech?.stt as Record<string, unknown> | undefined) },
    tts: {
      backend: "piper",
      agentVoiceUrl: "",
      agentVoiceVoice: "",
      elevenlabsApiKey: "",
      elevenlabsVoiceId: "21m00Tcm4TlvDq8ikWAM",
      elevenlabsModelId: "eleven_multilingual_v2",
      ...(options.speech?.tts as Record<string, unknown> | undefined),
    },
  };

  const api = {
    config: {
      getAll: () => ({ speech }),
      set: async (path: string, value: unknown) => { sets.push({ path, value }); },
    },
    plugins: {
      has: (name: string) => (options.loadedPlugins ?? Object.keys(options.plugins ?? {}).map((k) => k.split(".")[0])).includes(name),
      call: async (pluginName: string, method: string, ...args: unknown[]) => {
        const fn = options.plugins?.[`${pluginName}.${method}`];
        if (!fn) throw new Error(`unexpected plugin call ${pluginName}.${method}`);
        return fn(...args);
      },
    },
    tools: { execute: async () => ({ success: true }) },
    http: {
      registerRoute: (path: string, handler: (req: Request) => Response | Promise<Response>) => {
        routes.set(path, handler);
      },
    },
    events: { emit: () => {}, on: () => {}, off: () => {} },
  } as unknown as DutyAPI;

  new VoiceConfigDuty(api);
  return { api, routes, sets };
}

describe("voice-config elevenlabs settings", () => {
  it("GET /api/voice/config reports elevenlabs fields without leaking the key", async () => {
    const { routes } = createMockAPI({
      speech: { stt: { backend: "elevenlabs", elevenlabsApiKey: "sk-secret" }, tts: { backend: "elevenlabs", elevenlabsApiKey: "sk-secret" } },
    });
    const res = await routes.get("/api/voice/config")!(localReq("http://localhost/x"));
    const body = await res.json();
    expect(body.stt.backend).toBe("elevenlabs");
    expect(body.stt.elevenlabsApiKeySet).toBe(true);
    expect(body.tts.elevenlabsVoiceId).toBe("21m00Tcm4TlvDq8ikWAM");
    expect(JSON.stringify(body)).not.toContain("sk-secret");
  });

  it("POST mirrors one elevenlabs key to both STT and TTS config paths", async () => {
    const { routes, sets } = createMockAPI({});
    const res = await routes.get("/api/voice/config")!(
      localReq("http://localhost/x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sttBackend: "elevenlabs",
          ttsBackend: "elevenlabs",
          elevenlabsApiKey: "sk-new",
          elevenlabsVoiceId: "voice-1",
          elevenlabsModelId: "eleven_turbo_v2_5",
        }),
      }),
    );
    expect((await res.json()).success).toBe(true);
    const byPath = Object.fromEntries(sets.map((s) => [s.path, s.value]));
    expect(byPath["speech.stt.elevenlabsApiKey"]).toBe("sk-new");
    expect(byPath["speech.tts.elevenlabsApiKey"]).toBe("sk-new");
    expect(byPath["speech.tts.elevenlabsVoiceId"]).toBe("voice-1");
    expect(byPath["speech.tts.elevenlabsModelId"]).toBe("eleven_turbo_v2_5");
  });

  it("POST with a blank key leaves saved keys untouched", async () => {
    const { routes, sets } = createMockAPI({});
    await routes.get("/api/voice/config")!(
      localReq("http://localhost/x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ elevenlabsApiKey: "" }),
      }),
    );
    expect(sets.filter((s) => String(s.path).includes("elevenlabsApiKey"))).toHaveLength(0);
  });

  it("GET /api/voice/voices?for=elevenlabs lists account voices as id/name pairs", async () => {
    const { routes } = createMockAPI({
      plugins: {
        "elevenlabs.listVoices": async () => [{ id: "abc123", name: "Rachel" }],
        "agent-voice.listVoices": async () => { throw new Error("must not be called"); },
      },
    });
    const res = await routes.get("/api/voice/voices")!(localReq("http://localhost/x?for=elevenlabs"));
    expect(await res.json()).toEqual({ voices: [{ id: "abc123", name: "Rachel" }] });
  });

  it("GET /api/voice/voices still lists agent-voice voices by default", async () => {
    const { routes } = createMockAPI({
      plugins: { "agent-voice.listVoices": async () => ["skippy"] },
    });
    const res = await routes.get("/api/voice/voices")!(localReq("http://localhost/x"));
    expect(await res.json()).toEqual({ voices: ["skippy"] });
  });

  it("the /voice page offers elevenlabs in both backend selects", async () => {
    const { routes } = createMockAPI({});
    const html = await (await routes.get("/voice")!(localReq("http://localhost/voice"))).text();
    expect(html).toContain('value="elevenlabs"');
    expect(html).toContain("elevenlabsApiKey");
    expect(html).toContain("elevenlabsVoiceId");
  });
});
