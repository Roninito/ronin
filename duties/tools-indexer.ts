/**
 * Tools Indexer Duty
 *
 * Periodic refresh of the tool category docs (memory/notes/tools/*.md) that
 * chat reads to find and call plugin tools by category — see
 * src/tools/toolDocs.ts. The real generation already happens once at boot
 * (src/api/index.ts); this is a safety net in case anything about the
 * registered tool set changes without a full restart.
 *
 * This used to hand-maintain a hardcoded list of "common skills" and "system
 * tools" instead of reading the real tool registry — exactly the kind of
 * stale approximation this duty now replaces with the genuine thing.
 */

import * as path from "path";
import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";
import { generateAndWriteToolDocs, resolveToolDocsBaseDir } from "../src/tools/toolDocs.js";

export default class ToolsIndexerDuty extends BaseDuty {
  // Run daily at midnight
  static schedule = "0 0 * * *";
  static description = "Refreshes the per-category tool docs chat reads on demand";

  constructor(api: DutyAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    try {
      // Resolve the doc dir against the active memory root instead of CWD —
      // see the matching fix in src/api/index.ts for the same bug at boot.
      const baseDir = resolveToolDocsBaseDir(this.api);
      const summaries = await generateAndWriteToolDocs(this.api, baseDir);
      const totalTools = summaries.reduce((sum, s) => sum + s.toolCount, 0);
      console.log(
        `[tools-indexer] ✅ Refreshed tool docs: ${summaries.length} categories, ${totalTools} tools`
      );
    } catch (error) {
      console.error("[tools-indexer] ❌ Error refreshing tool docs:", error);
    }
  }
}
