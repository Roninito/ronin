export interface Memory {
  id: string;
  key?: string;
  value: unknown;
  text?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationEntry {
  role: string;
  content: string;
  createdAt: Date;
}
