import { v4 as uuid } from 'uuid';
import type {
  ChatMessage,
  Conversation,
  ConversationSettings,
  MessageAugmentation,
  Persona,
  StreamEvent,
  ThinkingBlock,
  ToolCallRecord,
  Citation,
  ResponderType,
} from '@aether/shared';
import {
  AETHER_NOTES_FUNCTION_NAME,
  bumpConversationActivity,
  getModelById,
  narrateNotesAction,
  parseNotesFunctionArgs,
  selectModelForPrompt,
  buildPersonaSystemPrompt,
  resolveChatSettings,
  buildStoryNarratorSystemPrompt,
  buildStoryNarratorSystemPromptWithoutPersona,
  buildUserPersonaContextBlock,
  collectStoryMatchText,
  findRelevantCastPersonas,
  formatMessagesForStoryMode,
  isUserPersonaRelevant,
} from '@aether/shared';
import type { DataStore } from '../storage/store.js';
import { getXaiClient, buildTools, listAvailableModels, type XaiToolDef } from './xai-client.js';
import { narrateOutputItem, narrateWebSearchEvent } from '../lib/stream-narration.js';
import {
  archiveCurrentTail,
  ensureBranchPoints,
  findMessageIndex,
  getParentMessageIdForFork,
} from './branching.js';
import { NotesToolHandler } from './notes-tool-handler.js';

interface PendingFunctionCall {
  callId: string;
  name: string;
  arguments: string;
  itemId: string;
}

export interface StreamContext {
  conversation: Conversation;
  promptText: string;
  forceModel?: string;
  persona?: Persona | null;
  influencePrompt?: string;
  requestSettings?: Partial<ConversationSettings>;
  syntheticUserMessage?: string;
  respondAsCastPersonaId?: string;
  skipUserMessage?: boolean;
  onEvent: (event: StreamEvent) => void;
  abortSignal?: AbortSignal;
}

export class ChatService {
  constructor(private store: DataStore) {}

  async streamChat(options: {
    conversationId: string;
    message: string;
    model?: string;
    personaId?: string;
    settings?: Partial<ConversationSettings>;
    onEvent: (event: StreamEvent) => void;
    abortSignal?: AbortSignal;
  }): Promise<ChatMessage> {
    const conversation = await this.store.getConversation(options.conversationId);
    if (!conversation) throw new Error('Conversation not found');

    const { persona, forceModel } = await this.resolveResponder(
      conversation,
      undefined,
      options.personaId,
      options.model,
    );

    const userPersona = conversation.userPersonaId
      ? await this.store.getPersona(conversation.userPersonaId)
      : null;

    const userMessage: ChatMessage = {
      id: uuid(),
      role: 'user',
      content: options.message,
      createdAt: new Date().toISOString(),
      responderName: userPersona?.name,
      responderType: userPersona ? 'persona' : undefined,
      personaId: userPersona?.id,
    };

    conversation.messages.push(userMessage);
    if (conversation.messages.filter((m) => m.role === 'user').length === 1) {
      conversation.title = options.message.slice(0, 60) + (options.message.length > 60 ? '…' : '');
    }

    return this.executeStream({
      conversation,
      promptText: options.message,
      forceModel,
      persona,
      requestSettings: options.settings,
      onEvent: options.onEvent,
      abortSignal: options.abortSignal,
      skipUserMessage: true,
    });
  }

  async initiateChat(options: {
    conversationId: string;
    personaId?: string;
    model?: string;
    influencePrompt?: string;
    onEvent: (event: StreamEvent) => void;
    abortSignal?: AbortSignal;
  }): Promise<ChatMessage> {
    const conversation = await this.store.getConversation(options.conversationId);
    if (!conversation) throw new Error('Conversation not found');
    if (conversation.messages.length > 0) throw new Error('Conversation already has messages');

    const { persona, forceModel } = await this.resolveResponder(
      conversation,
      undefined,
      options.personaId,
      options.model,
    );

    const syntheticUserMessage = options.influencePrompt?.trim()
      ?? (conversation.settings.storyMode
        ? '[Begin the roleplay scene. Open with narrator description and character dialogue as appropriate.]'
        : persona
          ? '[Begin the roleplay. Open with your character\'s greeting in voice and tone.]'
          : '[Greet the user warmly and invite them to start the conversation.]');

    return this.executeStream({
      conversation,
      promptText: syntheticUserMessage,
      forceModel,
      persona,
      syntheticUserMessage,
      onEvent: options.onEvent,
      abortSignal: options.abortSignal,
      skipUserMessage: true,
    });
  }

