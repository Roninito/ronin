import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";

const DEFAULT_TEST_PHRASE = "This is how Ronin sounds with the current voice settings.";

/**
 * Voice Config Duty
 *
 * Provides a small settings page at /voice for choosing and testing Ronin's
 * speech backends — STT (apple/whisper/deepgram/elevenlabs) and TTS (piper,
 * agent-voice for cloned/persona voices via a running agent-voice server,
 * see https://github.com/rodaddy/agent-voice, or elevenlabs cloud voices).
 * Writes through api.config.set
 * (persisted to ~/.ronin/config.json, same mechanism duties/config-editor.ts
 * uses) and speaks a test phrase via the existing local.speech.say tool so
 * "test this voice" always exercises the exact code path chat/duties use.
 *
 * This is deliberately narrower than config-editor.ts's generic schema
 * editor: it exists for the interactive parts a generic form can't easily
 * do (list available agent-voice voices, play a sample) — not to duplicate
 * general config editing.
 */
export default class VoiceConfigDuty extends BaseDuty {
  constructor(api: DutyAPI) {
    super(api);
    this.registerRoutes();
  }

  async execute(): Promise<void> {
    // No standing work — this duty only responds to routes.
  }

  private registerRoutes(): void {
    this.api.http.registerRoute("/voice", this.handlePage.bind(this));
    this.api.http.registerRoute("/api/voice/config", this.handleConfig.bind(this));
    this.api.http.registerRoute("/api/voice/voices", this.handleVoices.bind(this));
    this.api.http.registerRoute("/api/voice/test", this.handleTest.bind(this));
  }

  private currentSpeechConfig() {
    const speech = this.api.config.getAll().speech;
    return {
      stt: {
        backend: speech.stt.backend,
        elevenlabsApiKeySet: Boolean(speech.stt.elevenlabsApiKey || speech.tts.elevenlabsApiKey),
      },
      tts: {
        backend: speech.tts.backend,
        agentVoiceUrl: speech.tts.agentVoiceUrl,
        agentVoiceVoice: speech.tts.agentVoiceVoice,
        elevenlabsApiKeySet: Boolean(speech.tts.elevenlabsApiKey || speech.stt.elevenlabsApiKey),
        elevenlabsVoiceId: speech.tts.elevenlabsVoiceId,
        elevenlabsModelId: speech.tts.elevenlabsModelId,
      },
    };
  }

