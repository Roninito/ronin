import type { DutyAPI } from "../types/index.js";

/** Mirror an artifact's current state into memory/notes/artifact-<id>.md, overwriting on each call. */
export async function writeArtifactNote(
  api: DutyAPI,
  artifact: { id: string; name: string; state: string; type: string; description?: string }
): Promise<void> {
  await api.memory.store(`artifact-${artifact.id}`, {
    name: artifact.name,
    summary: artifact.description,
    state: artifact.state,
    artifactType: artifact.type,
  });
}