  async insertResponse(options: {
    conversationId: string;
    influencePrompt?: string;
    respondAs?: { type: ResponderType; id: string };
    onEvent: (event: StreamEvent) => void;
    abortSignal?: AbortSignal;
  }): Promise<ChatMessage> {
    const conversation = await this.store.getConversation(options.conversationId);
    if (!conversation) throw new Error('Conversation not found');

    const { persona, forceModel } = await this.resolveResponder(
      conversation,
      options.respondAs,
    );

    const lastUser = [...conversation.messages].reverse().find((m) => m.role === 'user');
    const promptText = lastUser?.content
      ?? options.influencePrompt?.trim()
      ?? '[Continue the conversation naturally with the next assistant response.]';

    const syntheticUserMessage = !lastUser
      ? (options.influencePrompt?.trim() ?? '[Continue the conversation naturally with the next assistant response.]')
      : undefined;

    const castPersonaId = this.resolveCastFocusPersonaId(conversation, options.respondAs);

    return this.executeStream({
      conversation,
      promptText,
      forceModel,
      persona,
      influencePrompt: options.influencePrompt,
      syntheticUserMessage,
      respondAsCastPersonaId: castPersonaId,
      onEvent: options.onEvent,
      abortSignal: options.abortSignal,
      skipUserMessage: true,
    });
  }

  async seedAssistantMessage(options: {
    conversationId: string;
    content: string;
    personaId?: string;
  }): Promise<ChatMessage> {
    const conversation = await this.store.getConversation(options.conversationId);
    if (!conversation) throw new Error('Conversation not found');

    let persona: Persona | null = null;
    if (options.personaId) {
      persona = await this.store.getPersona(options.personaId);
      if (!persona) throw new Error('Persona not found');
      if (!conversation.settings.storyMode) {
        conversation.activePersonaId = options.personaId;
      }
    } else if (conversation.activePersonaId) {
      persona = await this.store.getPersona(conversation.activePersonaId);
    }

    const message: ChatMessage = {
      id: uuid(),
      role: 'assistant',
      content: options.content.trim(),
      createdAt: new Date().toISOString(),
      responderName: persona?.name,
      responderType: persona ? 'persona' : 'model',
      personaId: persona?.id,
      model: persona?.model ?? conversation.model,
    };

    conversation.messages.push(message);
    if (conversation.messages.length === 1) {
      conversation.title = persona?.name ?? conversation.title;
    }
    bumpConversationActivity(conversation);
    ensureBranchPoints(conversation);
    await this.store.saveConversation(conversation);
    return message;
  }

  async regenerate(options: {
    conversationId: string;
    messageId: string;
    influencePrompt?: string;
    respondAs?: { type: ResponderType; id: string };
    onEvent: (event: StreamEvent) => void;
    abortSignal?: AbortSignal;
  }): Promise<ChatMessage> {
    const conversation = await this.store.getConversation(options.conversationId);
    if (!conversation) throw new Error('Conversation not found');

    const index = findMessageIndex(conversation, options.messageId);
    if (index < 0) throw new Error('Message not found');

    const target = conversation.messages[index];
    if (target.role !== 'assistant') throw new Error('Can only regenerate assistant messages');

    const parentMessageId = getParentMessageIdForFork(conversation, options.messageId, 'before');
    archiveCurrentTail(conversation, parentMessageId, 'regenerate', 'Before regenerate');

    const { persona, forceModel } = await this.resolveResponder(
      conversation,
      options.respondAs,
    );

    const lastUser = [...conversation.messages].reverse().find((m) => m.role === 'user');
    const promptText = lastUser?.content ?? '';

    const castPersonaId = this.resolveCastFocusPersonaId(conversation, options.respondAs);

    return this.executeStream({
      conversation,
      promptText,
      forceModel,
      persona,
      influencePrompt: options.influencePrompt,
      respondAsCastPersonaId: castPersonaId,
      onEvent: options.onEvent,
      abortSignal: options.abortSignal,
      skipUserMessage: true,
    });
  }

  async editMessage(options: {
    conversationId: string;
    messageId: string;
    content: string;
    onEvent: (event: StreamEvent) => void;
    abortSignal?: AbortSignal;
  }): Promise<ChatMessage | null> {
    const conversation = await this.store.getConversation(options.conversationId);
    if (!conversation) throw new Error('Conversation not found');

    const index = findMessageIndex(conversation, options.messageId);
    if (index < 0) throw new Error('Message not found');

    const parentMessageId = getParentMessageIdForFork(conversation, options.messageId, 'before');
    const target = conversation.messages[index];
    const role = target.role;
    archiveCurrentTail(conversation, parentMessageId, 'edit', 'Before edit');

    const edited: ChatMessage = {
      ...target,
      content: options.content.trim(),
      createdAt: new Date().toISOString(),
    };

    if (role === 'user' && conversation.userPersonaId) {
      const userPersona = await this.store.getPersona(conversation.userPersonaId);
      if (userPersona) {
        edited.responderName = userPersona.name;
        edited.responderType = 'persona';
        edited.personaId = userPersona.id;
      }
    }

    conversation.messages.push(edited);

    if (role === 'user') {
      return this.executeStream({
        conversation,
        promptText: edited.content,
        onEvent: options.onEvent,
        abortSignal: options.abortSignal,
        skipUserMessage: true,
      });
    }

    bumpConversationActivity(conversation);
    ensureBranchPoints(conversation);
    await this.store.saveConversation(conversation);
    options.onEvent({ type: 'done', data: { messageId: edited.id } });
    return edited;
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new Error('Cancelled');
  }