  private async handleConfig(req: Request): Promise<Response> {
    if (req.method === "GET") {
      return Response.json(this.currentSpeechConfig());
    }

    if (req.method === "POST") {
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "Invalid JSON body" }, { status: 400 });
      }

      if (typeof body.sttBackend === "string") {
        await this.api.config.set("speech.stt.backend", body.sttBackend);
      }
      if (typeof body.ttsBackend === "string") {
        await this.api.config.set("speech.tts.backend", body.ttsBackend);
      }
      if (typeof body.agentVoiceUrl === "string") {
        await this.api.config.set("speech.tts.agentVoiceUrl", body.agentVoiceUrl);
      }
      if (typeof body.agentVoiceVoice === "string") {
        await this.api.config.set("speech.tts.agentVoiceVoice", body.agentVoiceVoice);
      }
      if (typeof body.elevenlabsApiKey === "string" && body.elevenlabsApiKey) {
        // One shared ElevenLabs key: mirror to both backends so STT and TTS
        // each work no matter which one is selected.
        await this.api.config.set("speech.stt.elevenlabsApiKey", body.elevenlabsApiKey);
        await this.api.config.set("speech.tts.elevenlabsApiKey", body.elevenlabsApiKey);
      }
      if (typeof body.elevenlabsVoiceId === "string" && body.elevenlabsVoiceId) {
        await this.api.config.set("speech.tts.elevenlabsVoiceId", body.elevenlabsVoiceId);
      }
      if (typeof body.elevenlabsModelId === "string" && body.elevenlabsModelId) {
        await this.api.config.set("speech.tts.elevenlabsModelId", body.elevenlabsModelId);
      }

      return Response.json({ success: true, config: this.currentSpeechConfig() });
    }

    return new Response("Method not allowed", { status: 405 });
  }

  private async handleVoices(req: Request): Promise<Response> {
    let want = this.api.config.getAll().speech.tts.backend;
    try {
      const param = new URL(req.url).searchParams.get("for");
      if (param === "elevenlabs" || param === "agent-voice") want = param;
    } catch {
      // Relative URL in tests — fall through to the configured backend.
    }

    if (want === "elevenlabs") {
      if (!this.api.plugins.has("elevenlabs")) {
        return Response.json({ voices: [] });
      }
      try {
        const voices = (await this.api.plugins.call("elevenlabs", "listVoices")) as Array<{ id: string; name: string }>;
        return Response.json({ voices });
      } catch {
        return Response.json({ voices: [] });
      }
    }

    if (!this.api.plugins.has("agent-voice")) {
      return Response.json({ voices: [] });
    }
    try {
      const voices = (await this.api.plugins.call("agent-voice", "listVoices")) as string[];
      return Response.json({ voices });
    } catch {
      return Response.json({ voices: [] });
    }
  }

  private async handleTest(req: Request): Promise<Response> {
    let text = DEFAULT_TEST_PHRASE;
    try {
      const body = await req.json();
      if (typeof body?.text === "string" && body.text.trim()) text = body.text.trim();
    } catch {
      // No/invalid body — use the default phrase.
    }

    try {
      const result = await this.api.tools.execute("local.speech.say", { text });
      return Response.json({ success: result.success, error: result.error ?? null });
    } catch (err) {
      return Response.json(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
  }

  private async handlePage(): Promise<Response> {
    return new Response(PAGE_HTML, { headers: { "Content-Type": "text/html" } });
  }
}

const PAGE_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Voice Settings — Ronin</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; margin: 40px auto; padding: 0 20px; color: #222; background: #fafafa; }
  h1 { font-size: 1.4em; }
  fieldset { border: 1px solid #ddd; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px; background: #fff; }
  legend { font-weight: 600; padding: 0 6px; }
  label { display: block; margin: 12px 0 4px; font-size: 0.9em; color: #444; }
  select, input[type=text], input[type=password] { width: 100%; padding: 6px 8px; font-size: 1em; box-sizing: border-box; }
  button { padding: 8px 16px; margin-top: 12px; margin-right: 8px; cursor: pointer; }
  #status { margin-top: 10px; font-size: 0.9em; }
  .hint { color: #888; font-size: 0.85em; }
</style>
</head>
<body>
<h1>Voice Settings</h1>

<fieldset>
  <legend>Speech-to-Text</legend>
  <label for="sttBackend">STT Backend</label>
  <select id="sttBackend">
    <option value="apple">Apple (Shortcuts dictation)</option>
    <option value="whisper">Whisper (local, whisper.cpp)</option>
    <option value="deepgram">Deepgram (cloud)</option>
    <option value="elevenlabs">ElevenLabs (cloud, Scribe)</option>
  </select>
</fieldset>

<fieldset>
  <legend>Text-to-Speech</legend>
  <label for="ttsBackend">TTS Backend</label>
  <select id="ttsBackend">
    <option value="piper">Piper (local, generic voices)</option>
    <option value="agent-voice">agent-voice (cloned/persona voices)</option>
    <option value="elevenlabs">ElevenLabs (cloud voices)</option>
  </select>

  <div id="agentVoiceFields" style="display:none">
    <label for="agentVoiceUrl">agent-voice Server URL</label>
    <input type="text" id="agentVoiceUrl" placeholder="http://127.0.0.1:7161">
    <label for="agentVoiceVoice">Voice</label>
    <select id="agentVoiceVoice"></select>
    <p class="hint">Voices are listed from the agent-voice server's voices directory, if reachable on this machine.</p>
  </div>

  <div id="elevenlabsFields" style="display:none">
    <label for="elevenlabsApiKey">ElevenLabs API Key</label>
    <input type="password" id="elevenlabsApiKey" placeholder="sk_..." autocomplete="off">
    <p class="hint" id="elevenlabsKeyHint">One shared key for ElevenLabs STT and TTS. Leave blank to keep the saved key.</p>
    <label for="elevenlabsVoiceId">Voice</label>
    <select id="elevenlabsVoiceId"></select>
    <label for="elevenlabsModelId">Model ID</label>
    <input type="text" id="elevenlabsModelId" placeholder="eleven_multilingual_v2">
    <p class="hint">Voices are listed from your ElevenLabs account when a key is saved.</p>
  </div>
</fieldset>

<button id="saveButton">Save</button>
<button id="testButton">Test Voice</button>
<div id="status"></div>

<script>
  const sttBackend = document.getElementById('sttBackend');
  const ttsBackend = document.getElementById('ttsBackend');
  const agentVoiceFields = document.getElementById('agentVoiceFields');
  const agentVoiceUrl = document.getElementById('agentVoiceUrl');
  const agentVoiceVoice = document.getElementById('agentVoiceVoice');
  const elevenlabsFields = document.getElementById('elevenlabsFields');
  const elevenlabsApiKey = document.getElementById('elevenlabsApiKey');
  const elevenlabsKeyHint = document.getElementById('elevenlabsKeyHint');
  const elevenlabsVoiceId = document.getElementById('elevenlabsVoiceId');
  const elevenlabsModelId = document.getElementById('elevenlabsModelId');
  const status = document.getElementById('status');

  function updateVisibility() {
    agentVoiceFields.style.display = ttsBackend.value === 'agent-voice' ? 'block' : 'none';
    elevenlabsFields.style.display =
      (ttsBackend.value === 'elevenlabs' || sttBackend.value === 'elevenlabs') ? 'block' : 'none';
  }
  ttsBackend.addEventListener('change', () => { updateVisibility(); loadVoices(); });
  sttBackend.addEventListener('change', updateVisibility);

  async function loadVoices(savedAgentVoice, savedElevenVoiceId) {
    const backend = ttsBackend.value === 'elevenlabs' ? 'elevenlabs' : 'agent-voice';
    try {
      const voicesRes = await fetch('/api/voice/voices?for=' + backend);
      const { voices } = await voicesRes.json();
      if (backend === 'elevenlabs') {
        elevenlabsVoiceId.innerHTML = voices.length
          ? voices.map(v => \`<option value="\${v.id}">\${v.name} (\${v.id.slice(0, 8)}…)</option>\`).join('')
          : '<option value="">(no voices found — save a key first)</option>';
        if (savedElevenVoiceId) {
          if (![...elevenlabsVoiceId.options].some(o => o.value === savedElevenVoiceId)) {
            const opt = document.createElement('option');
            opt.value = savedElevenVoiceId;
            opt.textContent = savedElevenVoiceId + ' (saved)';
            elevenlabsVoiceId.appendChild(opt);
          }
          elevenlabsVoiceId.value = savedElevenVoiceId;
        }
      } else {
        agentVoiceVoice.innerHTML = voices.length
          ? voices.map(v => \`<option value="\${v}">\${v}</option>\`).join('')
          : '<option value="">(no voices found)</option>';
        if (voices.includes(savedAgentVoice)) agentVoiceVoice.value = savedAgentVoice;
      }
    } catch {
      // Voice listing is best-effort; saving still works.
    }
  }

  async function loadConfig() {
    const res = await fetch('/api/voice/config');
    const cfg = await res.json();
    sttBackend.value = cfg.stt.backend;
    ttsBackend.value = cfg.tts.backend;
    agentVoiceUrl.value = cfg.tts.agentVoiceUrl || '';
    elevenlabsModelId.value = cfg.tts.elevenlabsModelId || '';
    if (cfg.tts.elevenlabsApiKeySet) elevenlabsKeyHint.textContent = 'A key is saved. Enter a new one to replace it, or leave blank to keep it.';
    updateVisibility();
    loadVoices(cfg.tts.agentVoiceVoice, cfg.tts.elevenlabsVoiceId);
  }

  document.getElementById('saveButton').addEventListener('click', async () => {
    status.textContent = 'Saving...';
    const res = await fetch('/api/voice/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sttBackend: sttBackend.value,
        ttsBackend: ttsBackend.value,
        agentVoiceUrl: agentVoiceUrl.value,
        agentVoiceVoice: agentVoiceVoice.value,
        elevenlabsApiKey: elevenlabsApiKey.value,
        elevenlabsVoiceId: elevenlabsVoiceId.value,
        elevenlabsModelId: elevenlabsModelId.value,
      }),
    });
    const data = await res.json();
    status.textContent = data.success ? 'Saved.' : ('Error: ' + (data.error || 'unknown'));
    if (data.success) {
      elevenlabsApiKey.value = '';
      loadConfig();
    }
  });

  document.getElementById('testButton').addEventListener('click', async () => {
    status.textContent = 'Speaking...';
    const res = await fetch('/api/voice/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await res.json();
    status.textContent = data.success ? 'Played.' : ('Error: ' + (data.error || 'unknown'));
  });

  loadConfig();
</script>
</body>
</html>`;
