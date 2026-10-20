import type { FastifyInstance } from 'fastify';
import type { ApprovalPayload, ApprovalType } from '@aether/shared';
import type { DataStore } from '../storage/store.js';
import { ApprovalService } from '../services/approval-service.js';

export async function registerApprovalRoutes(
  app: FastifyInstance,
  store: DataStore,
): Promise<void> {
  const approvalService = new ApprovalService(store);

  app.get('/api/approvals', async () => {
    const approvals = await store.listApprovals();
    return approvals.filter((a) => a.status === 'pending');
  });

  app.get<{ Params: { id: string } }>('/api/approvals/:id', async (req, reply) => {
    const approval = await store.getApproval(req.params.id);
    if (!approval) return reply.status(404).send({ error: 'Approval not found' });
    return approval;
  });

  app.post<{
    Body: {
      type: ApprovalType;
      title: string;
      description: string;
      payload: ApprovalPayload;
      conversationId?: string;
      messageId?: string;
    };
  }>('/api/approvals', async (req) => {
    return approvalService.createApproval(req.body);
  });

  app.post<{
    Params: { id: string };
    Body: { decision: 'approved' | 'denied' };
  }>('/api/approvals/:id/resolve', async (req, reply) => {
    try {
      return await approvalService.resolveApproval(req.params.id, req.body.decision);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to resolve';
      return reply.status(400).send({ error: message });
    }
  });
}