import type { NotesScopeDefaults, ToolScopeConfig } from './notes-graph.js';

export type MessageRole = 'user' | 'assistant' | 'system';
export type ResponderType = 'model' | 'persona';
export type ThinkingBlockType = 'routing' | 'reasoning' | 'agent' | 'tool';
export type BranchSource = 'regenerate' | 'edit';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  model?: string;
  responderName?: string;
  responderType?: ResponderType;
  personaId?: string;
  thinking?: ThinkingBlock[];
  toolCalls?: ToolCallRecord[];
  citations?: Citation[];
  attachments?: Attachment[];
  /** Hard tool visualizations the model opted into (soft citations stay prose-only). */
  augmentations?: MessageAugmentation[];
  branchCount?: number;
}

/** Stable reference from a chat message into a tool's stored state for rich rendering. */
export interface MessageAugmentation {
  id: string;
  toolId: string;
  kind: string;
  payload: Record<string, unknown>;
}

export interface ThinkingBlock {
  id: string;
  type?: ThinkingBlockType;
  agentId?: string;
  agentLabel?: string;
  content: string;
  status: 'streaming' | 'complete';
  startedAt: string;
  completedAt?: string;
}

export interface MessageBranch {
  id: string;
  label: string;
  tail: ChatMessage[];
  createdAt: string;
  source: BranchSource;
}

export interface BranchPoint {
  parentMessageId: string;
  archived: MessageBranch[];
  liveTail: ChatMessage[] | null;
  activeSlot: 'live' | string;
}

export interface ExampleDialog {
  user: string;
  assistant: string;
}

export interface CharacterCard {
  name: string;
  personality: string;
  scenario?: string;
  firstMessage?: string;
  exampleDialogs?: ExampleDialog[];
}

export interface Persona {
  id: string;
  name: string;
  personality: string;
  scenario?: string;
  firstMessage?: string;
  exampleDialogs?: ExampleDialog[];
  avatar?: string;
  model?: string;
  settings?: Partial<ConversationSettings>;
  systemPrompt?: string;
  /**
   * Default resource scope per tool id (e.g. builtin:notes-graph).
   * Overridden by conversation.settings.toolScopes when set.
   */
  toolScopes?: Record<string, ToolScopeConfig>;
  createdAt: string;
  updatedAt: string;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  type: 'builtin' | 'function' | 'build';
  status: 'pending' | 'running' | 'complete' | 'failed' | 'awaiting_approval';
  input?: unknown;
  output?: unknown;
  /** Plain-language description of what this step is doing or did */
  summary?: string;
  /** Optional extra plain-language detail (e.g. sources reviewed) */
  detail?: string;
  startedAt: string;
  completedAt?: string;
}

export interface Citation {
  url: string;
  title?: string;
  snippet?: string;
}

export interface Attachment {
  id: string;
  type: 'image' | 'file' | 'audio';
  name: string;
  mimeType: string;
  url?: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  branchPoints: BranchPoint[];
  /** @deprecated migrated to branchPoints */
  branches?: Array<{ id: string; forkMessageId: string; label: string; messages: ChatMessage[]; createdAt: string; source: BranchSource }>;
  model: string;
  activePersonaId?: string;
  /** Persona the human user is playing as in this chat */
  userPersonaId?: string;
  /** Persona ids manually added as fetchable character context for story mode */
  storyCastPersonaIds?: string[];
  createdAt: string;
  updatedAt: string;
  /**
   * When the user last opened/viewed this chat (ISO).
   * Content after this timestamp is treated as unread.
   * Missing on legacy chats until first load migration or first mark-read.
   */
  lastReadAt?: string;
  settings: ConversationSettings;
}

export interface ConversationSettings {
  autoModel: boolean;
  enableWebSearch: boolean;
  enableXSearch: boolean;
  enableCodeExecution: boolean;
  enableMultiAgent: boolean;
  dictationEnabled: boolean;
  /** Narrator-first RP: activePersonaId is the narrator; storyCastPersonaIds supplies character context */
  storyMode?: boolean;
  /**
   * Per-tool resource scope for this conversation (overrides persona defaults).
   * Keyed by tool id (e.g. builtin:notes-graph).
   */
  toolScopes?: Record<string, ToolScopeConfig>;
}

