import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";
import { kiosaTheme } from "../src/utils/theme.js";
import { getKiosaTopbarHTML, getKiosaFooterHTML, getKiosaAccentForPath, getKiosaStylesheetLink } from "../src/utils/kiosa.js";
import { CrewClient } from "../src/dispatcher/crew.js";
import { WAKE_TOOL, NEEDS_HUMAN_TOOL, buildAskPrompt } from "../src/dispatcher/tools.js";

/**
 * Dispatcher Console Duty (route-only console)
 *
 * Shape follows duties/voice-config.ts: the constructor registers routes and
 * execute() does nothing. Serves the /dispatcher console page:
 *
 * - GET /dispatcher — live cross-project status + ask box + push-to-talk mic
 * - GET /api/dispatcher/status — read-only crew sense (same rollup the
 *   scheduled crew-dispatcher duty reasons over)
 * - POST /api/dispatcher/ask {text} — one-shot callTools over live crew
 *   state. Read-only: proposals are returned, never executed. The scheduled
 *   duty is the only writer.
 * - POST /api/dispatcher/transcribe — mic audio blob → transcript
 *   (same flow as chatty's /api/chat/transcribe)
 * - POST /api/dispatcher/speak {text} — voiced replies via local.speech.say
 *   (same flow as chatty's /api/chat/speak)
 */
export default class DispatcherConsoleDuty extends BaseDuty {
  constructor(api: DutyAPI) {
    super(api);
    this.registerRoutes();
  }

  async execute(): Promise<void> {
    // No standing work — this duty only responds to routes.
  }

  private registerRoutes(): void {
    this.api.http.registerRoute("/dispatcher", this.handlePage.bind(this));
    this.api.http.registerRoute("/api/dispatcher/status", this.handleStatus.bind(this));
    this.api.http.registerRoute("/api/dispatcher/ask", this.handleAsk.bind(this));
    this.api.http.registerRoute("/api/dispatcher/transcribe", this.handleTranscribe.bind(this));
    this.api.http.registerRoute("/api/dispatcher/speak", this.handleSpeak.bind(this));
  }

  private crewClient(): CrewClient {
    return new CrewClient();
  }

