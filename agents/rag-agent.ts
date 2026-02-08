import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import { readdir, readFile, stat } from "fs/promises";
import { join, extname } from "path";

/**
 * RAG Agent Base Class
 * 
 * A subclassable base agent that provides RAG (Retrieval-Augmented Generation)
 * capabilities. Extend this class to create specialized RAG agents with custom
 * document ingestion, querying, and HTTP route handling.
 * 
 * @example
 * ```typescript
 * export default class WeatherRagAgent extends RagAgent {
 *   protected namespace = "weather-data";
 *   protected documentsPath = "./data/weather";
 *   static schedule = "0 0 * * *"; // Daily ingestion
 * 
 *   async execute() {
 *     const reports = await this.fetchWeatherReports();
 *     await this.ingestDocuments(reports.map(r => ({ content: r.text })));
 *   }
 * 
 *   private async fetchWeatherReports() {
 *     // Custom ingestion logic
 *   }
 * }
 * ```
 */
export class RagAgent extends BaseAgent {
  /**
   * Namespace for this RAG agent's document collection.
   * Override in subclasses to create isolated document stores.
   */
  protected namespace = "default";

  /**
   * Path to documents directory for file-based ingestion.
   * Override in subclasses to change the default documents location.
   */
  protected documentsPath = "./docs";

  /**
   * Maximum number of documents to retrieve for RAG queries.
   */
  protected maxRetrievedDocs = 3;

  /**
   * Chunk size for document splitting.
   */
  protected chunkSize = 500;

  /**
   * Chunk overlap for document splitting.
   */
  protected chunkOverlap = 50;

  /**
   * Embedding model to use for vectorization.
   * Defaults to nomic-embed-text if available.
   */
  protected embeddingModel = "nomic-embed-text";

  /**
   * Temperature for AI response generation.
   */
  protected temperature = 0.3;

  /**
   * System prompt for RAG queries.
   * Override to customize how the AI responds to queries.
   */
  protected systemPrompt = "You are a helpful assistant. Answer the user's question based ONLY on the provided context. If the context doesn't contain enough information to answer, say so clearly.";

  /**
   * Whether to register HTTP routes for this agent.
   * Set to false in subclasses if you don't want HTTP endpoints.
   */
  protected registerHttpRoutes = true;

  constructor(api: AgentAPI) {
    super(api);
    this.initialize();
  }

  /**
   * Initialize the RAG agent - sets up routes and initializes the namespace.
   */
  private async initialize(): Promise<void> {
    // Initialize the RAG namespace
    if (this.api.rag) {
      await this.api.rag.init(this.namespace, {
        embeddingModel: this.embeddingModel,
        chunkSize: this.chunkSize,
        chunkOverlap: this.chunkOverlap,
      });
      console.log(`[rag-agent] Initialized namespace "${this.namespace}"`);
    }

    // Register HTTP routes if enabled
    if (this.registerHttpRoutes) {
      this.setupRoutes();
    }
  }

  /**
   * Set up HTTP routes for the RAG agent.
   * Override to customize or add additional routes.
   */
  protected setupRoutes(): void {
    const basePath = `/api/rag/${this.namespace}`;

    // Query endpoint
    this.api.http.registerRoute(`${basePath}/query`, this.handleQuery.bind(this));

    // Ingest endpoint
    this.api.http.registerRoute(`${basePath}/ingest`, this.handleIngest.bind(this));

    // Stats endpoint
    this.api.http.registerRoute(`${basePath}/stats`, this.handleStats.bind(this));

    // Search endpoint
    this.api.http.registerRoute(`${basePath}/search`, this.handleSearch.bind(this));

    // Documents endpoint (list/delete)
    this.api.http.registerRoute(`${basePath}/documents`, this.handleDocuments.bind(this));

    console.log(`[rag-agent] Registered routes at ${basePath}/*`);
  }

  /**
   * Default execute implementation - ingests documents from documentsPath.
   * Override in subclasses for custom ingestion logic.
   */
  async execute(): Promise<void> {
    console.log(`[rag-agent] Executing ingestion for namespace "${this.namespace}"`);
    await this.ingestFromDirectory(this.documentsPath);
  }

