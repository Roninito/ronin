import { describe, it, expect } from "bun:test";
import type { DutyAPI } from "@ronin/types/index.js";
import ChattyAgent from "../duties/chatty.js";

// Verifies the /chat page's embedded <script> — which contains hand-escaped
// template-literal JS (extractProposalCards/renderProposalCard/decideProposal,
// added for the contract-proposal approval card) — is syntactically valid.
// The whole page is one big TS template literal with backticks/${} escaped by
// hand; a single missed backslash would corrupt the *entire* script silently
// (no build step catches this — it's a string until the browser parses it).
describe("Chatty /chat page — proposal card script is syntactically valid", () => {
  it("parses without a SyntaxError and contains the expected card functions", async () => {
    const routes = new Map<string, (req: Request) => Response | Promise<Response>>();

    const api = {
      config: {
        getAI: () => ({ models: { default: "test-model" }, ollamaModel: "test-model" }),
      },
      db: {
        query: async () => [],
        execute: async () => {},
      },
      http: {
        registerRoute: (path: string, handler: (req: Request) => Response | Promise<Response>) => {
          routes.set(path, handler);
        },
      },
      events: {
        emit: () => {},
        on: () => {},
        off: () => {},
      },
      tools: { getSchemas: () => [] },
      plugins: { has: () => false },
    } as unknown as DutyAPI;

    new ChattyAgent(api);

    const handler = routes.get("/chat");
    expect(handler).toBeDefined();

    const res = await handler!(new Request("http://localhost/chat"));
    const html = await res.text();

    // The page has multiple <script> blocks (CDN <script src=...> tags, a small
    // inline header-title patch, then the main chat-app script) — find the one
    // that actually contains our card functions rather than assuming position.
    const scriptBlocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const script = scriptBlocks.find((s) => s.includes("extractProposalCards"));
    expect(script).toBeDefined();

    // Syntax-only check: compiling (not calling) the function body throws on
    // any SyntaxError without needing a DOM.
    expect(() => new Function(script!)).not.toThrow();

    expect(script).toContain("function extractProposalCards");
    expect(script).toContain("function renderProposalCard");
    expect(script).toContain("function decideProposal");
    expect(script).toContain("contract-proposal");

    // Runtime check, not just syntax: actually call extractProposalCards and
    // confirm it strips the fence and parses the {id, preview} payload — this
    // is what proves the hand-escaped \n/backtick sequences produced a *working*
    // regex, not just one that happens to compile. Isolate this function's
    // source plus the PROPOSAL_KINDS const it closes over (rather than
    // executing the whole script, which has top-level DOM-touching init code
    // this test environment has no DOM for).
    const kindsMatch = script!.match(/const PROPOSAL_KINDS = \{[\s\S]*?\n {4}\};/);
    expect(kindsMatch).not.toBeNull();
    const fnMatch = script!.match(/function extractProposalCards\([\s\S]*?\n {4}\}/);
    expect(fnMatch).not.toBeNull();
    const runExtract = new Function(
      "input",
      kindsMatch![0] + "\n" + fnMatch![0] + "\nreturn extractProposalCards(input);"
    );
    const sample = 'Here you go.\n\n```contract-proposal\n{"id":"prop_1","preview":"Fires when trust.changed \\u2192 runs kata quiet.handoff"}\n```';
    const result = runExtract(sample);
    expect(result.cards).toEqual([{ id: "prop_1", preview: "Fires when trust.changed → runs kata quiet.handoff", kind: "contract" }]);
    expect(result.text).not.toContain("```contract-proposal");
    expect(result.text).toContain("Here you go.");
  });
});
