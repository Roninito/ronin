import type { Plugin } from "../src/plugins/base.js";
import type { AgentAPI } from "../src/types/api.js";
import { ensureRoninDataDir } from "../src/utils/paths.js";
import { join } from "path";
import { Database } from "bun:sqlite";

const DEFAULT_OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const DEFAULT_EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text";
const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_CHUNK_OVERLAP = 50;

// Store database instances per namespace
const databases: Map<string, Database> = new Map();

/**
 * Get or create database for a namespace
 */
function getDatabase(namespace: string): Database {
  if (databases.has(namespace)) {
    return databases.get(namespace)!;
  }

  const dataDir = ensureRoninDataDir();
  const dbPath = join(dataDir, `rag.${namespace}.db`);
  const db = new Database(dbPath);

  // Initialize schema
  db.run(`
    CREATE TABLE IF NOT EXISTS rag_documents (
      id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS rag_embeddings (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      chunk_text TEXT NOT NULL,
      embedding TEXT NOT NULL,
      FOREIGN KEY (document_id) REFERENCES rag_documents(id) ON DELETE CASCADE
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_rag_documents_namespace ON rag_documents(namespace)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_rag_embeddings_document_id ON rag_embeddings(document_id)`);

  databases.set(namespace, db);
  return db;
}

/**
 * Generate embedding for text using Ollama
 */
async function generateEmbedding(text: string, model: string = DEFAULT_EMBEDDING_MODEL): Promise<number[]> {
  const response = await fetch(`${DEFAULT_OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to generate embedding: ${response.statusText}`);
  }

  const data = await response.json() as { embedding: number[] };
  return data.embedding;
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have the same length");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Split text into chunks with overlap
 */
function chunkText(text: string, chunkSize: number = DEFAULT_CHUNK_SIZE, overlap: number = DEFAULT_CHUNK_OVERLAP): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    let chunk = text.slice(start, end);

    // Try to break at word boundary
    if (end < text.length) {
      const lastSpace = chunk.lastIndexOf(" ");
      if (lastSpace > chunkSize * 0.7) {
        chunk = chunk.slice(0, lastSpace);
      }
    }

    chunks.push(chunk.trim());
    start += chunk.length - overlap;

    // Prevent infinite loop for very small chunks
    if (start <= 0 && chunks.length > 0) {
      start = chunkSize;
    }
  }

  return chunks.filter(c => c.length > 0);
}

/**
 * RAG (Retrieval-Augmented Generation) plugin for Ronin
 * Provides document storage, embedding generation, and semantic search
 */
