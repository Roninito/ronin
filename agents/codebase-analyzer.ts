/**
 * Codebase Analyzer Agent
 * 
 * Runs daily to analyze and index codebase files in the ontology.
 * Scans: TypeScript files in src/ and agents/
 * Extracts: File metadata, exports, imports, dependencies
 * Stores: File nodes and relationships in ontology
 */

import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import { createCodebaseFileNode, linkFileExport, linkFileImport, type CodebaseFileMetadata } from "../src/ontology/schemas.js";
import { promises as fs } from "fs";
import { join, relative, basename } from "path";

export default class CodebaseAnalyzerAgent extends BaseAgent {
  // Run daily at 1 AM
  static schedule = "0 1 * * *";

  private rootDir = process.cwd();

  constructor(api: AgentAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    try {
      console.log("[codebase-analyzer] Starting codebase analysis...");

      // Find all TypeScript files
      const files = await this.findTypeScriptFiles();

      if (files.length === 0) {
        console.warn("[codebase-analyzer] ⚠️ No TypeScript files found");
        return;
      }

      console.log(`[codebase-analyzer] Found ${files.length} TypeScript files to analyze`);

      // Analyze each file
      let analyzed = 0;
      for (const filePath of files) {
        try {
          await this.analyzeAndIndexFile(filePath);
          analyzed++;
        } catch (error) {
          console.error(`[codebase-analyzer] Error analyzing ${filePath}:`, error);
        }
      }

      console.log(`[codebase-analyzer] ✅ Analyzed ${analyzed}/${files.length} files`);

      // Log summary
      this.logAnalysisSummary(analyzed, files.length);
    } catch (error) {
      console.error("[codebase-analyzer] ❌ Error in codebase analysis:", error);
    }
  }

  private async findTypeScriptFiles(): Promise<string[]> {
    const files: string[] = [];

    const dirsToSearch = [
      join(this.rootDir, "src"),
      join(this.rootDir, "agents"),
    ];

    for (const dir of dirsToSearch) {
      try {
        const dirFiles = await this.findFilesRecursive(dir, ".ts");
        files.push(...dirFiles);
      } catch (error) {
        console.warn(`[codebase-analyzer] Could not search ${dir}:`, error);
      }
    }

    return files;
  }

  private async findFilesRecursive(dir: string, extension: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        // Skip node_modules and hidden directories
        if (entry.name.startsWith(".") || entry.name === "node_modules") {
          continue;
        }

        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          // Recurse into directories
          const subFiles = await this.findFilesRecursive(fullPath, extension);
          files.push(...subFiles);
        } else if (entry.isFile() && entry.name.endsWith(extension)) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      console.warn(`[codebase-analyzer] Error reading directory ${dir}:`, error);
    }

    return files;
  }

  private async analyzeAndIndexFile(filePath: string): Promise<void> {
    try {
      // Read file content
      const content = await fs.readFile(filePath, "utf-8");

      // Get file stats
      const stat = await fs.stat(filePath);

      // Extract metadata
      const exports = this.extractExports(content);
      const imports = this.extractImports(content);
      const complexity = this.calculateComplexity(content);

      // Get relative path
      const relativePath = relative(this.rootDir, filePath);
      const fileName = basename(filePath);

      // Create metadata
      const metadata: CodebaseFileMetadata & { name: string } = {
        path: relativePath,
        size_bytes: stat.size,
        language: "typescript",
        exports,
        imports,
        last_modified: stat.mtime.toISOString(),
        collected_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 3600000).toISOString(),
        source_agent: "codebase-analyzer",
        complexity,
        has_tests: content.includes("describe(") || content.includes("it("),
        name: fileName,
      };

      // Store in ontology
      if (this.api.ontology) {
        await createCodebaseFileNode(this.api, metadata);

        // Create export relationships
        for (const exportName of exports) {
          try {
            await linkFileExport(this.api, relativePath, exportName);
          } catch (error) {
            // Ignore individual relationship failures
          }
        }

        // Create import relationships
        for (const importPath of imports) {
          try {
            await linkFileImport(this.api, relativePath, importPath);
          } catch (error) {
            // Ignore individual relationship failures
          }
        }
      }
    } catch (error) {
      throw new Error(`Failed to analyze ${filePath}: ${error}`);
    }
  }

  private extractExports(content: string): string[] {
    const exports: string[] = [];
    const patterns = [
      /export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
      /export\s+\{\s*([^}]+)\s*\}/g,
      /export\s+(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
      /export\s+class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
      /export\s+interface\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
      /export\s+type\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const exportName = match[1];
        if (exportName) {
          // Handle export { a, b, c } pattern
          const names = exportName.split(",").map((n) => n.trim());
          exports.push(...names.filter((n) => n && n.length > 0));
        }
      }
    }

    // Remove duplicates
    return [...new Set(exports)];
  }

  private extractImports(content: string): string[] {
    const imports: string[] = [];

    // Match: import ... from "..."
    const pattern = /import\s+(?:.*?)\s+from\s+["']([^"']+)["']/g;

    let match;
    while ((match = pattern.exec(content)) !== null) {
      const importPath = match[1];
      if (importPath) {
        imports.push(importPath);
      }
    }

    // Remove duplicates
    return [...new Set(imports)];
  }

  private calculateComplexity(content: string): "low" | "medium" | "high" {
    // Simple heuristic: count lines and function definitions
    const lines = content.split("\n").length;
    const functions = (content.match(/function\s+|=>|async\s+/g) || []).length;
    const classes = (content.match(/class\s+/g) || []).length;

    const complexity = lines + functions * 2 + classes * 3;

    if (complexity < 100) return "low";
    if (complexity < 300) return "medium";
    return "high";
  }

  private logAnalysisSummary(analyzed: number, total: number): void {
    const percentage = ((analyzed / total) * 100).toFixed(1);

    console.log(`
[codebase-analyzer] 📚 Codebase Analysis Summary:
  Files analyzed: ${analyzed}/${total} (${percentage}%)
  Timestamp: ${new Date().toLocaleString()}
  Next analysis: In 24 hours
    `);
  }
}