  /**
   * Query the RAG system with a question.
   * @param question - The question to ask
   * @returns AI-generated response with sources
   */
  async query(question: string): Promise<{
    response: string;
    sources: Array<{
      documentId: string;
      chunkText: string;
      score: number;
    }>;
  }> {
    if (!this.api.rag) {
      throw new Error("RAG plugin not available");
    }

    return this.api.rag.query(this.namespace, question, {
      limit: this.maxRetrievedDocs,
      embeddingModel: this.embeddingModel,
      temperature: this.temperature,
      systemPrompt: this.systemPrompt,
    }, this.api);
  }

  /**
   * Semantic search without AI generation.
   * @param query - Search query
   * @param limit - Maximum results
   * @returns Matching document chunks
   */
  async search(query: string, limit?: number): Promise<Array<{
    documentId: string;
    chunkIndex: number;
    chunkText: string;
    score: number;
    metadata?: Record<string, unknown>;
  }>> {
    if (!this.api.rag) {
      throw new Error("RAG plugin not available");
    }

    return this.api.rag.search(
      this.namespace,
      query,
      limit || this.maxRetrievedDocs,
      { embeddingModel: this.embeddingModel }
    );
  }

  /**
   * Ingest documents into the RAG store.
   * @param documents - Array of documents with content and optional metadata
   */
  async ingestDocuments(documents: Array<{
    content: string;
    metadata?: Record<string, unknown>;
  }>): Promise<{ documentIds: string[]; chunksCreated: number }> {
    if (!this.api.rag) {
      throw new Error("RAG plugin not available");
    }

    const result = await this.api.rag.addDocuments(this.namespace, documents, {
      embeddingModel: this.embeddingModel,
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap,
    });

    console.log(`[rag-agent] Ingested ${documents.length} documents (${result.chunksCreated} chunks)`);
    return result;
  }

  /**
   * Ingest all supported files from a directory.
   * Supports .txt, .md, .json files by default.
   * @param dirPath - Directory path to ingest from
   */
  async ingestFromDirectory(dirPath: string): Promise<{ documentIds: string[]; chunksCreated: number }> {
    const supportedExtensions = [".txt", ".md", ".json", ".html"];
    const documents: Array<{ content: string; metadata?: Record<string, unknown> }> = [];

    try {
      const files = await readdir(dirPath, { withFileTypes: true });

      for (const file of files) {
        const filePath = join(dirPath, file.name);

        if (file.isDirectory()) {
          // Recursively process subdirectories
          const subResult = await this.ingestFromDirectory(filePath);
          // We'll just log, the documents are added directly
          console.log(`[rag-agent] Ingested subdirectory ${file.name}: ${subResult.chunksCreated} chunks`);
          continue;
        }

        const ext = extname(file.name).toLowerCase();
        if (!supportedExtensions.includes(ext)) {
          continue;
        }

        try {
          const content = await readFile(filePath, "utf-8");
          const fileStats = await stat(filePath);

          documents.push({
            content,
            metadata: {
              filename: file.name,
              path: filePath,
              extension: ext,
              size: fileStats.size,
              modifiedAt: fileStats.mtime.toISOString(),
            },
          });
        } catch (error) {
          console.warn(`[rag-agent] Failed to read file ${filePath}:`, error);
        }
      }

      if (documents.length === 0) {
        console.log(`[rag-agent] No supported files found in ${dirPath}`);
        return { documentIds: [], chunksCreated: 0 };
      }

      return this.ingestDocuments(documents);
    } catch (error) {
      console.warn(`[rag-agent] Failed to read directory ${dirPath}:`, error);
      return { documentIds: [], chunksCreated: 0 };
    }
  }

  /**
   * Get statistics for this RAG namespace.
   */
  async getStats(): Promise<{
    documentCount: number;
    chunkCount: number;
    dbPath: string;
  }> {
    if (!this.api.rag) {
      throw new Error("RAG plugin not available");
    }

    return this.api.rag.getStats(this.namespace);
  }

