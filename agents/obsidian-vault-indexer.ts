/**
 * Obsidian Vault Indexer Agent
 *
 * Runs daily to index Obsidian vaults and update ontology.
 * Discovers notes, extracts metadata and frontmatter, creates ontology nodes.
 * Maintains fresh index of user's Obsidian knowledge base.
 */

import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import {
  createObsidianNoteNode,
  type ObsidianNoteMetadata,
} from "../src/ontology/schemas.js";
import type { ObsidianVaultConfig } from "../src/config/types.js";

export default class ObsidianVaultIndexerAgent extends BaseAgent {
  // Run daily at 2 AM (after codebase analyzer at 1 AM)
  static schedule = "0 2 * * *";

  constructor(api: AgentAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    try {
      console.log("[obsidian-vault-indexer] Starting vault indexing...");

      // Get configured vaults from config
      const config = this.api.config?.get?.("obsidian") as
        | { vaults: ObsidianVaultConfig[] }
        | undefined;

      if (!config?.vaults || config.vaults.length === 0) {
        console.log("[obsidian-vault-indexer] ℹ️ No Obsidian vaults configured. Skipping.");
        return;
      }

      // Index each enabled vault
      const results = {
        indexed: 0,
        updated: 0,
        errors: 0,
        vaults: 0,
      };

      for (const vaultConfig of config.vaults) {
        if (!vaultConfig.enabled) {
          continue;
        }

        const vaultResults = await this.indexVault(vaultConfig);
        results.indexed += vaultResults.indexed;
        results.updated += vaultResults.updated;
        results.errors += vaultResults.errors;
        results.vaults += 1;
      }

      console.log(
        `[obsidian-vault-indexer] ✅ Indexing complete: ${results.indexed} indexed, ${results.updated} updated, ${results.errors} errors across ${results.vaults} vaults`
      );
    } catch (error) {
      console.error("[obsidian-vault-indexer] ❌ Error indexing vaults:", error);
    }
  }

  private async indexVault(vaultConfig: ObsidianVaultConfig): Promise<{
    indexed: number;
    updated: number;
    errors: number;
  }> {
    const result = { indexed: 0, updated: 0, errors: 0 };

    try {
      // Get Obsidian plugin
      if (!this.api.plugins?.has?.("obsidian")) {
        console.warn(
          `[obsidian-vault-indexer] ⚠️ Obsidian plugin not available for vault ${vaultConfig.id}`
        );
        return result;
      }

      const obsidian = await this.api.plugins?.call?.("obsidian", "listNotes", [
        vaultConfig.path,
        vaultConfig.allowedFolders,
        true,
      ]);

      const notePaths = Array.isArray(obsidian) ? obsidian : [];

      console.log(
        `[obsidian-vault-indexer] Found ${notePaths.length} notes in vault ${vaultConfig.id}`
      );

      // Process each note
      for (const filePath of notePaths) {
        try {
          const note = await this.api.plugins?.call?.("obsidian", "readNote", [filePath]);

          if (!note) {
            result.errors++;
            continue;
          }

          // Set vault info
          note.vault_id = vaultConfig.id;
          note.relative_path = filePath.substring(vaultConfig.path.length + 1);

          // Create/update ontology node
          const metadata: ObsidianNoteMetadata = {
            collected_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 24 * 3600000).toISOString(), // 24 hours
            source_agent: "obsidian-vault-indexer",
            vault_id: note.vault_id,
            file_path: note.file_path,
            relative_path: note.relative_path,
            title: note.title,
            has_frontmatter: Object.keys(note.frontmatter || {}).length > 0,
            frontmatter: note.frontmatter,
            tags: note.tags,
            wikilinks: note.wikilinks,
            backlinks: note.backlinks || [],
            created_at: note.created_at,
            modified_at: note.modified_at,
            last_indexed_at: new Date().toISOString(),
          };

          if (this.api.ontology) {
            await createObsidianNoteNode(this.api, metadata);
            result.indexed++;
          }
        } catch (error) {
          console.error(
            `[obsidian-vault-indexer] ❌ Failed to process note ${filePath}:`,
            error
          );
          result.errors++;
        }
      }

      console.log(
        `[obsidian-vault-indexer] Vault ${vaultConfig.id}: indexed ${result.indexed}, errors ${result.errors}`
      );
    } catch (error) {
      console.error(
        `[obsidian-vault-indexer] ❌ Error indexing vault ${vaultConfig.id}:`,
        error
      );
    }

    return result;
  }
}
