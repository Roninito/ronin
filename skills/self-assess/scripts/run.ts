import { $ } from "bun";

try {
  const result = await $`bun run ronin doctor`.nothrow();
  const output = {
    success: result.exitCode === 0,
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
  console.log(JSON.stringify(output));
  process.exit(result.exitCode);
} catch (error) {
  console.log(
    JSON.stringify({
      success: false,
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    })
  );
  process.exit(1);
}