  private async handleStatus(req: Request): Promise<Response> {
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
    try {
      const client = this.crewClient();
      const [health, sensed] = await Promise.all([client.health(), client.dispatcherWithFallback()]);
      return Response.json({ health, projects: sensed.rollup.projects, viaFallback: sensed.viaFallback });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Crew status failed" },
        { status: 502 },
      );
    }
  }

  private async handleAsk(req: Request): Promise<Response> {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    let text = "";
    try {
      const body = await req.json();
      text = typeof body?.text === "string" ? body.text : "";
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (!text.trim()) {
      return Response.json({ error: "No question to ask" }, { status: 400 });
    }

    try {
      const client = this.crewClient();
      const sensed = await client.dispatcherWithFallback();
      const rollup = sensed.rollup;
      const response = await this.api.ai.callTools(
        buildAskPrompt(JSON.stringify(rollup), text.trim()),
        [WAKE_TOOL, NEEDS_HUMAN_TOOL],
        { temperature: 0.3 },
      );
      // Read-only by construction: proposals are returned for display and the
      // console never calls crew wake itself.
      return Response.json({
        reply: response.message?.content ?? "",
        proposedActions: response.toolCalls ?? [],
      });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Ask failed" },
        { status: 500 },
      );
    }
  }

  /** Transcribes a recorded audio blob (from the mic button) via the stt plugin. Same shape as chatty's handler. */
  private async handleTranscribe(req: Request): Promise<Response> {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!this.api.plugins.has("stt")) {
      return Response.json({ error: "STT plugin not loaded" }, { status: 503 });
    }

    const { writeFile, unlink } = await import("fs/promises");
    const { join } = await import("path");
    const { tmpdir } = await import("os");
    const { randomUUID } = await import("crypto");

    const audioBuffer = Buffer.from(await req.arrayBuffer());
    if (audioBuffer.length === 0) {
      return Response.json({ error: "Empty audio" }, { status: 400 });
    }

    const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const rawPath = join(tmpdir(), `ronin-dispatcher-audio-${id}.webm`);
    const wavPath = join(tmpdir(), `ronin-dispatcher-audio-${id}.wav`);
    try {
      await writeFile(rawPath, audioBuffer);
      // Browsers only produce webm/ogg (Opus). Convert to 16kHz mono WAV first —
      // whisper.cpp's CLI expects WAV and won't decode webm itself, and WAV is
      // accepted by all STT backends (apple, whisper, deepgram, elevenlabs).
      await this.convertToWav(rawPath, wavPath);
      const result = (await this.api.plugins.call("stt", "transcribe", wavPath)) as { text: string };
      return Response.json({ text: result.text });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Transcription failed" },
        { status: 500 },
      );
    } finally {
      await unlink(rawPath).catch(() => {});
      await unlink(wavPath).catch(() => {});
    }
  }

  /** Converts an audio file to 16kHz mono WAV via ffmpeg (required for whisper.cpp). Same shape as chatty's. */
  private async convertToWav(inputPath: string, outputPath: string): Promise<void> {
    const { spawn } = await import("child_process");
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("ffmpeg", ["-y", "-i", inputPath, "-ar", "16000", "-ac", "1", outputPath], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      proc.stderr?.on("data", (d) => { stderr += d.toString(); });
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg conversion failed: ${stderr.trim() || `exit code ${code}`}`));
      });
      proc.on("error", (err) => {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new Error("ffmpeg is required to convert recorded audio for transcription. Install it with: brew install ffmpeg"));
        } else {
          reject(new Error(`Failed to run ffmpeg: ${err.message}`));
        }
      });
    });
  }

  /** Speaks text aloud through the host machine's speakers via local.speech.say. Same shape as chatty's. */
  private async handleSpeak(req: Request): Promise<Response> {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    let text = "";
    try {
      const body = await req.json();
      text = typeof body?.text === "string" ? body.text : "";
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (!text.trim()) {
      return Response.json({ error: "No text to speak" }, { status: 400 });
    }

    try {
      const result = await this.api.tools.execute("local.speech.say", { text });
      return Response.json({ success: result.success, error: result.error ?? null });
    } catch (error) {
      return Response.json(
        { success: false, error: error instanceof Error ? error.message : "Speech failed" },
        { status: 500 },
      );
    }
  }

  private async handlePage(): Promise<Response> {
    return new Response(this.pageHtml(), { headers: { "Content-Type": "text/html" } });
  }

  private pageHtml(): string {
    const accent = getKiosaAccentForPath("/dispatcher");
    const accentHex = kiosaTheme.colors.accent;
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Dispatcher Console</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
${getKiosaStylesheetLink(accent)}
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; color: ${kiosaTheme.colors.textPrimary}; background: ${kiosaTheme.colors.background}; }
  .page-content { max-width: 860px; margin: 0 auto; padding: 20px; }
  .projects { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .project { border: 1px solid ${kiosaTheme.colors.border}; border-radius: 6px; padding: 12px 14px; background: ${kiosaTheme.colors.backgroundSecondary}; }
  .project h3 { margin: 0 0 6px; font-size: 1em; }
  .project .paused { color: ${kiosaTheme.colors.warning}; font-weight: 600; }
  .project dl { margin: 0; font-size: 0.88em; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
  .project dt { color: ${kiosaTheme.colors.textSecondary}; }
  .project dd { margin: 0; }
  .agents { font-size: 0.85em; margin-top: 6px; }
  .agents li { margin: 1px 0; }
  #status-error { color: ${kiosaTheme.colors.error}; margin-bottom: 16px; }
  .ask-row { display: flex; gap: 8px; margin-bottom: 12px; }
  #ask-input { flex: 1; padding: 8px 10px; font-size: 1em; border: 1px solid ${kiosaTheme.colors.border}; border-radius: 6px; background: ${kiosaTheme.colors.backgroundSecondary}; color: ${kiosaTheme.colors.textPrimary}; }
  button { padding: 8px 14px; cursor: pointer; border: 1px solid ${kiosaTheme.colors.border}; border-radius: 6px; background: ${kiosaTheme.colors.backgroundSecondary}; color: ${kiosaTheme.colors.textPrimary}; font-size: 0.95em; }
  button:disabled { opacity: 0.5; cursor: default; }
  #mic-button.recording { border-color: ${kiosaTheme.colors.error}; color: ${kiosaTheme.colors.error}; }
  #speak-toggle.active { border-color: ${kiosaTheme.colors.accent}; }
  #reply { white-space: pre-wrap; border: 1px solid ${kiosaTheme.colors.border}; border-radius: 6px; padding: 12px 14px; margin-top: 12px; background: ${kiosaTheme.colors.backgroundSecondary}; min-height: 60px; }
  #proposals { margin-top: 8px; font-size: 0.88em; color: ${kiosaTheme.colors.textSecondary}; }
  .hint { color: ${kiosaTheme.colors.textSecondary}; font-size: 0.85em; }
  .toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
</style>
</head>
<body>
${getKiosaTopbarHTML({ title: "RONIN", subtitle: "DISPATCHER", chips: [], tabs: [] })}
<div class="page-content">
  <div id="status-error"></div>
  <div class="projects" id="projects"></div>

  <div class="toolbar">
    <button id="refresh-button" type="button">Refresh status</button>
    <button id="speak-toggle" type="button">Speak replies</button>
    <span class="hint">Ask is read-only — wakes only happen on the hourly sweep.</span>
  </div>

  <div class="ask-row">
    <input id="ask-input" type="text" placeholder="Ask about crew state, e.g. what needs attention?" autocomplete="off">
    <button id="mic-button" type="button" title="Push to talk">Mic</button>
    <button id="ask-button" type="button">Ask</button>
  </div>
  <div id="reply"></div>
  <div id="proposals"></div>
</div>

<script>
  const projectsEl = document.getElementById('projects');
  const statusError = document.getElementById('status-error');
  const healthLine = document.getElementById('health-line');
  const askInput = document.getElementById('ask-input');
  const askButton = document.getElementById('ask-button');
  const replyEl = document.getElementById('reply');
  const proposalsEl = document.getElementById('proposals');

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function refreshStatus() {
    statusError.textContent = '';
    try {
      const res = await fetch('/api/dispatcher/status');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      healthLine.textContent = 'crew pid ' + (data.health?.pid ?? '?') + ' · ' + (data.projects?.length ?? 0) + ' projects';
      projectsEl.innerHTML = (data.projects || []).map((p) => {
        const agents = (p.agents || []).map((a) => '<li>' + esc(a.name) + ' — ' + esc(a.state) + (a.task ? ' (' + esc(a.task) + ')' : '') + '</li>').join('');
        return '<div class="project"><h3>' + esc(p.id) + (p.paused ? ' <span class="paused">paused</span>' : '') + '</h3>' +
          '<dl><dt>review</dt><dd>' + (p.review || []).length + '</dd>' +
          '<dt>questions</dt><dd>' + (p.questions || []).length + '</dd>' +
          '<dt>blocked</dt><dd>' + (p.blocked || []).length + '</dd></dl>' +
          (agents ? '<ul class="agents">' + agents + '</ul>' : '') + '</div>';
      }).join('');
    } catch (err) {
      statusError.textContent = 'Status unavailable: ' + err.message;
      healthLine.textContent = 'crew unreachable';
    }
  }

  async function ask() {
    const text = askInput.value.trim();
    if (!text) return;
    askButton.disabled = true;
    replyEl.textContent = 'Thinking…';
    proposalsEl.textContent = '';
    try {
      const res = await fetch('/api/dispatcher/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      replyEl.textContent = data.reply || '(no reply)';
      if ((data.proposedActions || []).length) {
        proposalsEl.textContent = 'Proposed (not executed): ' + data.proposedActions.map((a) => a.name + ' ' + JSON.stringify(a.arguments)).join(' · ');
      }
      maybeSpeak(data.reply);
    } catch (err) {
      replyEl.textContent = 'Ask failed: ' + err.message;
    } finally {
      askButton.disabled = false;
    }
  }

  document.getElementById('refresh-button').addEventListener('click', refreshStatus);
  askButton.addEventListener('click', ask);
  askInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });

  // --- Voice input (push-to-talk mic button; same flow as chatty) ---
  const micButton = document.getElementById('mic-button');
  let mediaRecorder = null;
  let recordedChunks = [];

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        micButton.classList.remove('recording');
        micButton.textContent = '…';
        micButton.disabled = true;
        try {
          const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
          const res = await fetch('/api/dispatcher/transcribe', { method: 'POST', body: blob });
          const data = await res.json();
          if (data.text) {
            askInput.value = (askInput.value ? askInput.value + ' ' : '') + data.text;
            askInput.focus();
          } else if (data.error) {
            console.error('Transcription failed:', data.error);
          }
        } catch (err) {
          console.error('Transcription request failed:', err);
        } finally {
          micButton.textContent = 'Mic';
          micButton.disabled = false;
        }
      };
      mediaRecorder.start();
      micButton.classList.add('recording');
      micButton.textContent = 'Stop';
    } catch (err) {
      console.error('Microphone access failed:', err);
      alert('Could not access the microphone: ' + err.message);
    }
  }

  micButton.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    } else {
      startRecording();
    }
  });

  // --- Voice output (speak replies aloud; same flow as chatty) ---
  const SPEAK_TOGGLE_KEY = 'ronin-dispatcher-speak-replies';
  const speakToggle = document.getElementById('speak-toggle');

  function speakEnabled() {
    try { return localStorage.getItem(SPEAK_TOGGLE_KEY) === 'true'; } catch { return false; }
  }
  function renderSpeakToggle() {
    const on = speakEnabled();
    speakToggle.classList.toggle('active', on);
    speakToggle.textContent = on ? 'Speaking replies' : 'Speak replies';
  }
  speakToggle.addEventListener('click', () => {
    try { localStorage.setItem(SPEAK_TOGGLE_KEY, speakEnabled() ? 'false' : 'true'); } catch {}
    renderSpeakToggle();
  });
  renderSpeakToggle();

  function stripMarkdownForSpeech(text) {
    return String(text || '')
      .replace(/\`\`\`[\\s\\S]*?\`\`\`/g, '')
      .replace(/[*_#\`>~]/g, '')
      .replace(/\\[([^\\]]+)\\]\\([^)]+\\)/g, '$1')
      .trim();
  }

  function maybeSpeak(text) {
    if (!speakEnabled() || !text) return;
    // Fire-and-forget — plays through this Mac's speakers (via local.speech.say),
    // not the browser/device viewing this page.
    fetch('/api/dispatcher/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: stripMarkdownForSpeech(text) }),
    }).catch(err => console.error('Speak request failed:', err));
  }

  refreshStatus();
  setInterval(refreshStatus, 30000);
</script>
</body>
</html>`;
  }
}
