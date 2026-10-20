/** Preview row for import selection UI (no full message bodies required). */
export interface ConversationImportPreview {
  /** Temporary id (matches pending conversation id in the import session). */
  id: string;
  title: string;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  createdAt: string;
  updatedAt: string;
  model?: string;
  /** First user message snippet */
  preview: string;
  /** Optional short transcript for expand-in-place review */
  sampleMessages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
}

export interface ConversationImportPreviewResponse {
  sessionId: string;
  source: 'xai' | 'aether' | 'unknown';
  expiresAt: string;
  skipped: number;
  warnings: string[];
  conversations: ConversationImportPreview[];
}

export interface ConversationImportCommitRequest {
  sessionId: string;
  /** Ids from the preview list. Empty = import none. */
  conversationIds: string[];
}

export interface ConversationImportCommitResponse {
  imported: number;
  skipped: number;
  warnings: string[];
  source: string;
  conversationIds: string[];
}
