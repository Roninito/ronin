/**
 * Ronin model resolution middleware.
 * Wires the @ronin/sar createModelResolutionMiddleware with the local model selector plugin.
 */
import { createModelResolutionMiddleware } from "@ronin/sar";
import { modelSelector } from "../../plugins/model-selector.js";

export const modelResolution = createModelResolutionMiddleware(modelSelector);
export default modelResolution;

// Re-export factory and types for callers that want to build their own
export { createModelResolutionMiddleware } from "@ronin/sar";
export type { ModelRegistry, ModelInfo } from "@ronin/sar";
