import type {
  StreamEvent,
  ThinkingBlock,
  ToolCallRecord,
  Citation,
  MessageAugmentation,
} from '@aether/shared';

export interface StreamingState {
  streamingContent: string;
  streamingThinking: ThinkingBlock[];
  streamingToolCalls: ToolCallRecord[];
  streamingCitations: Citation[];
  streamingAugmentations: MessageAugmentation[];
  selectedModel: string | null;
  modelSelectionReason: string | null;
  streamingResponderName: string | null;
  streamingResponderType: 'model' | 'persona' | null;
}

export const INITIAL_STREAMING: StreamingState = {
  streamingContent: '',
  streamingThinking: [],
  streamingToolCalls: [],
  streamingCitations: [],
  streamingAugmentations: [],
  selectedModel: null,
  modelSelectionReason: null,
  streamingResponderName: null,
  streamingResponderType: null,
};

type StreamPatch = Partial<StreamingState> | ((prev: StreamingState) => Partial<StreamingState>);

export function applyStreamEvent(
  state: StreamingState,
  event: StreamEvent,
): StreamPatch | null {
  switch (event.type) {
    case 'text_delta': {
      const { content } = event.data as { content: string };
      return { streamingContent: state.streamingContent + content };
    }
    case 'model_selected': {
      const { model, reason } = event.data as { model: string; reason: string };
      return { selectedModel: model, modelSelectionReason: reason };
    }
    case 'responder_selected': {
      const { name, type } = event.data as { name: string; type: 'model' | 'persona' };
      return { streamingResponderName: name, streamingResponderType: type };
    }
    case 'thinking_start': {
      const data = event.data as {
        blockId: string;
        agentId?: string;
        agentLabel?: string;
        type?: ThinkingBlock['type'];
      };
      return {
        streamingThinking: [
          ...state.streamingThinking,
          {
            id: data.blockId,
            type: data.type,
            agentId: data.agentId,
            agentLabel: data.agentLabel,
            content: '',
            status: 'streaming' as const,
            startedAt: new Date().toISOString(),
          },
        ],
      };
    }
    case 'thinking_delta': {
      const { blockId, content } = event.data as { blockId: string; content: string };
      return {
        streamingThinking: state.streamingThinking.map((b) =>
          b.id === blockId ? { ...b, content: b.content + content } : b,
        ),
      };
    }
    case 'thinking_end': {
      const { blockId } = event.data as { blockId: string };
      return {
        streamingThinking: state.streamingThinking.map((b) =>
          b.id === blockId
            ? { ...b, status: 'complete' as const, completedAt: new Date().toISOString() }
            : b,
        ),
      };
    }
    case 'tool_call_start': {
      const data = event.data as ToolCallRecord & { toolCallId: string };
      return {
        streamingToolCalls: [
          ...state.streamingToolCalls.filter((tool) => tool.id !== data.toolCallId),
          {
            id: data.toolCallId,
            name: data.name,
            type: data.type ?? 'builtin',
            status: 'running',
            summary: data.summary,
            detail: data.detail,
            startedAt: new Date().toISOString(),
          },
        ],
      };
    }
    case 'tool_call_delta': {
      const data = event.data as Partial<ToolCallRecord> & { toolCallId: string };
      return {
        streamingToolCalls: state.streamingToolCalls.map((tool) =>
          tool.id === data.toolCallId
            ? {
                ...tool,
                ...data,
                id: tool.id,
                name: data.name ?? tool.name,
                status: (data.status as ToolCallRecord['status']) ?? tool.status,
              }
            : tool,
        ),
      };
    }
    case 'tool_call_end': {
      const data = event.data as Partial<ToolCallRecord> & { toolCallId: string };
      return {
        streamingToolCalls: state.streamingToolCalls.map((tool) =>
          tool.id === data.toolCallId
            ? {
                ...tool,
                ...data,
                id: tool.id,
                name: data.name ?? tool.name,
                status: (data.status as ToolCallRecord['status']) ?? 'complete',
                completedAt: new Date().toISOString(),
              }
            : tool,
        ),
      };
    }
    case 'citation': {
      const cite = event.data as Citation;
      return { streamingCitations: [...state.streamingCitations, cite] };
    }
    case 'augmentation': {
      const { augmentation } = event.data as { augmentation: MessageAugmentation };
      if (!augmentation?.id) return null;
      if (state.streamingAugmentations.some((a) => a.id === augmentation.id)) return null;
      return {
        streamingAugmentations: [...state.streamingAugmentations, augmentation],
      };
    }
    case 'error': {
      const { message } = event.data as { message: string };
      return { error: message } as unknown as StreamPatch;
    }
    default:
      return null;
  }
}