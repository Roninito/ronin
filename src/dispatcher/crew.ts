import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

/**
 * Shared crew HTTP client for dispatcher duties.
 *
 * Talks to the crew machine service (default http://127.0.0.1:7717) with the
 * machine token from the local ~/.crew/crew.md frontmatter (`api.token`).
 * Follows crew's SPEC boundary: HTTP only, no shared files outside the token.
 *
 * No duty-to-duty imports: both duties/crew-dispatcher.ts (scheduled writer)
 * and duties/dispatcher-console.ts (read-only console) import this module.
 */

export const DEFAULT_CREW_PORT = 7717;
export const DEFAULT_CREW_AUTH_FILE = join(homedir(), ".crew", "crew.md");

export interface CrewAuth {
  token: string;
  port: number;
}

export interface CrewDispatcherAgent {
  name: string;
  state: string;
  task: string | null;
}

export interface CrewDispatcherProject {
  id: string | null;
  paused: boolean;
  agents: CrewDispatcherAgent[];
  tasks: unknown;
  review: string[];
  questions: string[];
  blocked: string[];
  jobs: unknown;
  spend: unknown;
}

export interface CrewDispatcherRollup {
  projects: CrewDispatcherProject[];
}

export interface CrewCmdResult {
  code: number;
  out: string;
  data: unknown;
}

/**
 * Parse the machine token/port out of ~/.crew/crew.md frontmatter:
 *
 *   ---
 *   api:
 *     port: 7717
 *     token: "..."
 *   ---
 */
export function parseCrewMd(text: string): CrewAuth {
  const tokenMatch = text.match(/token:\s*"([^"]+)"/);
  const portMatch = text.match(/port:\s*(\d+)/);
  return {
    token: tokenMatch?.[1] ?? "",
    port: portMatch?.[1] ? parseInt(portMatch[1], 10) : DEFAULT_CREW_PORT,
  };
}

export function loadCrewAuth(authFile: string = DEFAULT_CREW_AUTH_FILE): CrewAuth {
  const text = readFileSync(authFile, "utf8");
  return parseCrewMd(text);
}

/** Minimal fetch shape the client needs (typeof fetch carries extras like preconnect). */
export type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface CrewClientOptions {
  baseUrl?: string;
  token?: string;
  /** Path to crew.md for token/port discovery. Ignored when token+baseUrl are given. */
  authFile?: string;
  fetchFn?: FetchFn;
}