const ragPlugin: Plugin = {
  name: "rag",
  description: "RAG plugin for document storage, embedding, and semantic search",
  methods: {
    /**
     * Initialize a RAG namespace (creates database if needed)
     * @param namespace - Unique namespace for document collection
     * @param options - Optional configuration
     */
    init: async (
      namespace: string,
      options?: {
        embeddingModel?: string;
        chunkSize?: number;
        chunkOverlap?: number;
      }
    ): Promise<{ success: boolean; namespace: string; dbPath: string }> => {
      const db = getDatabase(namespace);
      const dataDir = ensureRoninDataDir();
      const dbPath = join(dataDir, `rag.${namespace}.db`);

      console.log(`[rag] Initialized namespace "${namespace}" at ${dbPath}`);

      return {
        success: true,
        namespace,
        dbPath,
      };
    },

    /**
     * Add documents to the RAG store
     * @param namespace - Namespace to add documents to
     * @param documents - Array of document objects with content and optional metadata
     * @param options - Optional configuration for chunking and embedding
     */
    addDocuments: async (
      namespace: string,
      documents: Array<{ content: string; metadata?: Record<string, unknown> }>,
      options?: {
        embeddingModel?: string;
        chunkSize?: number;
        chunkOverlap?: number;
      }
    ): Promise<{ documentIds: string[]; chunksCreated: number }> => {
      const db = getDatabase(namespace);
      const embeddingModel = options?.embeddingModel || DEFAULT_EMBEDDING_MODEL;
      const chunkSize = options?.chunkSize || DEFAULT_CHUNK_SIZE;
      const chunkOverlap = options?.chunkOverlap || DEFAULT_CHUNK_OVERLAP;

      const documentIds: string[] = [];
      let totalChunks = 0;

      const insertDoc = db.prepare(`
        INSERT INTO rag_documents (id, namespace, content, metadata, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      const insertEmb = db.prepare(`
        INSERT INTO rag_embeddings (id, document_id, chunk_index, chunk_text, embedding)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const doc of documents) {
        const docId = crypto.randomUUID();
        const now = Date.now();

        // Insert document
        insertDoc.run(
          docId,
          namespace,
          doc.content,
          doc.metadata ? JSON.stringify(doc.metadata) : null,
          now
        );

        // Chunk and embed
        const chunks = chunkText(doc.content, chunkSize, chunkOverlap);

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const embeddingId = crypto.randomUUID();

          try {
            const embedding = await generateEmbedding(chunk, embeddingModel);
            insertEmb.run(
              embeddingId,
              docId,
              i,
              chunk,
              JSON.stringify(embedding)
            );
            totalChunks++;
          } catch (error) {
            console.error(`[rag] Failed to generate embedding for chunk ${i} of document ${docId}:`, error);
          }
        }

        documentIds.push(docId);
        console.log(`[rag] Added document ${docId} with ${chunks.length} chunks`);
      }

      return { documentIds, chunksCreated: totalChunks };
    },

    /**
     * Semantic search - find relevant document chunks
     * @param namespace - Namespace to search in
     * @param query - Search query
     * @param limit - Maximum number of results (default: 5)
     */
    search: async (
      namespace: string,
      query: string,
      limit: number = 5,
      options?: { embeddingModel?: string }
    ): Promise<Array<{
      documentId: string;
      chunkIndex: number;
      chunkText: string;
      score: number;
      metadata?: Record<string, unknown>;
    }>> => {
      const db = getDatabase(namespace);
      const embeddingModel = options?.embeddingModel || DEFAULT_EMBEDDING_MODEL;

      // Generate query embedding
      const queryEmbedding = await generateEmbedding(query, embeddingModel);

      // Get all embeddings for this namespace
      const embeddings = db.query<{
        id: string;
        document_id: string;
        chunk_index: number;
        chunk_text: string;
        embedding: string;
      }>(`
        SELECT e.id, e.document_id, e.chunk_index, e.chunk_text, e.embedding
        FROM rag_embeddings e
        JOIN rag_documents d ON e.document_id = d.id
        WHERE d.namespace = ?
      `).all(namespace);

      // Calculate similarities
      const results: Array<{
        documentId: string;
        chunkIndex: number;
        chunkText: string;
        score: number;
      }> = [];

      for (const emb of embeddings) {
        const embVector = JSON.parse(emb.embedding) as number[];
        const score = cosineSimilarity(queryEmbedding, embVector);

        results.push({
          documentId: emb.document_id,
          chunkIndex: emb.chunk_index,
          chunkText: emb.chunk_text,
          score,
        });
      }

      // Sort by score descending and limit
      results.sort((a, b) => b.score - a.score);
      const topResults = results.slice(0, limit);

      // Fetch metadata for top results
      const docMetadataCache = new Map<string, Record<string, unknown> | null>();

      return topResults.map(r => {
        if (!docMetadataCache.has(r.documentId)) {
          const doc = db.query<{ metadata: string | null }>(
            `SELECT metadata FROM rag_documents WHERE id = ?`
          ).get(r.documentId);
          docMetadataCache.set(
            r.documentId,
            doc?.metadata ? JSON.parse(doc.metadata) : null
          );
        }

        return {
          ...r,
          metadata: docMetadataCache.get(r.documentId) || undefined,
        };
      });
    },

    /**
     * Query with RAG - retrieve relevant context and generate AI response
     * @param namespace - Namespace to query
     * @param query - User question
     * @param options - Query options
     * @param api - AgentAPI for AI completion
     */
    query: async (
      namespace: string,
      query: string,
      options?: {
        limit?: number;
        embeddingModel?: string;
        temperature?: number;
        systemPrompt?: string;
      },
      api?: AgentAPI
    ): Promise<{
      response: string;
      sources: Array<{
        documentId: string;
        chunkText: string;
        score: number;
      }>;
    }> => {
      const limit = options?.limit || 3;

      // Search for relevant chunks
      const searchResults = await ragPlugin.methods.search(
        namespace,
        query,
        limit,
        { embeddingModel: options?.embeddingModel }
      ) as Awaited<ReturnType<typeof ragPlugin.methods.search>>;

      if (searchResults.length === 0) {
        return {
          response: "I couldn't find any relevant information to answer your question.",
          sources: [],
        };
      }

      // Build context from retrieved chunks
      const context = searchResults
        .map((r, i) => `[Source ${i + 1}] ${r.chunkText}`)
        .join("\n\n");

      // Generate response using AI
      const systemPrompt = options?.systemPrompt ||
        "You are a helpful assistant. Answer the user's question based ONLY on the provided context. If the context doesn't contain enough information, say so.";

      const prompt = `${systemPrompt}

CONTEXT:
${context}

USER QUESTION: ${query}

ANSWER:`;

      let response: string;

      if (api?.ai) {
        response = await api.ai.complete(prompt, {
          temperature: options?.temperature || 0.3,
        });
      } else {
        // Fallback to direct Ollama call if no API provided
        const ollamaResponse = await fetch(`${DEFAULT_OLLAMA_URL}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: process.env.OLLAMA_MODEL || "qwen3:4b",
            prompt,
            stream: false,
            options: {
              temperature: options?.temperature || 0.3,
            },
          }),
        });

        if (!ollamaResponse.ok) {
          throw new Error(`Failed to generate response: ${ollamaResponse.statusText}`);
        }

        const data = await ollamaResponse.json() as { response: string };
        response = data.response;
      }

      return {
        response,
        sources: searchResults.map(r => ({
          documentId: r.documentId,
          chunkText: r.chunkText,
          score: r.score,
        })),
      };
    },

    /**
     * Remove documents from the store
     * @param namespace - Namespace to remove from
     * @param documentIds - Array of document IDs to remove
     */
    removeDocuments: async (
      namespace: string,
      documentIds: string[]
    ): Promise<{ removed: number }> => {
      const db = getDatabase(namespace);

      const deleteEmb = db.prepare(`DELETE FROM rag_embeddings WHERE document_id = ?`);
      const deleteDoc = db.prepare(`DELETE FROM rag_documents WHERE id = ?`);

      let removed = 0;

      for (const docId of documentIds) {
        deleteEmb.run(docId);
        const result = deleteDoc.run(docId);
        if (result.changes > 0) {
          removed++;
        }
      }

      console.log(`[rag] Removed ${removed} documents from namespace "${namespace}"`);
      return { removed };
    },

    /**
     * List documents in a namespace
     * @param namespace - Namespace to list
     * @param limit - Maximum number of documents (default: 100)
     */
    listDocuments: async (
      namespace: string,
      limit: number = 100
    ): Promise<Array<{
      id: string;
      content: string;
      metadata?: Record<string, unknown>;
      createdAt: number;
      chunkCount: number;
    }>> => {
      const db = getDatabase(namespace);

      const docs = db.query<{
        id: string;
        content: string;
        metadata: string | null;
        created_at: number;
      }>(`
        SELECT id, content, metadata, created_at
        FROM rag_documents
        WHERE namespace = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(namespace, limit);

      return docs.map(doc => {
        const chunkCount = db.query<{ count: number }>(
          `SELECT COUNT(*) as count FROM rag_embeddings WHERE document_id = ?`
        ).get(doc.id)?.count || 0;

        return {
          id: doc.id,
          content: doc.content,
          metadata: doc.metadata ? JSON.parse(doc.metadata) : undefined,
          createdAt: doc.created_at,
          chunkCount,
        };
      });
    },

    /**
     * Get statistics for a namespace
     * @param namespace - Namespace to get stats for
     */
    getStats: async (namespace: string): Promise<{
      documentCount: number;
      chunkCount: number;
      dbPath: string;
    }> => {
      const db = getDatabase(namespace);
      const dataDir = ensureRoninDataDir();

      const docCount = db.query<{ count: number }>(
        `SELECT COUNT(*) as count FROM rag_documents WHERE namespace = ?`
      ).get(namespace)?.count || 0;

      const chunkCount = db.query<{ count: number }>(`
        SELECT COUNT(*) as count FROM rag_embeddings e
        JOIN rag_documents d ON e.document_id = d.id
        WHERE d.namespace = ?
      `).get(namespace)?.count || 0;

      return {
        documentCount: docCount,
        chunkCount,
        dbPath: join(dataDir, `rag.${namespace}.db`),
      };
    },

    /**
     * Clear all documents from a namespace
     * @param namespace - Namespace to clear
     */
    clearNamespace: async (namespace: string): Promise<{ cleared: boolean }> => {
      const db = getDatabase(namespace);

      db.run(`DELETE FROM rag_embeddings WHERE document_id IN (SELECT id FROM rag_documents WHERE namespace = ?)`);
      db.run(`DELETE FROM rag_documents WHERE namespace = ?`, [namespace]);

      console.log(`[rag] Cleared all documents from namespace "${namespace}"`);
      return { cleared: true };
    },
  },
};

export default ragPlugin;
