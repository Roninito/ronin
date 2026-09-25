/**
 * ReAct-style tool-call parsing for chat backends that do not support native
 * function calling (e.g. Opencode CLI). The backend emits lines like:
 *
 *   TOOL: local.file.read {"path": "/tmp/test.txt"}
 *
 * Ronin parses these, executes the named tools locally, and feeds the results
 * back to the backend for synthesis.
 */

export function parseReActToolCalls(content: string): Array<{ name: string; arguments: Record<string, unknown> }> {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const lines = content.split("\n");
  for (const line of lines) {
    const match = line.match(/^\s*TOOL:\s*([\w.:-]+)\s*(\{.*\})?\s*$/);
    if (!match) continue;
    const name = String(match[1]);
    let args: Record<string, unknown> = {};
    if (match[2]) {
      try {
        args = JSON.parse(match[2]);
      } catch {
        args = {};
      }
    }
    calls.push({ name, arguments: args });
  }
  return calls;
}