  private async resolveResponder(
    conversation: Conversation,
    respondAs?: { type: ResponderType; id: string },
    explicitPersonaId?: string,
    explicitModel?: string,
  ): Promise<{ persona: Persona | null; forceModel?: string }> {
    const storyMode = Boolean(conversation.settings.storyMode);

    const loadNarrator = async (): Promise<Persona | null> => (
      conversation.activePersonaId
        ? await this.store.getPersona(conversation.activePersonaId)
        : null
    );

    if (storyMode && respondAs?.type === 'persona') {
      const narrator = await loadNarrator();
      return { persona: narrator, forceModel: explicitModel ?? narrator?.model };
    }

    if (respondAs?.type === 'persona') {
      const persona = await this.store.getPersona(respondAs.id);
      conversation.activePersonaId = respondAs.id;
      return { persona, forceModel: explicitModel ?? persona?.model };
    }

    if (respondAs?.type === 'model') {
      if (storyMode) {
        const narrator = await loadNarrator();
        return { persona: narrator, forceModel: explicitModel ?? respondAs.id };
      }
      conversation.activePersonaId = undefined;
      return { persona: null, forceModel: explicitModel ?? respondAs.id };
    }

    if (explicitPersonaId) {
      const persona = await this.store.getPersona(explicitPersonaId);
      conversation.activePersonaId = explicitPersonaId;
      return { persona, forceModel: explicitModel ?? persona?.model };
    }

    const persona = await loadNarrator();
    return { persona, forceModel: explicitModel ?? persona?.model };
  }

  private resolveCastFocusPersonaId(
    conversation: Conversation,
    respondAs?: { type: ResponderType; id: string },
  ): string | undefined {
    if (!conversation.settings.storyMode || respondAs?.type !== 'persona') return undefined;
    const castIds = conversation.storyCastPersonaIds ?? [];
    return castIds.includes(respondAs.id) ? respondAs.id : undefined;
  }

  private async loadStoryCast(personaIds: string[]): Promise<Persona[]> {
    const personas = await Promise.all(
      personaIds.map((id) => this.store.getPersona(id)),
    );
    return personas.filter((persona): persona is Persona => Boolean(persona));
  }

