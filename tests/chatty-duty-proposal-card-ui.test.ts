import { describe, it, expect } from "bun:test";
import type { DutyAPI } from "@ronin/types/index.js";
import ChattyAgent from "../duties/chatty.js";

// Sibling to chatty-proposal-card-ui.test.ts, for the third PROPOSAL_KINDS
// entry (duty-proposal) added alongside duties.proposeDuty. Verifies the
// same hand-escaped template-literal script stays syntactically valid with
// three kinds instead of two, that decideProposal's kind lookup (previously
// a two-way ternary, now PROPOSAL_KINDS[kind + '-proposal']) resolves the
// duty kind correctly, and that a duty-proposal fence's extra `code` field
// survives extraction (unlike contract/workflow fences, which never carry it).
describe("Chatty /chat page — duty-proposal card (three-way PROPOSAL_KINDS)", () => {
  async function getScript(): Promise<string> {
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

    const scriptBlocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const script = scriptBlocks.find((s) => s.includes("extractProposalCards"));
    expect(script).toBeDefined();
    return script!;
  }

  it("registers the duty-proposal kind with the right approve/refuse URLs", async () => {
    const script = await getScript();
    expect(script).toContain("duty-proposal");
    expect(script).toContain("/api/duties/proposals/approve");
    expect(script).toContain("/api/duties/proposals/refuse");
    expect(script).toContain("dutyName");
  });

  it("extractProposalCards parses a duty-proposal fence, preserving id/preview/code/kind", async () => {
    const script = await getScript();
    const kindsMatch = script.match(/const PROPOSAL_KINDS = \{[\s\S]*?\n {4}\};/);
    expect(kindsMatch).not.toBeNull();
    const fnMatch = script.match(/function extractProposalCards\([\s\S]*?\n {4}\}/);
    expect(fnMatch).not.toBeNull();

    const runExtract = new Function(
      "input",
      kindsMatch![0] + "\n" + fnMatch![0] + "\nreturn extractProposalCards(input);"
    );

    const payload = { id: "dprop_1", preview: "Creates duty 'watch-our-design'", code: "export default class {}" };
    const sample = "Here's the draft.\n\n```duty-proposal\n" + JSON.stringify(payload) + "\n```";
    const result = runExtract(sample);

    expect(result.cards).toEqual([{ ...payload, kind: "duty" }]);
    expect(result.text).not.toContain("```duty-proposal");
    expect(result.text).toContain("Here's the draft.");
  });

  it("decideProposal's kind lookup resolves 'duty' to the duty-proposal config, not the contract fallback", async () => {
    const script = await getScript();
    const kindsMatch = script.match(/const PROPOSAL_KINDS = \{[\s\S]*?\n {4}\};/);
    const fnMatch = script.match(/async function decideProposal\([\s\S]*?\n {4}\}/);
    expect(fnMatch).not.toBeNull();

    // decideProposal does a real fetch() — stub it out and just capture which
    // URL it resolved to, proving the lookup (not the old two-way ternary)
    // picked the duty config's approveUrl for kind: 'duty'.
    let calledUrl: string | undefined;
    const runDecide = new Function(
      "fetch",
      kindsMatch![0] + "\n" + fnMatch![0] +
      "\nreturn decideProposal('dprop_1', 'duty', 'approve', { querySelectorAll: () => [], innerHTML: '' });"
    );
    await runDecide((url: string) => {
      calledUrl = url;
      return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
    });

    expect(calledUrl).toBe("/api/duties/proposals/approve");
  });

  it("renderProposalCard includes a collapsed code block only for duty-kind cards", async () => {
    const script = await getScript();
    expect(script).toContain("proposal-card-code-details");
    expect(script).toContain("View generated code");
    // Guarded on card.kind === 'duty' — contract/workflow cards (no `code`
    // field) must not render an empty/broken <details> block.
    expect(script).toContain("card.kind === 'duty'");
  });
});
