import { v4 as uuid } from 'uuid';
import type { CreateTaskInput, TaskRecord } from '@aether/shared';

const MAX_TASKS = 200;

export class TaskManager {
  private tasks = new Map<string, TaskRecord>();
  private abortHandlers = new Map<string, () => void>();

  create(input: CreateTaskInput, onAbort?: () => void): TaskRecord {
    const now = new Date().toISOString();
    const task: TaskRecord = {
      id: input.id ?? uuid(),
      category: input.category,
      title: input.title,
      detail: input.detail,
      status: 'running',
      progress: input.progress,
      conversationId: input.conversationId,
      messageId: input.messageId,
      cancellable: input.cancellable ?? Boolean(onAbort),
      createdAt: now,
      updatedAt: now,
      log: [],
    };

    this.tasks.set(task.id, task);
    if (onAbort) this.abortHandlers.set(task.id, onAbort);
    this.prune();
    return task;
  }

  update(id: string, partial: Partial<Pick<TaskRecord, 'status' | 'detail' | 'progress' | 'error'>> & { logLine?: string }): TaskRecord | null {
    const task = this.tasks.get(id);
    if (!task) return null;

    if (partial.logLine) {
      task.log = [...(task.log ?? []), `${new Date().toISOString()} ${partial.logLine}`];
    }

    Object.assign(task, {
      detail: partial.detail ?? task.detail,
      progress: partial.progress ?? task.progress,
      error: partial.error ?? task.error,
      status: partial.status ?? task.status,
      updatedAt: new Date().toISOString(),
      completedAt: partial.status && partial.status !== 'running' && partial.status !== 'pending'
        ? new Date().toISOString()
        : task.completedAt,
    });

    return task;
  }

  complete(id: string, logLine?: string): void {
    this.update(id, { status: 'completed', logLine });
    this.abortHandlers.delete(id);
  }

  fail(id: string, error: string): void {
    this.update(id, { status: 'failed', error, logLine: error });
    this.abortHandlers.delete(id);
  }

  cancel(id: string): TaskRecord | null {
    const task = this.tasks.get(id);
    if (!task) return null;

    const handler = this.abortHandlers.get(id);
    if (handler) handler();
    this.abortHandlers.delete(id);

    return this.update(id, { status: 'cancelled', logLine: 'Cancelled by user' });
  }

  list(): TaskRecord[] {
    return [...this.tasks.values()].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  get(id: string): TaskRecord | undefined {
    return this.tasks.get(id);
  }

  private prune(): void {
    if (this.tasks.size <= MAX_TASKS) return;
    const sorted = this.list();
    const toRemove = sorted.slice(MAX_TASKS);
    for (const task of toRemove) {
      this.tasks.delete(task.id);
      this.abortHandlers.delete(task.id);
    }
  }
}

export const taskManager = new TaskManager();