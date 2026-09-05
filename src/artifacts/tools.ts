/**
 * Registers the 8 artifact_* tools as native ToolDefinitions (full JSON-Schema
 * params, unlike the generic {args:[]} shape produced by
 * src/plugins/toolGenerator.ts for plugin methods).
 */

import { readFile } from "fs/promises";
import type { DutyAPI } from "../types/index.js";
import type { ToolDefinition, ToolResult } from "../tools/types.js";
import type { ArtifactStore } from "./store.js";
import { generateIndexHTML } from "./index-html.js";
import type { ArtifactState, ArtifactType, AssetRecordType, LogAction } from "./types.js";
import { assetFileExists, getArtifactAssetsDir, guessMimeType, resolveStoredAssetPath } from "./storage.js";
import { writeArtifactNote } from "./memoryNote.js";

const ARTIFACT_TYPES: ArtifactType[] = ["game_assets", "research", "prototype", "pipeline", "library", "documentation"];
const ARTIFACT_STATES: ArtifactState[] = ["INITIALIZED", "ACTIVE", "PROCESSING", "REVIEW", "COMPLETE", "ARCHIVED"];
const ASSET_RECORD_TYPES: AssetRecordType[] = ["model", "texture", "document", "research", "code", "reference"];
const LOG_ACTIONS: LogAction[] = ["GATHERED", "CONVERTED", "VALIDATED", "ERROR"];

function ok(toolName: string, data: any, startTime: number): ToolResult {
  return {
    success: true,
    data,
    metadata: { toolName, provider: "artifacts", duration: Date.now() - startTime, cached: false, timestamp: Date.now(), callId: `artifact-${Date.now()}` },
  };
}

function fail(toolName: string, error: string, startTime: number): ToolResult {
  return {
    success: false,
    data: null,
    error,
    metadata: { toolName, provider: "artifacts", duration: Date.now() - startTime, cached: false, timestamp: Date.now(), callId: `artifact-${Date.now()}` },
  };
}

/**
 * Registers a dashboard route for a single artifact. Routes are exact-string
 * (src/api/http.ts has no :id param matching), so this is called once at
 * creation and again for every existing artifact when the owning duty starts.
 */
export function registerArtifactRoutes(api: DutyAPI, store: ArtifactStore, id: string): void {
  api.http.registerRoute(
    `/artifact/${id}`,
    async () => {
      const file = await store.load(id);
      if (!file) return new Response("Artifact not found", { status: 404 });
      return new Response(generateIndexHTML(file), { headers: { "Content-Type": "text/html" } });
    },
    { title: `Artifact: ${id}`, description: "Artifact progress dashboard" }
  );

  api.http.registerRoute(`/api/artifact/${id}`, async () => {
    const file = await store.load(id);
    if (!file) return Response.json({ error: "Artifact not found" }, { status: 404 });
    return Response.json(file.metadata);
  });
}

/**
 * Serves a single stored binary asset (e.g. a screenshot) for one artifact.
 * Like registerArtifactRoutes, this is exact-string per file: called once
 * when the asset is recorded, and again for every stored asset when the
 * owning duty restarts (the route Map is in-memory only).
 */
export function registerArtifactAssetRoute(api: DutyAPI, artifactId: string, storedPath: string): void {
  const absolutePath = resolveStoredAssetPath(api, artifactId, storedPath);
  api.http.registerRoute(`/api/artifact/${artifactId}/asset/${storedPath}`, async () => {
    try {
      const bytes = await readFile(absolutePath);
      return new Response(bytes, { headers: { "Content-Type": guessMimeType(storedPath) } });
    } catch {
      return new Response("Asset not found", { status: 404 });
    }
  });
}

