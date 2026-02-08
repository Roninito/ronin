# RAG (Retrieval-Augmented Generation) Documentation

Ronin includes a built-in RAG system for document storage, embedding generation, and semantic search. This enables agents to answer questions using context from your own documents.

## Overview

The RAG system consists of two components:

1. **RAG Plugin** (`plugins/rag.ts`) - Core functionality accessible via `api.rag.*`
2. **RagAgent Base Class** (`agents/rag-agent.ts`) - Subclassable agent with HTTP routes

## Quick Start

### Using the RAG Plugin Directly

Any agent can use RAG functionality via the plugin API:

```typescript
import { BaseAgent } from "@ronin/agent/index.js";
import type { AgentAPI } from "@ronin/types/index.js";

export default class MyAgent extends BaseAgent {
  async execute(): Promise<void> {
    // Initialize a namespace
    await this.api.rag?.init("my-docs");

    // Add documents
    await this.api.rag?.addDocuments("my-docs", [
      { content: "Ronin is an AI agent framework built on Bun.", metadata: { source: "docs" } },
      { content: "Agents extend BaseAgent and implement execute().", metadata: { source: "docs" } },
    ]);

    // Query with RAG
    const result = await this.api.rag?.query("my-docs", "What is Ronin?", {
      limit: 3,
      temperature: 0.3,
    }, this.api);

    console.log("Response:", result?.response);
    console.log("Sources:", result?.sources);
  }
}
```

### Creating a Subclassed RAG Agent

For more structured RAG workflows, extend the `RagAgent` base class:

```typescript
import { RagAgent } from "../agents/rag-agent.js";
import type { AgentAPI } from "@ronin/types/index.js";

export default class WeatherRagAgent extends RagAgent {
  // Configure the RAG namespace and settings
  protected namespace = "weather-data";
  protected documentsPath = "./data/weather";
  protected maxRetrievedDocs = 5;
  protected chunkSize = 400;

  // Schedule daily ingestion
  static schedule = "0 6 * * *";

  constructor(api: AgentAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    // Custom ingestion logic
    const reports = await this.fetchWeatherReports();
    
    await this.ingestDocuments(reports.map(r => ({
      content: r.text,
      metadata: {
        date: r.date,
        location: r.location,
      },
    })));
  }

  private async fetchWeatherReports() {
    // Your custom data fetching logic
    const response = await this.api.http.get("https://api.weather.gov/alerts/active");
    const data = await response.json();
    // Process and return reports...
    return [];
  }
}
```

## RAG Plugin API Reference

### `api.rag.init(namespace, options?)`

Initialize a RAG namespace. Creates the SQLite database if it doesn't exist.

```typescript
await api.rag?.init("my-namespace", {
  embeddingModel: "nomic-embed-text", // Ollama embedding model
  chunkSize: 500,                      // Characters per chunk
  chunkOverlap: 50,                    // Overlap between chunks
});
```

### `api.rag.addDocuments(namespace, documents, options?)`

Add documents with automatic chunking and embedding generation.

```typescript
const result = await api.rag?.addDocuments("my-namespace", [
  { content: "Document text here...", metadata: { source: "web" } },
  { content: "Another document...", metadata: { source: "file" } },
], {
  embeddingModel: "nomic-embed-text",
  chunkSize: 500,
  chunkOverlap: 50,
});

console.log(`Added ${result.documentIds.length} documents with ${result.chunksCreated} chunks`);
```

### `api.rag.query(namespace, query, options?, api?)`

Query the RAG system - retrieves relevant context and generates an AI response.

```typescript
const result = await api.rag?.query("my-namespace", "What is the weather today?", {
  limit: 3,                    // Number of chunks to retrieve
  embeddingModel: "nomic-embed-text",
  temperature: 0.3,            // AI response temperature
  systemPrompt: "You are a helpful weather assistant...",
}, this.api);

console.log(result.response);    // AI-generated answer
console.log(result.sources);     // Retrieved context chunks
```

### `api.rag.search(namespace, query, limit?, options?)`

Semantic search without AI generation - returns matching document chunks.

```typescript
const results = await api.rag?.search("my-namespace", "weather forecast", 5);

for (const result of results) {
  console.log(`Score: ${result.score.toFixed(3)}`);
  console.log(`Text: ${result.chunkText}`);
  console.log(`Document: ${result.documentId}`);
}
```

### `api.rag.removeDocuments(namespace, documentIds)`

Remove specific documents by ID.

```typescript
await api.rag?.removeDocuments("my-namespace", ["doc-id-1", "doc-id-2"]);
```

### `api.rag.listDocuments(namespace, limit?)`

List documents in a namespace.

```typescript
const docs = await api.rag?.listDocuments("my-namespace", 100);

for (const doc of docs) {
  console.log(`${doc.id}: ${doc.content.substring(0, 50)}...`);
  console.log(`  Chunks: ${doc.chunkCount}`);
  console.log(`  Metadata: ${JSON.stringify(doc.metadata)}`);
}
```

### `api.rag.getStats(namespace)`

Get statistics for a namespace.

```typescript
const stats = await api.rag?.getStats("my-namespace");

console.log(`Documents: ${stats.documentCount}`);
console.log(`Chunks: ${stats.chunkCount}`);
console.log(`Database: ${stats.dbPath}`);
```

### `api.rag.clearNamespace(namespace)`

