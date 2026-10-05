import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseContractFile, loadContracts, cronMatches } from "../src/tasker/contracts.js";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ronin-contracts-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, body: string): string {
  const file = join(dir, name);
  writeFileSync(file, body);
  return file;
}

const CRON_MD = `---
name: morning-briefing
description: Run the morning briefing every day at 8am
trigger: cron
cron: "0 8 * * *"
mode: sar
on_failure: ignore
---

Do the briefing.
`;

describe("parseContractFile", () => {
  it("parses flat frontmatter and prompt body", () => {
    const c = parseContractFile(write("a.md", CRON_MD));
    expect(c).not.toBeNull();
    expect(c!.name).toBe("morning-briefing");
    expect(c!.trigger).toBe("cron");
    expect(c!.cron).toBe("0 8 * * *");
    expect(c!.mode).toBe("sar");
    expect(c!.prompt).toBe("Do the briefing.");
  });

  it("falls back to filename when name is missing", () => {
    const c = parseContractFile(write("fallback.md", CRON_MD.replace("name: morning-briefing\n", "")));
    expect(c!.name).toBe("fallback");
  });

  it("rejects event trigger without an event line, cron without cron, bad mode, empty body", () => {
    expect(parseContractFile(write("e.md", "---\ntrigger: event\nmode: sar\n---\n\nDo it.\n"))).toBeNull();
    expect(parseContractFile(write("c.md", "---\ntrigger: cron\nmode: sar\n---\n\nDo it.\n"))).toBeNull();
    expect(parseContractFile(write("m.md", "---\ntrigger: manual\nmode: ssh\n---\n\nDo it.\n"))).toBeNull();
    expect(parseContractFile(write("b.md", "---\ntrigger: manual\nmode: sar\n---\n"))).toBeNull();
    expect(parseContractFile(write("n.md", "no frontmatter here\n"))).toBeNull();
  });
});

describe("loadContracts", () => {
  it("loads every valid .md and skips the rest", () => {
    write("good.md", CRON_MD);
    write("bad.md", "no frontmatter\n");
    write("notes.txt", "not markdown\n");
    const all = loadContracts(dir);
    expect(all.map((c) => c.name)).toEqual(["morning-briefing"]);
  });

  it("returns [] for a missing directory", () => {
    expect(loadContracts(join(dir, "nope"))).toEqual([]);
  });
});

describe("cronMatches", () => {
  // 2026-10-05 is a Monday. Months are 1-based in cron.
  const monday0930 = new Date(2026, 9, 5, 9, 30);
  const monday0800 = new Date(2026, 9, 5, 8, 0);
  const sunday1200 = new Date(2026, 9, 4, 12, 0);

  it("matches exact, star, and step expressions", () => {
    expect(cronMatches("30 9 * * *", monday0930)).toBe(true);
    expect(cronMatches("30 9 * * *", monday0800)).toBe(false);
    expect(cronMatches("* * * * *", monday0930)).toBe(true);
    expect(cronMatches("*/30 * * * *", monday0930)).toBe(true);
    expect(cronMatches("*/30 * * * *", monday0800)).toBe(true);
    expect(cronMatches("*/15 * * * *", monday0930)).toBe(true);
  });

  it("supports ranges and weekday lists (portfolio-sync shape)", () => {
    expect(cronMatches("*/15 9-16 * * 1-5", monday0930)).toBe(true);
    expect(cronMatches("*/15 9-16 * * 1-5", monday0800)).toBe(false); // minute 0 matches */15 but hour 8 out of range
    expect(cronMatches("*/15 9-16 * * 1-5", sunday1200)).toBe(false); // Sunday not in 1-5
    expect(cronMatches("0 8 * * 1,3,5", monday0800)).toBe(true);
    expect(cronMatches("0 8 * * 0,7", sunday1200)).toBe(false); // wrong time anyway
    expect(cronMatches("0 12 * * 0,7", sunday1200)).toBe(true); // 7 == Sunday
  });

  it("rejects malformed expressions", () => {
    expect(cronMatches("0 8 * *", monday0800)).toBe(false);
    expect(cronMatches("abc * * * *", monday0800)).toBe(false);
  });
});
