import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";

/**
 * Simple test agent - no AI required, just tests plugins and APIs
 */
export default class TestAgent extends BaseAgent {
  constructor(api: AgentAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    console.log("🧪 Test Agent executing...\n");

    // Test 1: Memory operations
    console.log("📝 Test 1: Memory Operations");
    await this.api.memory.store("test_key", { message: "Hello from test agent!", timestamp: Date.now() });
    const retrieved = await this.api.memory.retrieve("test_key");
    console.log("   Stored and retrieved:", retrieved);
    console.log("   ✅ Memory test passed\n");

    // Test 2: File operations
    console.log("📁 Test 2: File Operations");
    try {
      const content = await this.api.files.read("./package.json");
      console.log("   Read package.json:", content.length, "bytes");
      console.log("   ✅ File read test passed\n");
    } catch (error) {
      console.log("   ⚠️  File read test failed:", error);
    }

    // Test 3: Shell plugin
    console.log("🐚 Test 3: Shell Plugin");
    try {
      const cwd = await this.api.plugins.call("shell", "cwd");
      console.log("   Current directory:", cwd);
      const env = await this.api.plugins.call("shell", "env");
      console.log("   Environment variables:", Object.keys(env as Record<string, unknown>).length, "vars");
      console.log("   ✅ Shell plugin test passed\n");
    } catch (error) {
      console.log("   ⚠️  Shell plugin test failed:", error);
    }

    // Test 4: Git plugin (if in a git repo)
    console.log("🔧 Test 4: Git Plugin");
    try {
      const status = await this.api.plugins.call("git", "status");
      console.log("   Git status:", status);
      console.log("   ✅ Git plugin test passed\n");
    } catch (error) {
      console.log("   ⚠️  Git plugin test failed (not a git repo or git not available):", (error as Error).message);
    }

    // Test 5: Database operations
    console.log("💾 Test 5: Database Operations");
    try {
      await this.api.db.execute("CREATE TABLE IF NOT EXISTS test_table (id INTEGER PRIMARY KEY, name TEXT)");
      await this.api.db.execute("INSERT INTO test_table (name) VALUES (?)", ["test_value"]);
      const results = await this.api.db.query<{ id: number; name: string }>("SELECT * FROM test_table WHERE name = ?", ["test_value"]);
      console.log("   Database query result:", results);
      console.log("   ✅ Database test passed\n");
    } catch (error) {
      console.log("   ⚠️  Database test failed:", error);
    }

    // Test 6: Events
    console.log("📡 Test 6: Events");
    let eventReceived = false;
    this.api.events.on("test_event", (data) => {
      console.log("   Event received:", data);
      eventReceived = true;
    });
    this.api.events.emit("test_event", { message: "Hello from event!" }, "test-agent");
    console.log("   Event emitted and received:", eventReceived);
    console.log("   ✅ Events test passed\n");

    console.log("✅ All tests completed!");
  }
}