Remove all documents from a namespace.

```typescript
await api.rag?.clearNamespace("my-namespace");
```

## RagAgent Base Class Reference

### Protected Properties

Override these in your subclass to customize behavior:

| Property | Default | Description |
|----------|---------|-------------|
| `namespace` | `"default"` | Namespace for document collection |
| `documentsPath` | `"./docs"` | Directory for file-based ingestion |
| `maxRetrievedDocs` | `3` | Max documents for RAG queries |
| `chunkSize` | `500` | Characters per chunk |
| `chunkOverlap` | `50` | Overlap between chunks |
| `embeddingModel` | `"nomic-embed-text"` | Ollama embedding model |
| `temperature` | `0.3` | AI response temperature |
| `systemPrompt` | `"You are a helpful..."` | System prompt for queries |
| `registerHttpRoutes` | `true` | Whether to register HTTP endpoints |

### Methods

| Method | Description |
|--------|-------------|
| `query(question)` | Query RAG with AI response generation |
| `search(query, limit?)` | Semantic search without AI generation |
| `ingestDocuments(documents)` | Add documents to the store |
| `ingestFromDirectory(path)` | Ingest all files from a directory |
| `getStats()` | Get namespace statistics |
| `clearDocuments()` | Clear all documents from namespace |

### HTTP Endpoints

When `registerHttpRoutes` is `true`, the agent registers these endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rag/{namespace}/query` | POST | Query with RAG |
| `/api/rag/{namespace}/search` | POST | Semantic search |
| `/api/rag/{namespace}/ingest` | POST | Ingest documents |
| `/api/rag/{namespace}/stats` | GET | Get statistics |
| `/api/rag/{namespace}/documents` | GET | List documents |
| `/api/rag/{namespace}/documents` | DELETE | Remove documents |

#### Query Endpoint

```bash
curl -X POST http://localhost:3000/api/rag/my-namespace/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What is Ronin?"}'
```

#### Ingest Endpoint

```bash
# Ingest documents directly
curl -X POST http://localhost:3000/api/rag/my-namespace/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "documents": [
      {"content": "Document content...", "metadata": {"source": "api"}}
    ]
  }'

# Ingest from directory
curl -X POST http://localhost:3000/api/rag/my-namespace/ingest \
  -H "Content-Type: application/json" \
  -d '{"directory": "./docs"}'
```

#### Search Endpoint

```bash
curl -X POST http://localhost:3000/api/rag/my-namespace/search \
  -H "Content-Type: application/json" \
  -d '{"query": "weather forecast", "limit": 5}'
```

## Storage

RAG data is stored in SQLite databases at `~/.ronin/data/rag.{namespace}.db`.

### Schema

```sql
-- Document storage
CREATE TABLE rag_documents (
  id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,           -- JSON
  created_at INTEGER NOT NULL
);

-- Embedding vectors
CREATE TABLE rag_embeddings (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding TEXT NOT NULL,  -- JSON array of floats
  FOREIGN KEY (document_id) REFERENCES rag_documents(id)
);
```

## Requirements

### Embedding Model

The RAG system uses Ollama's embedding API. You need an embedding model pulled:

```bash
ollama pull nomic-embed-text
```

Or set a different model via environment variable:

```bash
export OLLAMA_EMBEDDING_MODEL=mxbai-embed-large
```

### Ollama Server

Ensure Ollama is running:

```bash
ollama serve
```

Or set a custom URL:

```bash
export OLLAMA_URL=http://localhost:11434
```

## Best Practices

1. **Use meaningful namespaces** - Separate document collections by topic or use case
2. **Include metadata** - Add source, date, and other context to documents
3. **Tune chunk size** - Smaller chunks (300-500) work well for precise retrieval
4. **Set appropriate limits** - Start with 3-5 retrieved documents
5. **Customize system prompts** - Guide the AI to respond appropriately for your use case

## Example: News RAG Agent

```typescript
import { RagAgent } from "../agents/rag-agent.js";

export default class NewsRagAgent extends RagAgent {
  protected namespace = "news";
  protected maxRetrievedDocs = 5;

  // Run every hour
  static schedule = "0 * * * *";

  protected systemPrompt = `You are a news analyst. Answer questions about recent news 
based ONLY on the provided context. Always cite your sources and mention dates.`;

  async execute(): Promise<void> {
    // Scrape news and ingest
    const scraped = await this.api.scrape?.scrape_to_markdown(
      "https://news.example.com",
      { instructions: "Extract news articles" }
    );

    if (scraped?.markdown) {
      await this.ingestDocuments([{
        content: scraped.markdown,
        metadata: {
          source: "news.example.com",
          fetchedAt: new Date().toISOString(),
        },
      }]);
    }
  }
}
```

## Troubleshooting

### "RAG plugin not available"

Ensure the RAG plugin is in the `plugins/` directory and Ronin can load it.

### "Failed to generate embedding"

- Check Ollama is running: `curl http://localhost:11434/api/tags`
- Ensure embedding model is pulled: `ollama pull nomic-embed-text`

### Slow queries

- Reduce the number of documents in the namespace
- Decrease `maxRetrievedDocs`
- Consider using a faster embedding model

### Memory issues

The RAG system loads embeddings into memory for similarity search. For very large document collections, consider:
- Splitting into multiple namespaces
- Using fewer, larger documents
- Increasing chunk size to reduce total chunks
