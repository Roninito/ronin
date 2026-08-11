import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { DutyAPI } from "@ronin/types/index.js";
import { DutyLoader } from "../src/duty/DutyLoader.js";

const mockApi = {} as DutyAPI;

const DUTY_WITH_TOPOLOGY = `
import { BaseDuty } from "${process.cwd()}/src/duty/index.js";

export default class WithTopologyDuty extends BaseDuty {
  static events = { in: ["finance.data.updated"], out: ["finance.audit.completed"] };
  static beams = [{ target: "event-monitor", eventType: "capture" }];
  static queries = {
    out: [{ target: "rss-feed", queryType: "get-new-items", timeoutMs: 5000 }],
    served: ["get-audit-status"],
  };

  async execute() {}
}
`;

const DUTY_WITHOUT_TOPOLOGY = `
import { BaseDuty } from "${process.cwd()}/src/duty/index.js";

export default class NoTopologyDuty extends BaseDuty {
  async execute() {}
}
`;

describe("DutyLoader — declared event topology (static events/beams/queries)", () => {
  let scratchDir: string;

  afterEach(() => {
    if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
  });

  it("extracts static events/beams/queries into DutyMetadata when declared", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-duty-topology-"));
    const filePath = join(scratchDir, "with-topology.ts");
    writeFileSync(filePath, DUTY_WITH_TOPOLOGY);

    const loader = new DutyLoader(scratchDir);
    const metadata = await loader.loadDuty(filePath, mockApi);

    expect(metadata).not.toBeNull();
    expect(metadata!.events).toEqual({ in: ["finance.data.updated"], out: ["finance.audit.completed"] });
    expect(metadata!.beams).toEqual([{ target: "event-monitor", eventType: "capture" }]);
    expect(metadata!.queries).toEqual({
      out: [{ target: "rss-feed", queryType: "get-new-items", timeoutMs: 5000 }],
      served: ["get-audit-status"],
    });
  });

  it("leaves events/beams/queries undefined for duties that don't declare them (backward compatible)", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-duty-topology-"));
    const filePath = join(scratchDir, "no-topology.ts");
    writeFileSync(filePath, DUTY_WITHOUT_TOPOLOGY);

    const loader = new DutyLoader(scratchDir);
    const metadata = await loader.loadDuty(filePath, mockApi);

    expect(metadata).not.toBeNull();
    expect(metadata!.events).toBeUndefined();
    expect(metadata!.beams).toBeUndefined();
    expect(metadata!.queries).toBeUndefined();
  });
});
