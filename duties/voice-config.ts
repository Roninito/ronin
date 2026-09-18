import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";

const DEFAULT_TEST_PHRASE = "This is how Ronin sounds with the current voice settings.";

/**
 * Voice Config Duty
 *
 * Provides a small settings page at /voice for choosing and testing Ronin's
 * speech backends — STT (apple/whisper/deepgram) and TTS (piper, or
 * agent-voice for cloned/persona voices via a running agent-voice server,
 * see https://github.com/rodaddy/agent-voice). Writes through api.config.set
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
      stt: { backend: speech.stt.backend },
      tts: {
        backend: speech.tts.backend,
        agentVoiceUrl: speech.tts.agentVoiceUrl,
        agentVoiceVoice: speech.tts.agentVoiceVoice,
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

      return Response.json({ success: true, config: this.currentSpeechConfig() });
    }

    return new Response("Method not allowed", { status: 405 });
  }

  private async handleVoices(): Promise<Response> {
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
  select, input[type=text] { width: 100%; padding: 6px 8px; font-size: 1em; box-sizing: border-box; }
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
  </select>
</fieldset>

<fieldset>
  <legend>Text-to-Speech</legend>
  <label for="ttsBackend">TTS Backend</label>
  <select id="ttsBackend">
    <option value="piper">Piper (local, generic voices)</option>
    <option value="agent-voice">agent-voice (cloned/persona voices)</option>
  </select>

  <div id="agentVoiceFields" style="display:none">
    <label for="agentVoiceUrl">agent-voice Server URL</label>
    <input type="text" id="agentVoiceUrl" placeholder="http://127.0.0.1:7161">
    <label for="agentVoiceVoice">Voice</label>
    <select id="agentVoiceVoice"></select>
    <p class="hint">Voices are listed from the agent-voice server's voices directory, if reachable on this machine.</p>
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
  const status = document.getElementById('status');

  function updateVisibility() {
    agentVoiceFields.style.display = ttsBackend.value === 'agent-voice' ? 'block' : 'none';
  }
  ttsBackend.addEventListener('change', updateVisibility);

  async function loadConfig() {
    const res = await fetch('/api/voice/config');
    const cfg = await res.json();
    sttBackend.value = cfg.stt.backend;
    ttsBackend.value = cfg.tts.backend;
    agentVoiceUrl.value = cfg.tts.agentVoiceUrl || '';
    updateVisibility();

    const voicesRes = await fetch('/api/voice/voices');
    const { voices } = await voicesRes.json();
    agentVoiceVoice.innerHTML = voices.length
      ? voices.map(v => \`<option value="\${v}">\${v}</option>\`).join('')
      : '<option value="">(no voices found)</option>';
    if (voices.includes(cfg.tts.agentVoiceVoice)) agentVoiceVoice.value = cfg.tts.agentVoiceVoice;
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
      }),
    });
    const data = await res.json();
    status.textContent = data.success ? 'Saved.' : ('Error: ' + (data.error || 'unknown'));
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
