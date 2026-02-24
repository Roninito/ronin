/**
 * Kata Registry — Phase 7
 *
 * Manages registration, storage, and retrieval of compiled katas
 * Ensures immutability and version management
 */

import type { AgentAPI } from "../types/index.js";
import { KataParser } from "./parser.js";
import { KataCompiler } from "./compiler.js";
import { KataStorage } from "../task/storage.js";
import type { CompiledKata, KataDefinition } from "./types.js";

/**
 * Kata Registry
 */
export class KataRegistry {
  private parser = new KataParser();
  private compiler = new KataCompiler();
  private storage: KataStorage;

  constructor(private api: AgentAPI) {
    this.storage = new KataStorage(api);
  }

  /**
   * Register a kata from DSL source
   * Parses, compiles, validates, and stores
   */
  async register(source: string): Promise<CompiledKata> {
    // Parse
    const ast = this.parser.parse(source);

    // Compile (validation included)
    const compiled = this.compiler.compile(ast);

    // Check not already registered (immutability)
    const id = `${compiled.name}_${compiled.version}`;
    if (await this.storage.exists(compiled.name, compiled.version)) {
      throw new Error(
        `Kata '${compiled.name}' version '${compiled.version}' already registered (katas are immutable)`
      );
    }

    // Store
    await this.storage.save(
      id,
      compiled.name,
      compiled.version,
      source,
      compiled,
      compiled.checksum
    );

    return compiled;
  }

  /**
   * Get kata by name and version
   */
  async get(name: string, version: string): Promise<CompiledKata | null> {
    const def = await this.storage.getByVersion(name, version);
    if (!def) return null;

    return {
      ...def.compiledGraph,
      checksum: def.checksum,
    };
  }

  /**
   * Get all versions of a kata
   */
  async getVersions(name: string): Promise<CompiledKata[]> {
    const defs = await this.storage.getVersions(name);
    return defs.map((d) => ({
      ...d.compiledGraph,
      checksum: d.checksum,
    }));
  }

  /**
   * Check if kata is registered
   */
  async exists(name: string, version: string): Promise<boolean> {
    return this.storage.exists(name, version);
  }

  /**
   * Validate DSL without registering
   */
  validateDSL(source: string): {
    valid: boolean;
    errors: Array<{ rule: string; message: string; phase?: string }>;
  } {
    try {
      const ast = this.parser.parse(source);
      return this.compiler.validate(ast);
    } catch (error) {
      return {
        valid: false,
        errors: [{ rule: "parse_error", message: String(error) }],
      };
    }
  }
}
