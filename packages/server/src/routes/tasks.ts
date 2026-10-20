import type { FastifyInstance } from 'fastify';
import { taskManager } from '../services/task-manager.js';

export async function registerTaskRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/tasks', async () => ({ tasks: taskManager.list() }));

  app.post<{ Params: { id: string } }>('/api/tasks/:id/cancel', async (req, reply) => {
    const task = taskManager.cancel(req.params.id);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    return { task };
  });
}