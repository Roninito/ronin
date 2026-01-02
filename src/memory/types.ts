export interface Memory {
  id: string;
  key?: string;
  value: unknown;
  text?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryRow {
  id: string;
  key: string | null;
  value: string; // JSON string
  text: string | null;
  metadata: string | null; // JSON string
  created_at: number; // Unix timestamp
  updated_at: number; // Unix timestamp
}

