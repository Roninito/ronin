/**
 * JSON-schema-ish parameter description for a single plugin method, surfaced to the
 * LLM's function-calling schema. Keys must be listed in the same order as the method's
 * actual positional parameters — the generic tool dispatcher (src/api/index.ts) maps
 * named arguments back to a positional call in this declared order.
 */
export interface PluginMethodMeta {
  /** What this method does and when to use it — shown to the LLM verbatim as the tool description. */
  description: string;
  parameters?: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

/**
 * Plugin interface definition
 */
export interface Plugin {
  /**
   * Plugin name (must be unique)
   */
  name: string;

  /**
   * Plugin description
   */
  description: string;

  /**
   * Plugin methods - functions that can be called via api.plugins.call()
   *
   * `any` here (not `unknown`) is deliberate: every plugin assigns this as an object
   * literal of arrow functions with concrete parameter/return types, and TypeScript
   * checks arrow-function object-literal properties contravariantly under
   * `strictFunctionTypes`. A `(...args: unknown[]) => unknown` target rejects every
   * one of those narrower signatures (`unknown` isn't assignable to e.g. `string`),
   * which is exactly what made every real plugin method fail to type-check the moment
   * plugins/** was added to tsconfig's `include` (2026-09-05) — `any` opts out of
   * variance checking here, matching how this registry is actually dispatched
   * (PluginsAPI.call invokes by name with untyped args; each plugin checks its own
   * inputs at the top of its own methods).
   */
  methods: Record<string, (...args: any[]) => any>;

  /**
   * Optional per-method tool metadata (real description + parameter schema) for methods
   * listed here. Methods not listed fall back to a generic, low-information description —
   * see src/plugins/toolGenerator.ts. Keep this a parallel map (not wrapping the methods
   * themselves) so `methods[name]` stays a plain callable function everywhere else
   * (PluginsAPI.call, direct duty usage, etc.) — nothing else has to change.
   */
  toolMetadata?: Record<string, PluginMethodMeta>;
}

/**
 * Plugin metadata after loading
 */
export interface PluginMetadata {
  name: string;
  description: string;
  methods: string[];
  filePath: string;
  plugin: Plugin;
}

