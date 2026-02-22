import { createAPI } from "/Users/ronin/Desktop/Bun Apps/ronin/src/api/index.ts";
import { getToolsAPI } from "/Users/ronin/Desktop/Bun Apps/ronin/src/api/tools.ts";
import { ToolRouter } from "/Users/ronin/Desktop/Bun Apps/ronin/src/tools/ToolRouter.ts";

async function test() {
  console.log("Creating API...");
  const api = await createAPI({ dbPath: ":memory:" });
  const toolsAPI = getToolsAPI(api);
  const router = new ToolRouter(api);

  console.log("Testing skills.run tool...");
  console.log("api.skills available:", !!api.skills);

  if (!api.skills) {
    console.error("FAIL: api.skills is not available!");
    process.exit(1);
  }

  try {
    const result = await router.execute(
      {
        id: "test-1",
        name: "skills.run",
        arguments: { query: "notes", action: "list" },
      },
      { conversationId: "test" }
    );
    console.log("Result:", JSON.stringify(result, null, 2));
  } catch (e) {
    console.error("Error:", e.message);
    console.error(e.stack);
  }
}

test();