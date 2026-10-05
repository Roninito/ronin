import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";
import { kiosaTheme } from "../src/utils/theme.js";
import { getKiosaTopbarHTML, getKiosaFooterHTML, getKiosaAccentForPath, getKiosaStylesheetLink } from "../src/utils/kiosa.js";

const DEFAULT_TEST_PHRASE = "This is how Ronin sounds with the current voice settings.";

interface QueuedVoiceMessage {
  from: string;
  content: string;
  timestamp: number;
}

/**
 * Voice Duty
 *
 * Settings + runtime relay for Ronin's voice in one place:
 *
 * - Settings page at /voice for choosing and testing Ronin's speech
 *   backends — STT (apple/whisper/deepgram/elevenlabs) and TTS (piper,
 *   agent-voice for cloned/persona voices via a running agent-voice server,
 *   see https://github.com/rodaddy/agent-voice, or elevenlabs cloud voices).
 *   Writes through api.config.set (persisted to ~/.ronin/config.json, same
 *   mechanism duties/config-editor.ts uses) and speaks a test phrase via
 *   the existing local.speech.say tool so "test this voice" always
 *   exercises the exact code path chat/duties use. This is deliberately
 *   narrower than config-editor.ts's generic schema editor: it exists for
 *   the interactive parts a generic form can't easily do (list available
 *   agent-voice voices, play a sample) — not to duplicate general config
 *   editing.
 * - Realm voice-messaging relay (absorbed from voice-messaging): listens
 *   for `realm:message`, queues inbound messages until the user is active,
 *   and relays them via TTS. Handles "send <callsign> a message: ..."
 *   voice commands outbound over Realm.
 */
export default class VoiceConfigDuty extends BaseDuty {
  private messageQueue: QueuedVoiceMessage[] = [];
  private isUserAvailable = false;
  private lastActivityTime = Date.now();
  private availabilityCheckInterval: NodeJS.Timeout | null = null;
  // Stored so cleanup() can pass the exact same reference to events.off() —
  // an inline closure passed straight to events.on() can never be
  // unsubscribed later, since off() matches by function identity.
  private readonly onRealmMessage = (raw: unknown): void => {
    const data = raw as { from: string; content: string };
    this.handleIncomingMessage(data.from, data.content);
  };

  constructor(api: DutyAPI) {
    super(api);
    this.registerRoutes();
    this.api.events.on("realm:message", this.onRealmMessage);
    this.startAvailabilityMonitoring();
  }

  async execute(): Promise<void> {
    // No standing work — this duty responds to routes and Realm events.
    await this.processMessageQueue();
  }

  private registerRoutes(): void {
    this.api.http.registerRoute("/voice", this.handlePage.bind(this));
    this.api.http.registerRoute("/api/voice/config", this.handleConfig.bind(this));
    this.api.http.registerRoute("/api/voice/voices", this.handleVoices.bind(this));
    this.api.http.registerRoute("/api/voice/test", this.handleTest.bind(this));
  }

  // ── Realm voice-messaging relay (absorbed from voice-messaging) ─────────

  /**
   * Handle an incoming message from Realm: queue it, deliver immediately
   * when the user is active.
   */
  private handleIncomingMessage(from: string, content: string): void {
    console.log(`[voice] Message received from ${from}: ${content}`);

    const message: QueuedVoiceMessage = {
      from,
      content,
      timestamp: Date.now(),
    };

    this.messageQueue.push(message);
    console.log(`[voice] Message queued. Queue size: ${this.messageQueue.length}`);

    // Try to deliver immediately if user is available
    void this.processMessageQueue();
  }