  /**
   * Clear all documents from this namespace.
   */
  async clearDocuments(): Promise<void> {
    if (!this.api.rag) {
      throw new Error("RAG plugin not available");
    }

    await this.api.rag.clearNamespace(this.namespace);
    console.log(`[rag-agent] Cleared all documents from namespace "${this.namespace}"`);
  }

  // HTTP Route Handlers

  /**
   * Handle /query endpoint
   */
  protected async handleQuery(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const body = await req.json() as { question?: string };

      if (!body.question) {
        return Response.json({ error: "Question is required" }, { status: 400 });
      }

      const result = await this.query(body.question);
      return Response.json(result);
    } catch (error) {
      console.error("[rag-agent] Query error:", error);
      return Response.json(
        { error: error instanceof Error ? error.message : "Query failed" },
        { status: 500 }
      );
    }
  }

  /**
   * Handle /ingest endpoint
   */
  protected async handleIngest(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const body = await req.json() as {
        documents?: Array<{ content: string; metadata?: Record<string, unknown> }>;
        directory?: string;
      };

      if (body.documents && body.documents.length > 0) {
        const result = await this.ingestDocuments(body.documents);
        return Response.json({
          success: true,
          ...result,
        });
      }

      if (body.directory) {
        const result = await this.ingestFromDirectory(body.directory);
        return Response.json({
          success: true,
          ...result,
        });
      }

      return Response.json(
        { error: "Either documents array or directory path is required" },
        { status: 400 }
      );
    } catch (error) {
      console.error("[rag-agent] Ingest error:", error);
      return Response.json(
        { error: error instanceof Error ? error.message : "Ingestion failed" },
        { status: 500 }
      );
    }
  }

  /**
   * Handle /stats endpoint
   */
  protected async handleStats(req: Request): Promise<Response> {
    if (req.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const stats = await this.getStats();
      return Response.json({
        namespace: this.namespace,
        ...stats,
      });
    } catch (error) {
      console.error("[rag-agent] Stats error:", error);
      return Response.json(
        { error: error instanceof Error ? error.message : "Failed to get stats" },
        { status: 500 }
      );
    }
  }

  /**
   * Handle /search endpoint
   */
  protected async handleSearch(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const body = await req.json() as { query?: string; limit?: number };

      if (!body.query) {
        return Response.json({ error: "Query is required" }, { status: 400 });
      }

      const results = await this.search(body.query, body.limit);
      return Response.json({ results });
    } catch (error) {
      console.error("[rag-agent] Search error:", error);
      return Response.json(
        { error: error instanceof Error ? error.message : "Search failed" },
        { status: 500 }
      );
    }
  }

  /**
   * Handle /documents endpoint (list and delete)
   */
  protected async handleDocuments(req: Request): Promise<Response> {
    if (!this.api.rag) {
      return Response.json({ error: "RAG plugin not available" }, { status: 500 });
    }

    if (req.method === "GET") {
      try {
        const url = new URL(req.url);
        const limit = parseInt(url.searchParams.get("limit") || "100");
        const documents = await this.api.rag.listDocuments(this.namespace, limit);
        return Response.json({ documents });
      } catch (error) {
        console.error("[rag-agent] List documents error:", error);
        return Response.json(
          { error: error instanceof Error ? error.message : "Failed to list documents" },
          { status: 500 }
        );
      }
    }

    if (req.method === "DELETE") {
      try {
        const body = await req.json() as { documentIds?: string[]; clearAll?: boolean };

        if (body.clearAll) {
          await this.clearDocuments();
          return Response.json({ success: true, message: "All documents cleared" });
        }

        if (body.documentIds && body.documentIds.length > 0) {
          const result = await this.api.rag.removeDocuments(this.namespace, body.documentIds);
          return Response.json({ success: true, ...result });
        }

        return Response.json(
          { error: "Either documentIds array or clearAll flag is required" },
          { status: 400 }
        );
      } catch (error) {
        console.error("[rag-agent] Delete documents error:", error);
        return Response.json(
          { error: error instanceof Error ? error.message : "Failed to delete documents" },
          { status: 500 }
        );
      }
    }

    return new Response("Method not allowed", { status: 405 });
  }
}

// Export as default for direct use as an agent
export default RagAgent;
