import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { DutyAPI } from "@ronin/types/index.js";
import { proposeDuty, DutyProposeError } from "../src/duty/propose.js";

const VALID_DUTY_CODE = `\`\`\`typescript
import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";

export default class DesignScribeDuty extends BaseDuty {
  constructor(api: DutyAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    // watches design threads
  }
}
\`\`\``;

function mockAPI(aiResponse: string): DutyAPI {
  return {
    ai: {
      complete: async (_prompt: string) => aiResponse,
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as DutyAPI;
}

// proposeDuty's collision check calls resolveExternalDutyDir(), which
// resolves to ~/.ronin/duties (os.homedir()-based) unless
// RONIN_EXTERNAL_DUTY_DIR is set. A chdir doesn't isolate that, and neither
// does overriding process.env.HOME (Bun's os.homedir() doesn't re-read it at
// runtime, unlike Node's) — set RONIN_EXTERNAL_DUTY_DIR itself instead, so
// this never reads or races against the real ~/.ronin/duties.
describe("proposeDuty", () => {
  let scratchDir: string | undefined;
  let originalCwd: string | undefined;
  let originalExternalDutyDir: string | undefined;

  afterEach(() => {
    if (originalCwd) {
      process.chdir(originalCwd);
      originalCwd = undefined;
    }
    if (originalExternalDutyDir === undefined) {
      delete process.env.RONIN_EXTERNAL_DUTY_DIR;
    } else {
      process.env.RONIN_EXTERNAL_DUTY_DIR = originalExternalDutyDir;
    }
    if (scratchDir) {
      rmSync(scratchDir, { recursive: true, force: true });
      scratchDir = undefined;
    }
  });

  function isolate(): void {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-duty-propose-"));
    originalCwd = process.cwd();
    process.chdir(scratchDir);
    originalExternalDutyDir = process.env.RONIN_EXTERNAL_DUTY_DIR;
    process.env.RONIN_EXTERNAL_DUTY_DIR = join(scratchDir, "duties");
  }

  it("drafts a valid duty and derives a kebab-case name + preview from the intent", async () => {
    isolate();

    const api = mockAPI(VALID_DUTY_CODE);
    const proposal = await proposeDuty("watch our design threads on Discord and keep a running GDD", api);

    expect(proposal.dutyName).toBe("watch-our-design");
    expect(proposal.code).toContain("export default class DesignScribeDuty extends BaseDuty");
    expect(proposal.code).not.toContain("```");
    expect(proposal.preview).toContain("watch-our-design");
    expect(proposal.preview).toContain("watch our design threads on Discord and keep a running GDD");
  });

  it("rejects code missing extends BaseDuty", async () => {
    isolate();

    const api = mockAPI("```typescript\nimport { BaseDuty } from \"../src/duty/index.js\";\nexport default class Foo {\n  async execute() {}\n}\n```");
    await expect(proposeDuty("do something", api)).rejects.toThrow(DutyProposeError);
  });

  it("rejects code missing an execute() method", async () => {
    isolate();

    const api = mockAPI("```typescript\nimport { BaseDuty } from \"../src/duty/index.js\";\nexport default class Foo extends BaseDuty {}\n```");
    await expect(proposeDuty("do something", api)).rejects.toThrow(DutyProposeError);
  });

  it("rejects an empty intent", async () => {
    isolate();

    const api = mockAPI(VALID_DUTY_CODE);
    await expect(proposeDuty("   ", api)).rejects.toThrow(DutyProposeError);
  });

  it("disambiguates the duty name when a file with that name already exists in the target directory", async () => {
    isolate();
    const { mkdirSync, writeFileSync } = require("fs") as typeof import("fs");
    mkdirSync(join(scratchDir!, "duties"), { recursive: true });
    writeFileSync(join(scratchDir!, "duties", "watch-our-design.ts"), "// existing duty");

    const api = mockAPI(VALID_DUTY_CODE);
    const proposal = await proposeDuty("watch our design threads on Discord and keep a running GDD", api);

    expect(proposal.dutyName).not.toBe("watch-our-design");
    expect(proposal.dutyName).toMatch(/^watch-our-design-/);
  });
});