  /**
   * Process queued messages if user is available.
   */
  private async processMessageQueue(): Promise<void> {
    if (!this.isUserAvailable || this.messageQueue.length === 0) {
      return;
    }

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()!;
      await this.relayMessage(message);
    }
  }

  /**
   * Relay a message to the user via TTS (falls back to console + memory).
   */
  private async relayMessage(message: QueuedVoiceMessage): Promise<void> {
    const announcement = `Message from ${message.from}: ${message.content}`;
    console.log(`[voice] 🔊 ${announcement}`);

    try {
      await this.api.tools.execute("local.speech.say", { text: announcement });
    } catch (error) {
      console.warn("[voice] TTS relay failed, message kept in memory only:", error);
    }

    // Store in memory for reference
    await this.api.memory.store(`message:${message.timestamp}`, {
      from: message.from,
      content: message.content,
      timestamp: message.timestamp,
    });
  }

  /**
   * Start monitoring user availability.
   */
  private startAvailabilityMonitoring(): void {
    // Check availability every 5 seconds
    this.availabilityCheckInterval = setInterval(() => {
      this.checkUserAvailability();
    }, 5000);

    // Initial check
    this.checkUserAvailability();
  }

  /**
   * Check if user is available (simple heuristic based on activity).
   */
  private checkUserAvailability(): void {
    const timeSinceLastActivity = Date.now() - this.lastActivityTime;
    const AVAILABILITY_TIMEOUT = 60000; // 1 minute

    const wasAvailable = this.isUserAvailable;
    this.isUserAvailable = timeSinceLastActivity < AVAILABILITY_TIMEOUT;

    if (!wasAvailable && this.isUserAvailable) {
      console.log("[voice] User is now available");
      void this.processMessageQueue();
    }
  }

  /**
   * Mark user as active (call this when user interacts).
   */
  private markUserActive(): void {
    this.lastActivityTime = Date.now();
    if (!this.isUserAvailable) {
      this.isUserAvailable = true;
      void this.processMessageQueue();
    }
  }

  /**
   * Parse a voice command and send a message over Realm.
   *
   * Example: "Hey Ronin, send Tyro a message: I'll be there around 3 on Thursday"
   */
  async handleVoiceCommand(transcript: string): Promise<void> {
    // Mark user as active
    this.markUserActive();

    // Pattern: "send <callsign> a message: <content>"
    const sendPattern = /send\s+(\w+)\s+(?:a\s+)?message[:\s]+(.+)/i;
    const match = transcript.match(sendPattern);

    if (!match) {
      console.log("[voice] Command not recognized:", transcript);
      return;
    }

    // Both capturing groups are mandatory ((\w+) and (.+)), so a successful
    // match always has both.
    const targetCallSign = match[1]!;
    const messageContent = match[2]!;

    if (!this.api.realm) {
      console.error("[voice] Realm not initialized");
      return;
    }

    try {
      console.log(`[voice] Sending message to ${targetCallSign}: ${messageContent}`);
      await this.api.realm.sendMessage(targetCallSign, messageContent.trim());
      console.log(`[voice] ✅ Message sent to ${targetCallSign}`);

      const confirmation = `Message sent to ${targetCallSign}`;
      console.log(`[voice] 🔊 ${confirmation}`);
      try {
        await this.api.tools.execute("local.speech.say", { text: confirmation });
      } catch {
        // Console log above is the fallback; never fail the send on TTS.
      }
    } catch (error) {
      const errorMsg = `Failed to send message to ${targetCallSign}`;
      console.error("[voice] Failed to send message:", error);
      console.log(`[voice] 🔊 ${errorMsg}`);
    }
  }

  /**
   * Cleanup on duty shutdown.
   */
  async cleanup(): Promise<void> {
    if (this.availabilityCheckInterval) {
      clearInterval(this.availabilityCheckInterval);
    }
    this.api.events.off("realm:message", this.onRealmMessage);
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

const accent = getKiosaAccentForPath("/voice");
const accentHex = kiosaTheme.colors.accent;

const PAGE_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Voice Settings — Ronin</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
${getKiosaStylesheetLink(accent)}
<style>

  body { font-family: ${kiosaTheme.fonts.primary}; max-width: 560px; margin: 0 auto; padding: 22px 20px; color: ${kiosaTheme.colors.textPrimary}; background: ${kiosaTheme.colors.background}; }
  h1 { font-size: 1.4em; text-transform: uppercase; letter-spacing: 0.04em; }
  fieldset { border: 1px solid ${kiosaTheme.colors.border}; border-radius: 2px; padding: 16px 20px; margin-bottom: 20px; background: ${kiosaTheme.colors.backgroundSecondary}; }
  legend { font-weight: 600; padding: 0 6px; text-transform: uppercase; letter-spacing: 0.1em; font-size: 11px; }
  label { display: block; margin: 12px 0 4px; font-size: 10px; color: ${kiosaTheme.colors.textSecondary}; text-transform: uppercase; letter-spacing: 0.1em; font-family: ${kiosaTheme.fonts.mono}; }
  select, input[type=text], input[type=password] { width: 100%; padding: 6px 8px; font-size: 1em; box-sizing: border-box; background: ${kiosaTheme.colors.background}; color: ${kiosaTheme.colors.textPrimary}; border: 1px solid ${kiosaTheme.colors.border}; border-radius: 2px; }
  button { padding: 6px 10px; margin-top: 12px; margin-right: 8px; cursor: pointer; font-family: ${kiosaTheme.fonts.mono}; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; border: 1px solid ${kiosaTheme.colors.border}; border-radius: 2px; background: ${kiosaTheme.colors.backgroundSecondary}; color: ${kiosaTheme.colors.textSecondary}; }
  #status { margin-top: 10px; font-size: 12px; font-family: ${kiosaTheme.fonts.mono}; color: ${kiosaTheme.colors.textSecondary}; }
  .hint { color: ${kiosaTheme.colors.textTertiary}; font-size: 11px; }
</style>
</head>
<body>
${getKiosaTopbarHTML({ title: "RONIN", subtitle: "VOICE", chips: [], tabs: [] })}
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
${getKiosaFooterHTML("RONIN · SPEECH SETTINGS", "ONLINE · V0.1")}
</body>
</html>`;