export class CrewClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchFn: FetchFn;

  constructor(options: CrewClientOptions = {}) {
    this.fetchFn = options.fetchFn ?? ((url, init) => fetch(url as string, init));

    if (options.token && options.baseUrl) {
      this.token = options.token;
      this.baseUrl = options.baseUrl.replace(/\/$/, "");
      return;
    }

    const fromEnv = process.env.CREW_TOKEN;
    const baseUrlEnv = process.env.CREW_BASE_URL;
    if (fromEnv && (options.baseUrl || baseUrlEnv)) {
      this.token = fromEnv;
      this.baseUrl = (options.baseUrl ?? baseUrlEnv)!.replace(/\/$/, "");
      return;
    }

    const auth = loadCrewAuth(options.authFile);
    if (!auth.token) {
      throw new Error(
        `No crew machine token found in ${options.authFile ?? DEFAULT_CREW_AUTH_FILE}. ` +
          `Is crew's machine service installed on this machine?`,
      );
    }
    this.token = options.token ?? fromEnv ?? auth.token;
    this.baseUrl = (options.baseUrl ?? baseUrlEnv ?? `http://127.0.0.1:${auth.port}`).replace(/\/$/, "");
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          Authorization: `Bearer ${this.token}`,
        },
      });
    } catch (err) {
      throw new Error(
        `Crew machine service not reachable at ${this.baseUrl} (${err instanceof Error ? err.message : String(err)}). ` +
          `Is \`crew serve\` running?`,
      );
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Crew request ${path} failed (${res.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      );
    }
    return (await res.json()) as T;
  }

  /** Machine-service health (auth-exempt on the crew side, sent anyway). */
  health(): Promise<{ ok: boolean; home: string; pid: number; projects: number }> {
    return this.request("/health");
  }

  /** One-call cross-project rollup (Step 0 endpoint). */
  dispatcher(): Promise<CrewDispatcherRollup> {
    return this.request("/dispatcher");
  }

  /**
   * Rollup with a fallback for crew services that predate the Step 0
   * endpoint: when GET /dispatcher 404s, the same shape is synthesized from
   * GET /status plus per-project /tasks and /questions. Callers see an
   * identical CrewDispatcherRollup either way.
   */
  async dispatcherWithFallback(): Promise<{ rollup: CrewDispatcherRollup; viaFallback: boolean }> {
    try {
      return { rollup: await this.dispatcher(), viaFallback: false };
    } catch (err) {
      if (!(err instanceof Error && err.message.includes("(404)"))) throw err;
    }

    const all = await this.statusAll();
    const projects: CrewDispatcherProject[] = [];
    for (const [id, raw] of Object.entries(all)) {
      const s = raw as {
        paused?: boolean;
        agents?: Array<{ name: string; state: string; task?: string | null }>;
        tasks?: unknown;
        jobs?: unknown;
        spend?: unknown;
      };
      const [tasks, questions] = await Promise.all([this.projectTasks(id), this.projectQuestions(id)]);
      projects.push({
        id,
        paused: s.paused ?? false,
        agents: (s.agents ?? []).map((a) => ({ name: a.name, state: a.state, task: a.task ?? null })),
        tasks: s.tasks ?? {},
        review: tasks.filter((t) => t.status === "review" || (t.sampled && !t.sampled_ack)).map((t) => t.id),
        questions: questions.map((q) => q.id),
        blocked: tasks.filter((t) => t.status === "blocked").map((t) => t.id),
        jobs: s.jobs ?? 0,
        spend: s.spend ?? 0,
      });
    }
    return { rollup: { projects }, viaFallback: true };
  }

  /** Full per-project status keyed by project id (fallback when /dispatcher is unavailable). */
  statusAll(): Promise<Record<string, unknown>> {
    return this.request("/status");
  }

  projects(): Promise<Array<{ id: string; status: string; path: string; missing?: boolean }>> {
    return this.request("/projects");
  }

  /** Recent events for one project (newest last, per crew's /events). */
  projectEvents(project: string, since?: number, limit = 50): Promise<unknown[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (since !== undefined) params.set("since", String(since));
    return this.request(`/p/${encodeURIComponent(project)}/events?${params.toString()}`);
  }

  /** Full task list for one project (used by the /dispatcher fallback). */
  projectTasks(project: string): Promise<Array<{ id: string; status: string; sampled?: boolean; sampled_ack?: boolean }>> {
    return this.request(`/p/${encodeURIComponent(project)}/tasks`);
  }

  /** Open questions for one project (used by the /dispatcher fallback). */
  projectQuestions(project: string): Promise<Array<{ id: string; status: string }>> {
    return this.request(`/p/${encodeURIComponent(project)}/questions`);
  }

  /**
   * Run a crew CLI command inside one project over HTTP.
   * Blocked server-side: serve, session, job exec.
   */
  cmd(project: string, argv: string[], as?: string): Promise<CrewCmdResult> {
    return this.request("/cmd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project, argv, ...(as ? { as } : {}) }),
    });
  }

  /** Wake one agent: `crew wake <agent> [--task id] [--reason text]`. */
  wake(project: string, agent: string, options: { task?: string; reason?: string } = {}): Promise<CrewCmdResult> {
    const argv = ["wake", agent];
    if (options.task) argv.push("--task", options.task);
    argv.push("--reason", options.reason ?? `woken by ronin crew-dispatcher`);
    return this.cmd(project, argv);
  }
}
