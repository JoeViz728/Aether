import type { ApprovalPayload } from '@aether/shared';
import { ApprovalService } from './approval-service.js';
import type { DataStore } from '../storage/store.js';

export const AETHER_BUILD_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'aether_request_build',
      description:
        'Request user approval to build a tool, script, or extension for Aether. Use when you cannot fulfill a request with existing capabilities.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short title for the approval dialog' },
          description: { type: 'string', description: 'What will be built and why' },
          reason: { type: 'string', description: 'Why this build is needed' },
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                content: { type: 'string' },
                action: { type: 'string', enum: ['create', 'modify', 'delete'] },
              },
              required: ['path', 'content', 'action'],
            },
          },
          command: { type: 'string', description: 'Shell command to execute after approval' },
        },
        required: ['title', 'description', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'aether_register_extension',
      description: 'Register a new extension tool with Aether after user approval',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          parameters: { type: 'object' },
          handler: { type: 'string', enum: ['server', 'client'] },
          reason: { type: 'string' },
        },
        required: ['name', 'description', 'parameters', 'handler', 'reason'],
      },
    },
  },
];

export class BuildToolsHandler {
  private approvalService: ApprovalService;

  constructor(store: DataStore) {
    this.approvalService = new ApprovalService(store);
  }

  async handleToolCall(
    name: string,
    args: Record<string, unknown>,
    context: { conversationId?: string; messageId?: string },
  ): Promise<{ approvalId: string; autoApproved: boolean }> {
    let payload: ApprovalPayload;
    let type: 'build' | 'extension' = 'build';
    let title: string;
    let description: string;

    if (name === 'aether_request_build') {
      title = args.title as string;
      description = args.description as string;
      payload = {
        reason: args.reason as string,
        files: args.files as ApprovalPayload['files'],
        command: args.command as string | undefined,
      };
    } else if (name === 'aether_register_extension') {
      type = 'extension';
      title = `Register extension: ${args.name}`;
      description = args.description as string;
      payload = {
        reason: args.reason as string,
        toolDefinition: {
          name: args.name as string,
          description: args.description as string,
          parameters: args.parameters as Record<string, unknown>,
          handler: args.handler as 'server' | 'client',
        },
      };
    } else {
      throw new Error(`Unknown build tool: ${name}`);
    }

    const approval = await this.approvalService.createApproval({
      type,
      title,
      description,
      payload,
      conversationId: context.conversationId,
      messageId: context.messageId,
    });

    return {
      approvalId: approval.id,
      autoApproved: approval.status === 'approved',
    };
  }
}