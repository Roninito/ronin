/**
 * Ontology Schema Definitions for Phase 5: System Knowledge Population
 * 
 * Defines metadata structures for system_info, tool_metadata, and codebase_file nodes.
 * These schemas are used by knowledge-gathering agents to store structured data.
 */

import type { AgentAPI } from "../types/index.js";

/**
 * System Information Node
 * Stores OS, CPU, memory, GPU, and runtime information
 * Updated every 6 hours by system-info-collector agent
 */
export interface SystemInfoMetadata {
  collected_at: string; // ISO timestamp
  expires_at: string;   // ISO timestamp (for freshness)
  source_agent: string; // "system-info-collector"
  
  os: {
    platform: "darwin" | "linux" | "win32";
    arch: string;
    version: string;
    hostname: string;
  };
  
  memory: {
    total_bytes: number;
    free_bytes: number;
    used_bytes: number;
    percent_used: number;
  };
  
  cpu: {
    cores: number;
    model: string;
  };
  
  gpu?: {
    available: boolean;
    models?: string[];
  };
  
  runtime: {
    node_version: string;
    bun_version?: string;
  };
  
  environment?: {
    NODE_ENV?: string;
    HOME?: string;
    // Add non-sensitive environment variables as needed
  };
}

/**
 * Tool Metadata Node
 * Stores metadata about registered tools (UnifiedTools)
 * Updated daily by tools-indexer agent
 */
export interface ToolMetadataNode {
  collected_at: string; // ISO timestamp
  expires_at: string;   // ISO timestamp (for freshness)
  source_agent: string; // "tools-indexer"
  
  tool_id: string;      // e.g., "files.read"
  domain?: string;      // e.g., "files", "shell", "code"
  
  parameters: Array<{
    name: string;
    type: "string" | "number" | "boolean" | "array" | "object";
    description: string;
    required: boolean;
    default?: unknown;
  }>;
  
  returns?: {
    type: string;
    description: string;
  };
  
  examples?: string[];  // Example usage strings
  version?: string;     // Tool version
}

/**
 * Codebase File Node
 * Stores metadata about TypeScript files in the codebase
 * Updated daily by codebase-analyzer agent
 */
export interface CodebaseFileMetadata {
  collected_at: string; // ISO timestamp
  expires_at: string;   // ISO timestamp (for freshness)
  source_agent: string; // "codebase-analyzer"
  
  path: string;         // Relative path (e.g., "src/tools/index.ts")
  size_bytes: number;
  language: string;     // "typescript", "javascript", etc.
  
  exports: string[];    // Exported symbol names
  imports: string[];    // Imported module paths
  
  last_modified: string; // ISO timestamp
  
  // Optional analysis
  complexity?: "low" | "medium" | "high";
  has_tests?: boolean;
}

/**
 * Environment Variable Node
 * Stores non-sensitive environment information
 */
export interface EnvironmentVarMetadata {
  collected_at: string; // ISO timestamp
  source_agent: string; // "system-info-collector"
  
  name: string;
  value?: string;       // Omitted for sensitive vars
  is_sensitive: boolean; // true for API keys, passwords, etc.
  description?: string;
}

/**
 * Helper function to serialize metadata
 * Ontology stores metadata as JSON string
 */
export function serializeMetadata(metadata: Record<string, unknown>): string {
  return JSON.stringify(metadata);
}

/**
 * Helper function to deserialize metadata
 */