export type ChatWidth = 'comfortable' | 'wide' | 'full';

export interface AppSettings {
  apiKeyConfigured: boolean;
  defaultModel: string;
  autoModelRouting: boolean;
  alwaysApproveBuilds: boolean;
  alwaysApproveScripts: boolean;
  theme: 'dark' | 'light' | 'system';
  chatWidth: ChatWidth;
  bubbleResponses: boolean;
  bubblePrompts: boolean;
  /** Adds padding on the far side of messages (right for responses, left for prompts) */
  mirroredMessagePadding: boolean;
  /** If true, the message padding (when enabled) applies on mobile too (no md: prefix) */
  messagePaddingMobile: boolean;
  voice: VoiceSettings;
  /**
   * Default model access to Linked Notes when a chat has not set an override.
   * Bare chats default to full root access; persona / story mode isolate to chat unless overridden.
   */
  notesScopeDefaults?: NotesScopeDefaults;
  dataDir: string;
}

export interface VoiceSettings {
  ttsEnabled: boolean;
  ttsVoice: string;
  ttsPrefetchAhead: number;
  ttsMinParagraphs: number;
  sttEnabled: boolean;
  dictationOnNewChat: boolean;
  autoReadResponses: boolean;
}

export type ApprovalType = 'build' | 'script' | 'extension' | 'tool';

export interface ApprovalRequest {
  id: string;
  type: ApprovalType;
  title: string;
  description: string;
  payload: ApprovalPayload;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  createdAt: string;
  resolvedAt?: string;
  conversationId?: string;
  messageId?: string;
}

export interface ApprovalPayload {
  code?: string;
  files?: BuildFile[];
  command?: string;
  toolDefinition?: ExtensionToolDefinition;
  reason: string;
}

export interface BuildFile {
  path: string;
  content: string;
  action: 'create' | 'modify' | 'delete';
}

export interface ExtensionToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: 'server' | 'client';
  scriptPath?: string;
}

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  tools: ExtensionToolDefinition[];
  enabled: boolean;
  installedAt: string;
}

/**
 * A Tool in the Tools & Automation system.
 * These are (often model-created) capabilities that can be launched full-view
 * or augment chat messages with custom rendering (charts, graphs, boards, etc.).
 * Distinct from transient ToolCallRecord (per-message execution) and
 * ExtensionManifest (installed package manifests).
 */
export interface Tool {
  id: string;
  name: string;
  description: string;
  /** High-level purpose category, e.g. 'chart-viz', 'notes-graph', 'data-tracker', 'custom' */
  kind?: string;
  /** Who authored / owns the tool definition */
  owner?: 'model' | 'user';
  /** Static configuration for the tool (JSON-serializable) */
  config?: Record<string, unknown>;
  /** Live or persisted runtime state */
  state?: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChatCompletionRequest {
  conversationId: string;
  message: string;
  model?: string;
  personaId?: string;
  taskId?: string;
  attachments?: Attachment[];
  settings?: Partial<ConversationSettings>;
}

export interface RegenerateRequest {
  conversationId: string;
  messageId: string;
  taskId?: string;
  influencePrompt?: string;
  respondAs?: {
    type: ResponderType;
    id: string;
  };
}

export interface EditMessageRequest {
  conversationId: string;
  messageId: string;
  content: string;
  taskId?: string;
}

export interface InitiateChatRequest {
  conversationId: string;
  personaId?: string;
  model?: string;
  influencePrompt?: string;
  taskId?: string;
}

export interface InsertResponseRequest {
  conversationId: string;
  influencePrompt?: string;
  respondAs?: {
    type: ResponderType;
    id: string;
  };
  taskId?: string;
}

export interface SeedMessageRequest {
  content: string;
  personaId?: string;
}