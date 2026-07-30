import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";
import { runArtifactMigrations } from "../src/artifacts/migrations.js";
import { ArtifactStore, calculateCompletion } from "../src/artifacts/store.js";
import { registerArtifactAssetRoute, registerArtifactRoutes, registerArtifactTools } from "../src/artifacts/tools.js";
import { getAdobeCleanFontFaceCSS, getHeaderBarCSS, getHeaderHomeIconHTML, getThemeCSS } from "../src/utils/theme.js";

/**
 * Artifact Manager
 *
 * Owns persistence (SQLite), the 8 artifact_* tools, the /artifacts list
 * dashboard, per-artifact dashboard routes, and the periodic backoff sweep
 * that decides when an artifact is due for more work. See the "Artifacts
 * Feature Integration" plan for the full design and the explicit gap note
 * on why this does NOT dispatch arbitrary duties (Ronin has no generic
 * task-dispatch primitive) — it emits events / sends a chat nudge instead.
 */
export default class ArtifactManagerAgent extends BaseDuty {
  static schedule = "*/15 * * * *"; // Every 15 minutes

  private store: ArtifactStore;

  constructor(api: DutyAPI) {
    super(api);
    this.store = new ArtifactStore(api);

    this.api.http.registerRoute("/artifacts", this.handleListUI.bind(this), {
      title: "Artifacts",
      description: "Persistent cross-chat project containers",
    });
    this.api.http.registerRoute("/api/artifacts", this.handleListJSON.bind(this));

    void this.init();
  }

  private async init(): Promise<void> {
    await runArtifactMigrations(this.api.db);
    registerArtifactTools(this.api, this.store);

    // Routes are exact-string (no :id matching), so re-register per-artifact
    // dashboard and asset routes for everything that already existed before this boot.
    const existing = await this.store.listAll();
    for (const artifact of existing) {
      registerArtifactRoutes(this.api, this.store, artifact.id);
      const file = await this.store.load(artifact.id);
      for (const record of file?.assetRecords ?? []) {
        if (record.storedPath) {
          registerArtifactAssetRoute(this.api, artifact.id, record.storedPath);
        }
      }
    }
  }

  async execute(): Promise<void> {
    const active = await this.store.listActive();
    for (const artifact of active) {
      const decision = await this.store.evaluateSchedule(artifact.id);
      if (!decision.shouldSchedule) continue;

      this.api.events.emit(
        "artifact:needs-attention",
        { artifactId: artifact.id, name: artifact.name, pendingCategories: decision.pendingCategories },
        "artifact-manager"
      );

      if (this.api.ontology) {
        await this.api.ontology.setNode({
          id: `artifact:${artifact.id}`,
          type: "artifact",
          name: artifact.name,
          metadata: JSON.stringify({ artifactId: artifact.id, state: artifact.state, artifactType: artifact.type }),
        });
      }

      await this.notifyDue(artifact.id, artifact.name, decision.pendingCategories);
    }
    console.log(`[artifact-manager] Sweep complete: ${active.length} active artifact(s) checked`);
  }

  /**
   * Best-effort chat nudge when an artifact comes due, mirroring the
   * pending-question notify pattern in src/tools/providers/LocalTools.ts
   * (sendToChatChannel), scoped down since this is a passive FYI, not a
   * blocking question.
   */
  private async notifyDue(artifactId: string, name: string, pendingCategories: string[]): Promise<void> {
    const preferred = this.api.config.getNotifications?.()?.preferredChat ?? "auto";
    const body = `[Ronin] Artifact "${name}" is ready for more work.\n${
      pendingCategories.length > 0 ? `Pending: ${pendingCategories.join(", ")}` : "Check in when you get a chance."
    }\nDashboard: /artifact/${artifactId}`;

    const tryTelegram = async (): Promise<boolean> => {
      if (!this.api.telegram) return false;
      const tg = this.api.config.getTelegram();
      const token = tg.botToken || process.env.TELEGRAM_BOT_TOKEN;
      const chatId = tg.chatId || process.env.TELEGRAM_CHAT_ID;
      if (!token || !chatId) return false;
      try {
        const botId = await this.api.telegram.initBot(token);
        await this.api.telegram.sendMessage(botId, chatId, body);
        return true;
      } catch {
        return false;
      }
    };

    const tryDiscord = async (): Promise<boolean> => {
      if (!this.api.discord) return false;
      const dc = this.api.config.getDiscord();
      const channelId = dc.channelIds?.[0];
      if (!dc.enabled || !dc.botToken || !channelId) return false;
      try {
        const clientId = await this.api.discord.initBot(dc.botToken);
        await this.api.discord.sendMessage(clientId, channelId, body);
        return true;
      } catch {
        return false;
      }
    };

    if (preferred === "telegram") {
      await tryTelegram();
      return;
    }
    if (preferred === "discord") {
      await tryDiscord();
      return;
    }
    if (!(await tryTelegram())) {
      await tryDiscord();
    }
  }

  private async handleListJSON(): Promise<Response> {
    const artifacts = await this.store.listAll();
    return Response.json(
      artifacts.map((a) => ({ ...a, completion: calculateCompletion(a.assets) }))
    );
  }

  private async handleListUI(): Promise<Response> {
    const artifacts = await this.store.listAll();
    const rows = artifacts
      .map((a) => {
        const pct = calculateCompletion(a.assets);
        return `<tr>
          <td><a href="/artifact/${a.id}">${a.name}</a></td>
          <td>${a.type}</td>
          <td>${a.state}</td>
          <td>${pct}%</td>
          <td>${a.updated}</td>
        </tr>`;
      })
      .join("");

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Artifacts</title>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS()}
    ${getHeaderBarCSS()}
    body { margin: 0; }
    .page { max-width: 900px; margin: 0 auto; padding: 1rem; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: .5rem; border-bottom: 1px solid #333; }
    a { color: #7fc7ff; }
  </style>
</head>
<body>
  <div class="header">${getHeaderHomeIconHTML()}<h1>Artifacts</h1></div>
  <div class="page">
    <table>
      <thead><tr><th>Name</th><th>Type</th><th>State</th><th>Progress</th><th>Updated</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5">No artifacts yet.</td></tr>`}</tbody>
    </table>
  </div>
</body>
</html>`;
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }
}