export function deserializeMetadata(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/**
 * Create a system info node
 */
export async function createSystemInfoNode(
  api: AgentAPI,
  info: SystemInfoMetadata
): Promise<void> {
  if (!api.ontology) return;
  
  await api.ontology.setNode({
    id: "system.current",
    type: "system_info",
    name: "Current System Information",
    summary: `${info.os.platform} ${info.os.version} (${info.cpu.cores} cores, ${Math.round(info.memory.total_bytes / 1e9)}GB RAM)`,
    domain: "system",
    metadata: serializeMetadata(info),
  });
}

/**
 * Create a tool metadata node
 */
export async function createToolMetadataNode(
  api: AgentAPI,
  tool: ToolMetadataNode & { name: string; description: string }
): Promise<void> {
  if (!api.ontology) return;
  
  await api.ontology.setNode({
    id: `tool.${tool.tool_id}`,
    type: "tool_metadata",
    name: tool.name,
    summary: tool.description,
    domain: tool.domain || "general",
    metadata: serializeMetadata(tool),
  });
}

/**
 * Create a codebase file node
 */
export async function createCodebaseFileNode(
  api: AgentAPI,
  file: CodebaseFileMetadata & { name: string }
): Promise<void> {
  if (!api.ontology) return;
  
  await api.ontology.setNode({
    id: `file.${file.path.replace(/\//g, ".")}`,
    type: "codebase_file",
    name: file.name,
    summary: `${file.path} (${file.exports.length} exports)`,
    domain: "codebase",
    metadata: serializeMetadata(file),
  });
}

/**
 * Query helper: Get system capabilities
 */
export async function getSystemCapabilities(
  api: AgentAPI
): Promise<SystemInfoMetadata | null> {
  if (!api.ontology) return null;
  
  const node = await api.ontology.lookup("system.current");
  if (!node?.metadata) return null;
  
  const metadata = deserializeMetadata(node.metadata);
  
  // Check if data is fresh
  const expiresAt = new Date(metadata.expires_at as string);
  if (expiresAt < new Date()) {
    console.warn("[ontology] System info has expired, consider refreshing");
  }
  
  return metadata as SystemInfoMetadata;
}

/**
 * Query helper: Get available tools in a domain
 */
export async function getAvailableTools(
  api: AgentAPI,
  domain?: string
): Promise<Array<ToolMetadataNode & { name: string; id: string }>> {
  if (!api.ontology) return [];
  
  const results = await api.ontology.search({
    type: "tool_metadata",
    domain: domain || undefined,
    limit: 100,
  });
  
  return results
    .filter((node) => {
      if (!node.metadata) return false;
      const metadata = deserializeMetadata(node.metadata);
      const expiresAt = new Date(metadata.expires_at as string);
      return expiresAt > new Date(); // Only fresh data
    })
    .map((node) => ({
      id: node.id,
      name: node.name || "Unknown",
      ...deserializeMetadata(node.metadata || "{}"),
    })) as Array<ToolMetadataNode & { name: string; id: string }>;
}

/**
 * Query helper: Get codebase file by path
 */
export async function getCodebaseFile(
  api: AgentAPI,
  path: string
): Promise<CodebaseFileMetadata | null> {
  if (!api.ontology) return null;
  
  const nodeId = `file.${path.replace(/\//g, ".")}`;
  const node = await api.ontology.lookup(nodeId);
  
  if (!node?.metadata) return null;
  
  const metadata = deserializeMetadata(node.metadata);
  
  // Check if data is fresh
  const expiresAt = new Date(metadata.expires_at as string);
  if (expiresAt < new Date()) {
    console.warn(`[ontology] Codebase file data for ${path} has expired`);
  }
  
  return metadata as CodebaseFileMetadata;
}

/**
 * Query helper: Get all files in a domain
 */
export async function getCodebaseFiles(
  api: AgentAPI,
  limit: number = 100
): Promise<Array<CodebaseFileMetadata & { path: string; id: string }>> {
  if (!api.ontology) return [];
  
  const results = await api.ontology.search({
    type: "codebase_file",
    domain: "codebase",
    limit,
  });
  
  return results
    .filter((node) => {
      if (!node.metadata) return false;
      const metadata = deserializeMetadata(node.metadata);
      const expiresAt = new Date(metadata.expires_at as string);
      return expiresAt > new Date(); // Only fresh data
    })
    .map((node) => ({
      id: node.id,
      path: node.name || "unknown",
      ...deserializeMetadata(node.metadata || "{}"),
    })) as Array<CodebaseFileMetadata & { path: string; id: string }>;
}

/**
 * Query helper: Get files that export a specific symbol
 */
export async function getFilesByExport(
  api: AgentAPI,
  exportName: string
): Promise<Array<CodebaseFileMetadata & { path: string }>> {
  const files = await getCodebaseFiles(api);
  
  return files.filter((file) =>
    (file.exports || []).includes(exportName)
  );
}

/**
 * Query helper: Get system environment (non-sensitive only)
 */
export async function getEnvironmentInfo(
  api: AgentAPI
): Promise<Record<string, string>> {
  const systemInfo = await getSystemCapabilities(api);
  return systemInfo?.environment || {};
}

/**
 * Create relationship: Domain owns tool
 */
export async function linkToolToDomain(
  api: AgentAPI,
  toolId: string,
  domain: string
): Promise<void> {
  if (!api.ontology) return;
  
  await api.ontology.setEdge({
    id: `domain-tool-${domain}-${toolId}`,
    from_id: `domain.${domain}`,
    to_id: `tool.${toolId}`,
    relation: "contains",
  });
}

/**
 * Create relationship: File imports module
 */
export async function linkFileImport(
  api: AgentAPI,
  filePath: string,
  importPath: string
): Promise<void> {
  if (!api.ontology) return;
  
  const fileId = `file.${filePath.replace(/\//g, ".")}`;
  const importId = `import.${importPath.replace(/\//g, ".")}`;
  
  await api.ontology.setEdge({
    id: `import-${fileId}-${importId}`,
    from_id: fileId,
    to_id: importId,
    relation: "imports",
  });
}

/**
 * Create relationship: File exports symbol
 */
export async function linkFileExport(
  api: AgentAPI,
  filePath: string,
  exportName: string
): Promise<void> {
  if (!api.ontology) return;
  
  const fileId = `file.${filePath.replace(/\//g, ".")}`;
  const exportId = `export.${exportName}`;
  
  await api.ontology.setEdge({
    id: `export-${fileId}-${exportId}`,
    from_id: fileId,
    to_id: exportId,
    relation: "exports",
  });
}
