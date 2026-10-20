export type StreamEventType =
  | 'text_delta'
  | 'thinking_start'
  | 'thinking_delta'
  | 'thinking_end'
  | 'tool_call_start'
  | 'tool_call_delta'
  | 'tool_call_end'
  | 'citation'
  | 'augmentation'
  | 'model_selected'
  | 'responder_selected'
  | 'approval_required'
  | 'error'
  | 'done';

export interface AugmentationEvent {
  augmentation: import('./types.js').MessageAugmentation;
}

export interface StreamEvent {
  type: StreamEventType;
  data: unknown;
}

export interface TextDeltaEvent {
  content: string;
}

export interface ThinkingEvent {
  blockId: string;
  agentId?: string;
  agentLabel?: string;
  content?: string;
}

export interface ToolCallEvent {
  toolCallId: string;
  name: string;
  type: 'builtin' | 'function' | 'build';
  status: string;
  input?: unknown;
  output?: unknown;
}

export interface CitationEvent {
  url: string;
  title?: string;
}

export interface ModelSelectedEvent {
  model: string;
  reason: string;
  autoSelected: boolean;
}

export interface ResponderSelectedEvent {
  name: string;
  type: 'model' | 'persona';
  model?: string;
  personaId?: string;
}

export interface ApprovalRequiredEvent {
  approvalId: string;
  type: string;
  title: string;
  description: string;
}

export interface ErrorEvent {
  message: string;
  code?: string;
}