  private async executeStream(ctx: StreamContext): Promise<ChatMessage> {
    const { conversation, promptText, onEvent } = ctx;
    this.throwIfAborted(ctx.abortSignal);
    const client = getXaiClient();

    let persona = ctx.persona ?? null;
    if (!persona && conversation.activePersonaId) {
      persona = await this.store.getPersona(conversation.activePersonaId);
    }
    const effectiveSettings = resolveChatSettings(
      conversation.settings,
      persona,
      ctx.requestSettings,
    );

    let selectedModel: string;
    if (ctx.forceModel) {
      selectedModel = ctx.forceModel;
    } else if (effectiveSettings.autoModel) {
      // Fetch live model list so we can route to a model whose *intended purpose*
      // matches the prompt (build vs fast vs general reasoning etc).
      let available: string[] = [];
      try {
        available = await listAvailableModels();
      } catch {
        /* fall back to static logic inside selectModelForPrompt */
      }

      selectedModel = selectModelForPrompt(promptText, {
        enableMultiAgent: effectiveSettings.enableMultiAgent,
        availableModels: available,
      });
    } else {
      selectedModel = conversation.model;
    }

    const modelDef = getModelById(selectedModel);
    const storyMode = Boolean(conversation.settings.storyMode);

    const responderName = storyMode
      ? (persona?.name ? `${persona.name} (narrator)` : 'Narrator')
      : (persona?.name ?? modelDef?.label ?? selectedModel);
    const responderType: ResponderType = storyMode || persona ? 'persona' : 'model';
    const storyCast = storyMode
      ? await this.loadStoryCast(conversation.storyCastPersonaIds ?? [])
      : [];

    const matchText = collectStoryMatchText(promptText, ctx.influencePrompt);
    let relevantCast = storyMode
      ? findRelevantCastPersonas(matchText, storyCast)
      : [];

    if (storyMode && ctx.respondAsCastPersonaId) {
      const forced = storyCast.find((castPersona) => castPersona.id === ctx.respondAsCastPersonaId);
      if (forced && !relevantCast.some((castPersona) => castPersona.id === forced.id)) {
        relevantCast = [...relevantCast, forced];
      }
    }

    const userPersona = conversation.userPersonaId
      ? await this.store.getPersona(conversation.userPersonaId)
      : null;
    const userPersonaRelevant = userPersona
      ? isUserPersonaRelevant(matchText, userPersona)
      : false;

    const routingBlock = this.createRoutingBlock(selectedModel, modelDef?.label, promptText, {
      autoModel: effectiveSettings.autoModel,
      persona,
      influencePrompt: ctx.influencePrompt,
      storyMode,
      storyCast,
      relevantCast,
      userPersona,
      userPersonaRelevant,
    });

    onEvent({
      type: 'model_selected',
      data: { model: selectedModel, reason: routingBlock.content, autoSelected: conversation.settings.autoModel },
    });

    onEvent({
      type: 'responder_selected',
      data: { name: responderName, type: responderType, model: selectedModel, personaId: persona?.id },
    });

    onEvent({
      type: 'thinking_start',
      data: { blockId: routingBlock.id, agentLabel: 'Model routing', type: 'routing' },
    });
    onEvent({
      type: 'thinking_delta',
      data: { blockId: routingBlock.id, content: routingBlock.content },
    });
    onEvent({
      type: 'thinking_end',
      data: { blockId: routingBlock.id },
    });

    const assistantMessage: ChatMessage = {
      id: uuid(),
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
      model: selectedModel,
      responderName,
      responderType,
      personaId: persona?.id,
      thinking: [routingBlock],
      toolCalls: [],
      citations: [],
    };

    let systemContent: string;
    if (storyMode && persona) {
      systemContent = buildStoryNarratorSystemPrompt(
        persona,
        relevantCast,
        userPersona,
        userPersonaRelevant,
      );
    } else if (storyMode) {
      systemContent = buildStoryNarratorSystemPromptWithoutPersona(
        relevantCast,
        userPersona,
        userPersonaRelevant,
      );
    } else if (persona) {
      systemContent = buildPersonaSystemPrompt(persona);
    } else {
      systemContent = 'You are Grok, a helpful and maximally truthful AI built by xAI, running in Aether — a self-hosted Grok experience.';
    }

    if (!storyMode && userPersona && userPersonaRelevant) {
      systemContent += `\n\n## User character context\n${buildUserPersonaContextBlock(userPersona)}`;
    }

    const notesHandler = new NotesToolHandler(this.store);
    const notesScope = await notesHandler.resolveScope(conversation.id, persona?.id);
    const notesEnabled = notesScope.access !== 'none';
    if (notesEnabled) {
      // Live vault snapshot + proactive guidance so the model does not need
      // the user to name scopes or say "search the notes".
      systemContent += `\n\n${await notesHandler.buildSystemSection(notesScope, conversation.id)}`;
    }

    const inputMessages = storyMode
      ? formatMessagesForStoryMode(conversation.messages)
      : conversation.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    if (ctx.syntheticUserMessage) {
      inputMessages.push({ role: 'user', content: ctx.syntheticUserMessage });
    }

    if (ctx.influencePrompt?.trim()) {
      const lastUserIdx = inputMessages.map((m) => m.role).lastIndexOf('user');
      if (lastUserIdx >= 0) {
        inputMessages[lastUserIdx] = {
          ...inputMessages[lastUserIdx],
          content: `${inputMessages[lastUserIdx].content}\n\n[Response guidance]: ${ctx.influencePrompt.trim()}`,
        };
      }
    }

    const functionTools = notesEnabled ? [notesHandler.functionTool()] : [];
    const tools: XaiToolDef[] = buildTools(effectiveSettings, functionTools);
    const isMultiAgent = selectedModel.includes('multi-agent');
    const isReasoning = selectedModel.includes('reasoning') || isMultiAgent;

    let thinkingBlocks: ThinkingBlock[] = [routingBlock];
    let currentThinkingId: string | null = null;
    let toolCalls: ToolCallRecord[] = [];
    let citations: Citation[] = [];
    let augmentations: MessageAugmentation[] = [];

    try {
      const useResponsesApi = selectedModel === 'grok-build-0.1' || tools.length > 0;

      if (useResponsesApi) {
        const maxRounds = 8;
        let round = 0;
        let previousResponseId: string | undefined;
        let nextInput: unknown = [
          { role: 'system', content: systemContent },
          ...inputMessages,
        ];

        while (round < maxRounds) {
          round += 1;
          this.throwIfAborted(ctx.abortSignal);

          const pendingCalls: PendingFunctionCall[] = [];
          let responseId: string | undefined;

          const stream = await client.responses.create({
            model: selectedModel,
            input: nextInput as Parameters<typeof client.responses.create>[0]['input'],
            previous_response_id: previousResponseId,
            tools: tools.length > 0
              ? (tools as unknown as Parameters<typeof client.responses.create>[0]['tools'])
              : undefined,
            include: tools.length > 0
              ? (['web_search_call.action.sources'] as unknown as NonNullable<
                Parameters<typeof client.responses.create>[0]['include']
              >)
              : undefined,
            stream: true,
          });

          const eventCtx = {
            assistantMessage,
            onEvent,
            thinkingBlocks,
            toolCalls,
            citations,
            isMultiAgent,
            pendingFunctionCalls: pendingCalls,
            getCurrentThinkingId: () => currentThinkingId,
            setCurrentThinkingId: (id: string | null) => { currentThinkingId = id; },
            getThinkingBlocks: () => thinkingBlocks,
            setThinkingBlocks: (blocks: ThinkingBlock[]) => { thinkingBlocks = blocks; },
            getToolCalls: () => toolCalls,
            setToolCalls: (calls: ToolCallRecord[]) => { toolCalls = calls; },
            getCitations: () => citations,
            setCitations: (c: Citation[]) => { citations = c; },
            setResponseId: (id: string) => { responseId = id; },
          };

          for await (const event of stream) {
            this.throwIfAborted(ctx.abortSignal);
            await this.processResponsesEvent(
              event as unknown as { type: string; [key: string]: unknown },
              eventCtx,
            );
          }

          if (pendingCalls.length === 0) break;

          const outputs: Array<{ type: 'function_call_output'; call_id: string; output: string }> = [];

          for (const call of pendingCalls) {
            this.throwIfAborted(ctx.abortSignal);
            const toolCallId = call.itemId || call.callId || uuid();

            if (call.name === AETHER_NOTES_FUNCTION_NAME) {
              let parsed: unknown = {};
              try {
                parsed = call.arguments ? JSON.parse(call.arguments) : {};
              } catch {
                parsed = { action: 'invalid', raw: call.arguments };
              }

              let startSummary = 'Updating linked notes…';
              try {
                startSummary = narrateNotesAction(parseNotesFunctionArgs(parsed), 'start');
              } catch {
                /* keep default */
              }

              this.upsertToolCall(eventCtx, toolCallId, {
                name: call.name,
                type: 'function',
                status: 'running',
                summary: startSummary,
                input: parsed,
              });

              const result = await notesHandler.execute(parsed, {
                conversationId: conversation.id,
                personaId: persona?.id,
              });

              this.upsertToolCall(eventCtx, toolCallId, {
                name: call.name,
                type: 'function',
                status: result.ok ? 'complete' : 'failed',
                summary: result.summary,
                detail: result.detail,
                input: parsed,
                output: result.output,
                completedAt: new Date().toISOString(),
              });

              if (result.augmentation) {
                augmentations.push(result.augmentation);
                onEvent({ type: 'augmentation', data: { augmentation: result.augmentation } });
              }

              outputs.push({
                type: 'function_call_output',
                call_id: call.callId,
                output: JSON.stringify(result.output),
              });
            } else {
              this.upsertToolCall(eventCtx, toolCallId, {
                name: call.name,
                type: 'function',
                status: 'failed',
                summary: `Unknown function: ${call.name}`,
                completedAt: new Date().toISOString(),
              });
              outputs.push({
                type: 'function_call_output',
                call_id: call.callId,
                output: JSON.stringify({ error: `Unknown function: ${call.name}` }),
              });
            }
          }

          if (!responseId) break;
          previousResponseId = responseId;
          nextInput = outputs;
        }
      } else {
        const stream = await client.chat.completions.create({
          model: selectedModel,
          messages: [
            { role: 'system', content: systemContent },
            ...inputMessages,
          ] as Parameters<typeof client.chat.completions.create>[0]['messages'],
          stream: true,
        });

        for await (const chunk of stream) {
          this.throwIfAborted(ctx.abortSignal);
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) {
            assistantMessage.content += delta.content;
            onEvent({ type: 'text_delta', data: { content: delta.content } });
          }

          if (isReasoning && delta && 'reasoning_content' in delta && delta.reasoning_content) {
            const reasoning = delta.reasoning_content as string;
            if (!currentThinkingId) {
              currentThinkingId = uuid();
              const block: ThinkingBlock = {
                id: currentThinkingId,
                type: 'reasoning',
                agentLabel: 'Thinking',
                content: '',
                status: 'streaming',
                startedAt: new Date().toISOString(),
              };
              thinkingBlocks.push(block);
              onEvent({
                type: 'thinking_start',
                data: { blockId: block.id, agentLabel: block.agentLabel, type: 'reasoning' },
              });
            }
            const block = thinkingBlocks.find((b) => b.id === currentThinkingId)!;
            block.content += reasoning;
            onEvent({ type: 'thinking_delta', data: { blockId: block.id, content: reasoning } });
          }
        }

        if (currentThinkingId) {
          const block = thinkingBlocks.find((b) => b.id === currentThinkingId);
          if (block) {
            block.status = 'complete';
            block.completedAt = new Date().toISOString();
            onEvent({ type: 'thinking_end', data: { blockId: block.id } });
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      onEvent({ type: 'error', data: { message } });
      throw err;
    }

    assistantMessage.thinking = thinkingBlocks;
    assistantMessage.toolCalls = toolCalls;
    assistantMessage.citations = citations;
    if (augmentations.length > 0) {
      assistantMessage.augmentations = augmentations;
    }
    conversation.messages.push(assistantMessage);
    conversation.model = selectedModel;
    bumpConversationActivity(conversation);
    ensureBranchPoints(conversation);
    await this.store.saveConversation(conversation);

    onEvent({ type: 'done', data: { messageId: assistantMessage.id } });
    return assistantMessage;
  }

  private createRoutingBlock(
    modelId: string,
    modelLabel: string | undefined,
    prompt: string,
    opts: {
      autoModel: boolean;
      persona: Persona | null;
      influencePrompt?: string;
      storyMode?: boolean;
      storyCast?: Persona[];
      relevantCast?: Persona[];
      userPersona?: Persona | null;
      userPersonaRelevant?: boolean;
    },
  ): ThinkingBlock {
    const lines: string[] = [];
    const label = modelLabel ?? modelId;

    if (opts.storyMode) {
      lines.push('Story mode: narrator-first roleplay.');
      if (opts.persona) {
        lines.push(`Narrator persona: "${opts.persona.name}" using model ${label}.`);
      } else {
        lines.push(`Narrator: default voice using model ${label}.`);
      }
      if (opts.storyCast && opts.storyCast.length > 0) {
        lines.push(`Scene cast (${opts.storyCast.length}): ${opts.storyCast.map((p) => p.name).join(', ')}.`);
      } else {
        lines.push('Scene cast: none added yet.');
      }
      if (opts.relevantCast && opts.relevantCast.length > 0) {
        lines.push(`Injected character context: ${opts.relevantCast.map((p) => p.name).join(', ')}.`);
      } else {
        lines.push('No cast personas named in the user\'s latest message.');
      }
      if (opts.userPersona) {
        lines.push(`User plays as: "${opts.userPersona.name}".`);
        if (opts.userPersonaRelevant) {
          lines.push(`Injected user character context for "${opts.userPersona.name}".`);
        }
      }
    } else if (opts.persona) {
      lines.push(`Responded as persona "${opts.persona.name}" using model ${label}.`);
      if (opts.persona.model) lines.push(`Persona preferred model: ${opts.persona.model}`);
    } else {
      lines.push(`Selected model: ${label} (${modelId})`);
    }

    if (opts.autoModel) {
      const wordCount = prompt.split(/\s+/).length;
      lines.push(`Auto-routing analyzed the prompt (${wordCount} words) and chose a model based on its intended purpose.`);

      const modelLower = modelId.toLowerCase();
      if (modelLower.includes('build')) {
        lines.push('Detected build/coding/agentic signals — routed to a specialized model intended for code, tools, scaffolding, and development work.');
      } else if (modelLower.includes('beta') || modelLower.includes('fast')) {
        lines.push('Simple or short prompt — routed to a fast/light model intended for quick responses.');
      } else if (wordCount > 70 || /analyze|complex|step by step|architecture|compare|evaluate/i.test(prompt)) {
        lines.push('Complex or long prompt — routed to a capable general model suited for reasoning and detailed work.');
      } else if (/research|latest|news|current/i.test(prompt)) {
        lines.push('Research-oriented prompt — using a solid general model (with tools enabled where appropriate).');
      } else {
        lines.push('Routed to a balanced general-purpose model appropriate for normal conversation.');
      }
    } else {
      lines.push('Model was explicitly selected rather than auto-routed.');
    }

    if (!opts.storyMode && opts.userPersona) {
      lines.push(`User plays as: "${opts.userPersona.name}".`);
      if (opts.userPersonaRelevant) {
        lines.push(`Injected user character context for "${opts.userPersona.name}".`);
      }
    }

    if (opts.influencePrompt?.trim()) {
      lines.push(`Regeneration guidance applied: "${opts.influencePrompt.trim()}"`);
    }

    return {
      id: uuid(),
      type: 'routing',
      agentLabel: 'Model routing',
      content: lines.join('\n'),
      status: 'complete',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
  }

  private upsertToolCall(
    ctx: {
      onEvent: (event: StreamEvent) => void;
      getToolCalls: () => ToolCallRecord[];
      setToolCalls: (calls: ToolCallRecord[]) => void;
    },
    toolId: string,
    patch: Partial<ToolCallRecord> & Pick<ToolCallRecord, 'name'>,
  ): ToolCallRecord {
    const calls = ctx.getToolCalls();
    const existing = calls.find((call) => call.id === toolId);
    const now = new Date().toISOString();

    if (!existing) {
      const created: ToolCallRecord = {
        id: toolId,
        name: patch.name,
        type: patch.type ?? 'builtin',
        status: patch.status ?? 'running',
        summary: patch.summary,
        detail: patch.detail,
        input: patch.input,
        output: patch.output,
        startedAt: patch.startedAt ?? now,
        completedAt: patch.completedAt,
      };
      calls.push(created);
      ctx.setToolCalls(calls);
      ctx.onEvent({
        type: 'tool_call_start',
        data: {
          toolCallId: created.id,
          name: created.name,
          type: created.type,
          status: created.status,
          summary: created.summary,
          detail: created.detail,
        },
      });
      return created;
    }

    const updated: ToolCallRecord = {
      ...existing,
      ...patch,
      name: patch.name || existing.name,
      summary: patch.summary ?? existing.summary,
      detail: patch.detail ?? existing.detail,
    };
    const next = calls.map((call) => (call.id === toolId ? updated : call));
    ctx.setToolCalls(next);

    if (updated.status === 'complete' || updated.status === 'failed') {
      ctx.onEvent({
        type: 'tool_call_end',
        data: {
          toolCallId: updated.id,
          name: updated.name,
          type: updated.type,
          status: updated.status,
          summary: updated.summary,
          detail: updated.detail,
          output: updated.output,
        },
      });
    } else if (patch.summary && patch.summary !== existing.summary) {
      ctx.onEvent({
        type: 'tool_call_delta',
        data: {
          toolCallId: updated.id,
          name: updated.name,
          type: updated.type,
          status: updated.status,
          summary: updated.summary,
          detail: updated.detail,
        },
      });
    }

    return updated;
  }

  private async processResponsesEvent(
    event: { type: string; [key: string]: unknown },
    ctx: {
      assistantMessage: ChatMessage;
      onEvent: (event: StreamEvent) => void;
      thinkingBlocks: ThinkingBlock[];
      toolCalls: ToolCallRecord[];
      citations: Citation[];
      isMultiAgent: boolean;
      pendingFunctionCalls?: PendingFunctionCall[];
      getCurrentThinkingId: () => string | null;
      setCurrentThinkingId: (id: string | null) => void;
      getThinkingBlocks: () => ThinkingBlock[];
      setThinkingBlocks: (blocks: ThinkingBlock[]) => void;
      getToolCalls: () => ToolCallRecord[];
      setToolCalls: (calls: ToolCallRecord[]) => void;
      getCitations: () => Citation[];
      setCitations: (c: Citation[]) => void;
      setResponseId?: (id: string) => void;
    },
  ): Promise<void> {
    const type = event.type;

    const webSearchNarration = narrateWebSearchEvent(type);
    if (webSearchNarration) {
      const itemId = typeof event.item_id === 'string' ? event.item_id : uuid();
      const status = type.endsWith('.completed') ? 'complete' : 'running';
      this.upsertToolCall(ctx, itemId, {
        name: 'web_search',
        status: status as ToolCallRecord['status'],
        summary: webSearchNarration,
        completedAt: status === 'complete' ? new Date().toISOString() : undefined,
      });
      return;
    }

    if (type === 'response.output_item.added' || type === 'response.output_item.done') {
      const item = (event as { item?: Record<string, unknown> }).item;
      const itemType = typeof item?.type === 'string' ? item.type : '';

      // Client-side function calls — collect for execution after the stream round
      if (itemType === 'function_call') {
        const itemId = typeof item?.id === 'string' ? item.id : uuid();
        const callId =
          (typeof item?.call_id === 'string' && item.call_id)
          || (typeof item?.callId === 'string' && item.callId)
          || itemId;
        const name = typeof item?.name === 'string' ? item.name : 'function';
        const args =
          typeof item?.arguments === 'string'
            ? item.arguments
            : item?.arguments != null
              ? JSON.stringify(item.arguments)
              : '';

        if (type === 'response.output_item.done' && ctx.pendingFunctionCalls) {
          const existing = ctx.pendingFunctionCalls.find((c) => c.callId === callId || c.itemId === itemId);
          if (existing) {
            existing.arguments = args || existing.arguments;
            existing.name = name || existing.name;
          } else {
            ctx.pendingFunctionCalls.push({ callId, name, arguments: args, itemId });
          }
        } else if (ctx.pendingFunctionCalls && !ctx.pendingFunctionCalls.some((c) => c.callId === callId)) {
          ctx.pendingFunctionCalls.push({ callId, name, arguments: args, itemId });
        }

        // Don't mark complete yet — we execute after the round
        if (name !== AETHER_NOTES_FUNCTION_NAME) {
          this.upsertToolCall(ctx, itemId, {
            name,
            type: 'function',
            status: 'running',
            summary: `Running ${name.replace(/_/g, ' ')}…`,
          });
        }
        return;
      }

      const itemId = typeof item?.id === 'string'
        ? item.id
        : typeof event.item_id === 'string'
          ? event.item_id
          : uuid();
      const status: ToolCallRecord['status'] = type === 'response.output_item.done' ? 'complete' : 'running';
      const narration = narrateOutputItem(item, status);
      if (narration) {
        this.upsertToolCall(ctx, itemId, {
          name: narration.name,
          status,
          summary: narration.summary,
          detail: narration.detail,
          completedAt: status === 'complete' ? new Date().toISOString() : undefined,
        });
      }
      return;
    }

    if (type === 'response.function_call_arguments.delta') {
      const callId =
        (typeof event.call_id === 'string' && event.call_id)
        || (typeof event.item_id === 'string' && event.item_id)
        || '';
      const delta = typeof event.delta === 'string' ? event.delta : '';
      if (callId && ctx.pendingFunctionCalls && delta) {
        let pending = ctx.pendingFunctionCalls.find((c) => c.callId === callId || c.itemId === callId);
        if (!pending) {
          pending = { callId, name: AETHER_NOTES_FUNCTION_NAME, arguments: '', itemId: callId };
          ctx.pendingFunctionCalls.push(pending);
        }
        pending.arguments += delta;
      }
      return;
    }

    if (type === 'response.function_call_arguments.done') {
      const callId =
        (typeof event.call_id === 'string' && event.call_id)
        || (typeof event.item_id === 'string' && event.item_id)
        || '';
      const args =
        typeof event.arguments === 'string'
          ? event.arguments
          : typeof event.delta === 'string'
            ? event.delta
            : '';
      const name = typeof event.name === 'string' ? event.name : undefined;
      if (callId && ctx.pendingFunctionCalls) {
        let pending = ctx.pendingFunctionCalls.find((c) => c.callId === callId || c.itemId === callId);
        if (!pending) {
          pending = {
            callId,
            name: name ?? AETHER_NOTES_FUNCTION_NAME,
            arguments: args,
            itemId: callId,
          };
          ctx.pendingFunctionCalls.push(pending);
        } else {
          if (args) pending.arguments = args;
          if (name) pending.name = name;
        }
      }
      return;
    }

    if (type === 'response.output_text.delta') {
      const delta = (event as { delta?: string }).delta ?? '';
      ctx.assistantMessage.content += delta;
      ctx.onEvent({ type: 'text_delta', data: { content: delta } });
      return;
    }

    if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning.delta') {
      const delta = (event as { delta?: string }).delta ?? '';
      let currentId = ctx.getCurrentThinkingId();
      if (!currentId) {
        currentId = uuid();
        ctx.setCurrentThinkingId(currentId);
        const blocks = ctx.getThinkingBlocks();
        const block: ThinkingBlock = {
          id: currentId,
          type: ctx.isMultiAgent ? 'agent' : 'reasoning',
          agentId: ctx.isMultiAgent ? `agent-${blocks.filter((b) => b.type === 'agent').length + 1}` : undefined,
          agentLabel: ctx.isMultiAgent ? `Agent ${blocks.filter((b) => b.type === 'agent').length + 1}` : 'Thinking',
          content: '',
          status: 'streaming',
          startedAt: new Date().toISOString(),
        };
        blocks.push(block);
        ctx.setThinkingBlocks(blocks);
        ctx.onEvent({
          type: 'thinking_start',
          data: { blockId: block.id, agentId: block.agentId, agentLabel: block.agentLabel, type: block.type },
        });
      }
      const blocks = ctx.getThinkingBlocks();
      const block = blocks.find((b) => b.id === currentId);
      if (block) {
        block.content += delta;
        ctx.onEvent({ type: 'thinking_delta', data: { blockId: block.id, content: delta, agentId: block.agentId } });
      }
      return;
    }

    if (type === 'response.reasoning_summary_text.done' || type === 'response.reasoning.done') {
      const currentId = ctx.getCurrentThinkingId();
      if (currentId) {
        const blocks = ctx.getThinkingBlocks();
        const block = blocks.find((b) => b.id === currentId);
        if (block) {
          block.status = 'complete';
          block.completedAt = new Date().toISOString();
          ctx.onEvent({ type: 'thinking_end', data: { blockId: block.id } });
        }
        ctx.setCurrentThinkingId(null);
      }
      return;
    }

    if (type.includes('function_call') && type !== 'response.function_call_arguments.delta' && type !== 'response.function_call_arguments.done') {
      // Other function_call lifecycle events — ignore if already collected
      return;
    }

    if (type.includes('tool_call')) {
      const item = event as { item?: { id?: string; name?: string } };
      const toolId = item.item?.id ?? uuid();
      const name = item.item?.name ?? 'tool';
      this.upsertToolCall(ctx, toolId, {
        name,
        status: 'running',
        summary: `Running ${name.replace(/_/g, ' ')}.`,
      });
      return;
    }

    if (type === 'response.completed' || type === 'response.done') {
      const response = (event as {
        response?: {
          id?: string;
          citations?: Array<{ url: string; title?: string }>;
          output?: Array<Record<string, unknown>>;
        };
      }).response;

      const responseId =
        (typeof response?.id === 'string' && response.id)
        || (typeof event.id === 'string' && event.id)
        || (typeof event.response_id === 'string' && event.response_id)
        || undefined;
      if (responseId && ctx.setResponseId) ctx.setResponseId(responseId);

      // Fallback: harvest function_call items from final output if stream missed args
      if (response?.output && ctx.pendingFunctionCalls) {
        for (const item of response.output) {
          if (item?.type !== 'function_call') continue;
          const itemId = typeof item.id === 'string' ? item.id : uuid();
          const callId =
            (typeof item.call_id === 'string' && item.call_id)
            || (typeof item.callId === 'string' && item.callId)
            || itemId;
          const name = typeof item.name === 'string' ? item.name : 'function';
          const args =
            typeof item.arguments === 'string'
              ? item.arguments
              : item.arguments != null
                ? JSON.stringify(item.arguments)
                : '';
          const existing = ctx.pendingFunctionCalls.find((c) => c.callId === callId || c.itemId === itemId);
          if (existing) {
            if (args) existing.arguments = args;
            if (name) existing.name = name;
          } else {
            ctx.pendingFunctionCalls.push({ callId, name, arguments: args, itemId });
          }
        }
      }

      if (response?.citations) {
        const cites = ctx.getCitations();
        for (const c of response.citations) {
          cites.push({ url: c.url, title: c.title });
          ctx.onEvent({ type: 'citation', data: { url: c.url, title: c.title } });
        }
        ctx.setCitations(cites);
      }
    }
  }
}