export function registerArtifactTools(api: DutyAPI, store: ArtifactStore): void {
  const tools: ToolDefinition[] = [
    {
      name: "artifact_create",
      description:
        "Create a new Artifact: a persistent, cross-chat project container for multi-step collection/research/prototyping work. Only create one for ongoing, multi-session work — not single-session one-off tasks.",
      provider: "artifacts",
      riskLevel: "low",
      cacheable: false,
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Human-readable project name" },
          type: { type: "string", enum: ARTIFACT_TYPES },
          description: { type: "string" },
          tags: { type: "array", items: { type: "string" }, description: "Keywords used for relevance scoring and search" } as any,
          estimatedCompletion: { type: "string", description: "ISO date estimate" },
          completionThreshold: { type: "number", description: "% (0-100) at which the artifact is considered COMPLETE", default: 85 },
        },
        required: ["name", "type"],
      },
      handler: async (args, context) => {
        const start = Date.now();
        try {
          const meta = await store.create(args);
          registerArtifactRoutes(api, store, meta.id);
          api.events.emit("artifact:created", { artifactId: meta.id, name: meta.name, type: meta.type }, "artifact-manager");
          await writeArtifactNote(api, meta);
          return ok(
            "artifact_create",
            { artifactId: meta.id, dashboardUrl: `/artifact/${meta.id}`, assetsDir: getArtifactAssetsDir(api, meta.id) },
            start
          );
        } catch (e: any) {
          return fail("artifact_create", e?.message ?? String(e), start);
        }
      },
    },

    {
      name: "artifact_load",
      description: "Load an Artifact's full metadata, asset records, and recent activity log.",
      provider: "artifacts",
      riskLevel: "low",
      cacheable: false,
      parameters: {
        type: "object",
        properties: { artifactId: { type: "string" } },
        required: ["artifactId"],
      },
      handler: async (args, context) => {
        const start = Date.now();
        const file = await store.load(args.artifactId);
        if (!file) return fail("artifact_load", `Artifact not found: ${args.artifactId}`, start);
        return ok("artifact_load", { ...file, assetsDir: getArtifactAssetsDir(api, args.artifactId) }, start);
      },
    },

    {
      name: "artifact_updateProgress",
      description: "Update collected/pending/target counts for an asset category on an Artifact.",
      provider: "artifacts",
      riskLevel: "low",
      cacheable: false,
      parameters: {
        type: "object",
        properties: {
          artifactId: { type: "string" },
          category: { type: "string" },
          collected: { type: "number" },
          pending: { type: "number" },
          target: { type: "number" },
        },
        required: ["artifactId", "category"],
      },
      handler: async (args, context) => {
        const start = Date.now();
        try {
          await store.updateProgress(args.artifactId, args.category, {
            collected: args.collected,
            pending: args.pending,
            target: args.target,
          });
          api.events.emit("artifact:progress-updated", { artifactId: args.artifactId, category: args.category }, "artifact-manager");
          return ok("artifact_updateProgress", { success: true }, start);
        } catch (e: any) {
          return fail("artifact_updateProgress", e?.message ?? String(e), start);
        }
      },
    },

    {
      name: "artifact_addAsset",
      description:
        "Register a newly collected/generated asset file in an Artifact. To attach a locally stored file (e.g. an agent-browser screenshot), save it under the artifact's assetsDir (returned by artifact_create/artifact_load) first, then pass its filename as storedPath — it will be validated and served at /api/artifact/<id>/asset/<storedPath>.",
      provider: "artifacts",
      riskLevel: "low",
      cacheable: false,
      parameters: {
        type: "object",
        properties: {
          artifactId: { type: "string" },
          assetType: { type: "string", enum: ASSET_RECORD_TYPES },
          filename: { type: "string" },
          source: { type: "string" },
          license: { type: "string" },
          metadata: { type: "object" },
          storedPath: {
            type: "string",
            description: "Basename of a file already saved under this artifact's assetsDir (see artifact_create/artifact_load). Must exist on disk.",
          },
        },
        required: ["artifactId", "assetType", "filename", "source"],
      },
      handler: async (args, context) => {
        const start = Date.now();
        try {
          if (args.storedPath && !assetFileExists(api, args.artifactId, args.storedPath)) {
            return fail(
              "artifact_addAsset",
              `storedPath "${args.storedPath}" was not found in this artifact's assetsDir. Save the file there first.`,
              start
            );
          }

          await store.addAsset(args.artifactId, {
            type: args.assetType,
            filename: args.filename,
            source: args.source,
            license: args.license,
            downloadedAt: new Date().toISOString(),
            metadata: args.metadata,
            storedPath: args.storedPath,
          });

          if (args.storedPath) {
            registerArtifactAssetRoute(api, args.artifactId, args.storedPath);
          }

          return ok(
            "artifact_addAsset",
            { success: true, assetUrl: args.storedPath ? `/api/artifact/${args.artifactId}/asset/${args.storedPath}` : undefined },
            start
          );
        } catch (e: any) {
          return fail("artifact_addAsset", e?.message ?? String(e), start);
        }
      },
    },

    {
      name: "artifact_appendLog",
      description: "Log an action or milestone against an Artifact's activity history.",
      provider: "artifacts",
      riskLevel: "low",
      cacheable: false,
      parameters: {
        type: "object",
        properties: {
          artifactId: { type: "string" },
          action: { type: "string", enum: LOG_ACTIONS },
          details: { type: "string" },
        },
        required: ["artifactId", "action", "details"],
      },
      handler: async (args, context) => {
        const start = Date.now();
        try {
          await store.appendLog(args.artifactId, {
            timestamp: new Date().toISOString(),
            skillId: "ronin",
            action: args.action,
            details: args.details,
          });
          return ok("artifact_appendLog", { success: true }, start);
        } catch (e: any) {
          return fail("artifact_appendLog", e?.message ?? String(e), start);
        }
      },
    },

    {
      name: "artifact_schedule",
      description:
        "Record that follow-up work is planned for an Artifact. Note: Ronin has no generic mechanism to dispatch arbitrary future duties — this records intent and logs it; use artifact_getSchedulingStatus to check the actual backoff-gated decision.",
      provider: "artifacts",
      riskLevel: "low",
      cacheable: false,
      parameters: {
        type: "object",
        properties: {
          artifactId: { type: "string" },
          notes: { type: "string", description: "What follow-up work is planned" },
        },
        required: ["artifactId", "notes"],
      },
      handler: async (args, context) => {
        const start = Date.now();
        try {
          await store.appendLog(args.artifactId, {
            timestamp: new Date().toISOString(),
            skillId: "ronin",
            action: "GATHERED",
            details: `Scheduled follow-up: ${args.notes}`,
          });
          api.events.emit("artifact:scheduled", { artifactId: args.artifactId, notes: args.notes }, "artifact-manager");
          return ok("artifact_schedule", { success: true }, start);
        } catch (e: any) {
          return fail("artifact_schedule", e?.message ?? String(e), start);
        }
      },
    },

    {
      name: "artifact_transitionState",
      description: "Move an Artifact through its lifecycle state machine (INITIALIZED -> ACTIVE -> PROCESSING/REVIEW -> COMPLETE/ARCHIVED).",
      provider: "artifacts",
      riskLevel: "medium",
      cacheable: false,
      parameters: {
        type: "object",
        properties: {
          artifactId: { type: "string" },
          newState: { type: "string", enum: ARTIFACT_STATES },
        },
        required: ["artifactId", "newState"],
      },
      handler: async (args, context) => {
        const start = Date.now();
        try {
          const meta = await store.transitionState(args.artifactId, args.newState);
          api.events.emit("artifact:state-transition", { artifactId: args.artifactId, to: args.newState }, "artifact-manager");
          await writeArtifactNote(api, meta);
          return ok("artifact_transitionState", { success: true, state: meta.state }, start);
        } catch (e: any) {
          return fail("artifact_transitionState", e?.message ?? String(e), start);
        }
      },
    },

    {
      name: "artifact_getSchedulingStatus",
      description: "Check whether an Artifact is due for more work, respecting backoff, max attempts, and completion state.",
      provider: "artifacts",
      riskLevel: "low",
      cacheable: false,
      parameters: {
        type: "object",
        properties: {
          artifactId: { type: "string" },
          newContext: { type: "string", description: "Optional new context to score for relevance" },
        },
        required: ["artifactId"],
      },
      handler: async (args, context) => {
        const start = Date.now();
        try {
          const decision = await store.evaluateSchedule(args.artifactId, args.newContext);
          return ok("artifact_getSchedulingStatus", decision, start);
        } catch (e: any) {
          return fail("artifact_getSchedulingStatus", e?.message ?? String(e), start);
        }
      },
    },
  ];

  for (const tool of tools) {
    api.tools.register(tool);
  }
}
