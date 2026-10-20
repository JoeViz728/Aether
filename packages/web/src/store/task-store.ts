import { create } from 'zustand';
import type { CreateParentTaskInput, CreateTaskInput, TaskRecord, TaskStatus, TaskSubtask } from '@aether/shared';
import { api } from '../lib/api';
import { useIntentQueueStore } from './intent-queue-store';

interface TaskStore {
  tasks: TaskRecord[];
  tasksOpen: boolean;
  abortHandlers: Map<string, () => void>;
  subtaskGenerateHandlers: Map<string, (paragraphIndex: number) => void>;
  registerTask: (
    input: CreateTaskInput & { onAbort?: () => void; status?: TaskStatus },
  ) => string;
  registerParentTask: (input: CreateParentTaskInput & { onAbort?: () => void }) => string;
  updateTask: (id: string, partial: Partial<TaskRecord>) => void;
  updateSubtask: (
    parentId: string,
    paragraphIndex: number,
    partial: Partial<Pick<TaskSubtask, 'status' | 'error'>>,
  ) => void;
  triggerSubtaskGeneration: (parentId: string, paragraphIndex: number) => void;
  completeTask: (id: string) => void;
  failTask: (id: string, error: string) => void;
  cancelTask: (id: string) => Promise<void>;
  markCancelled: (id: string, reason?: string) => void;
  syncFromServer: () => Promise<void>;
  setTasksOpen: (open: boolean) => void;
}

function upsertTask(tasks: TaskRecord[], task: TaskRecord): TaskRecord[] {
  const index = tasks.findIndex((t) => t.id === task.id);
  if (index < 0) return [task, ...tasks].slice(0, 200);
  const next = [...tasks];
  next[index] = { ...next[index], ...task };
  return next;
}

function countSubtaskProgress(subtasks: TaskSubtask[] | undefined): { current: number; total: number } | undefined {
  if (!subtasks?.length) return undefined;
  const terminal: TaskStatus[] = ['completed', 'failed', 'cancelled'];
  const current = subtasks.filter((s) => terminal.includes(s.status)).length;
  return { current, total: subtasks.length };
}

export const TERMINAL_TASK_STATUSES: TaskStatus[] = ['completed', 'failed', 'cancelled'];

const TERMINAL_STATUSES = TERMINAL_TASK_STATUSES;

const CHAT_TASK_ORPHAN_GRACE_MS = 15_000;



function withSubtaskUpdate(
  task: TaskRecord,
  paragraphIndex: number,
  partial: Partial<Pick<TaskSubtask, 'status' | 'error'>>,
): TaskRecord {
  if (!task.subtasks?.length) return task;

  const subtasks = task.subtasks.map((subtask) =>
    subtask.paragraphIndex === paragraphIndex ? { ...subtask, ...partial } : subtask,
  );
  const counts = countSubtaskProgress(subtasks);

  return {
    ...task,
    subtasks,
    progress: counts
      ? { current: counts.current, total: counts.total, label: 'paragraphs' }
      : task.progress,
    updatedAt: new Date().toISOString(),
  };
}

function isTaskActive(task: TaskRecord): boolean {
  if (TERMINAL_STATUSES.includes(task.status)) return false;
  // TTS tasks are only shown when actively running (no pending batch tasks).
  if (task.status === 'pending' && task.category === 'tts') return false;
  if (task.status === 'pending') return task.category !== 'chat';
  if (task.status === 'running') return true;
  return task.subtasks?.some((s) => s.status === 'running') ?? false;
}

function isTaskQueued(task: TaskRecord): boolean {
  if (TERMINAL_STATUSES.includes(task.status)) return false;
  if (task.category === 'tts') return false; // no pending TTS tasks
  if (task.category === 'chat' && task.status === 'pending') return true;
  return task.status === 'pending';
}





export function isActiveTask(task: TaskRecord): boolean {
  return isTaskActive(task);
}

export function isQueuedTask(task: TaskRecord): boolean {
  return isTaskQueued(task);
}

export function isOpenTask(task: TaskRecord): boolean {
  return isTaskActive(task) || isTaskQueued(task);
}

export type ConversationTaskIndicator = 'running' | 'pending';

export function getConversationTaskIndicator(
  conversationId: string,
  tasks: TaskRecord[],
  streamingConversationId: string | null,
): ConversationTaskIndicator | null {
  if (streamingConversationId === conversationId) {
    return 'running';
  }

  const convTasks = tasks.filter((task) => task.conversationId === conversationId);

  const hasRunning = convTasks.some(
    (task) =>
      !TERMINAL_STATUSES.includes(task.status) &&
      (task.status === 'running' ||
        task.subtasks?.some((subtask) => subtask.status === 'running')),
  );
  if (hasRunning) return 'running';

  const hasQueued = convTasks.some((task) => isTaskQueued(task));
  if (hasQueued) return 'pending';

  return null;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  tasksOpen: false,
  abortHandlers: new Map(),
  subtaskGenerateHandlers: new Map(),

  registerTask: (input) => {
    const id = input.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const task: TaskRecord = {
      id,
      category: input.category,
      title: input.title,
      detail: input.detail,
      status: input.status ?? 'running',
      progress: input.progress,
      conversationId: input.conversationId,
      conversationTitle: input.conversationTitle,
      messageId: input.messageId,
      subtasks: input.subtasks,
      cancellable: input.cancellable ?? Boolean(input.onAbort),
      createdAt: now,
      updatedAt: now,
      log: [],
    };

    const handlers = new Map(get().abortHandlers);
    if (input.onAbort) handlers.set(id, input.onAbort);

    set((state) => ({
      tasks: upsertTask(state.tasks, task),
      abortHandlers: handlers,
    }));

    return id;
  },

  registerParentTask: (input) => {
    const id = input.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const counts = countSubtaskProgress(input.subtasks);
    const task: TaskRecord = {
      id,
      category: input.category,
      title: input.title,
      detail: input.detail,
      status: 'running',
      progress: counts
        ? { current: counts.current, total: counts.total, label: 'paragraphs' }
        : input.progress,
      conversationId: input.conversationId,
      conversationTitle: input.conversationTitle,
      messageId: input.messageId,
      subtasks: input.subtasks,
      cancellable: input.cancellable ?? Boolean(input.onAbort),
      createdAt: now,
      updatedAt: now,
      log: [],
    };

    const abortHandlers = new Map(get().abortHandlers);
    if (input.onAbort) abortHandlers.set(id, input.onAbort);

    const subtaskGenerateHandlers = new Map(get().subtaskGenerateHandlers);
    if (input.onGenerateSubtask) subtaskGenerateHandlers.set(id, input.onGenerateSubtask);

    set((state) => ({
      tasks: upsertTask(state.tasks, task),
      abortHandlers,
      subtaskGenerateHandlers,
    }));

    return id;
  },

  updateTask: (id, partial) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? { ...task, ...partial, updatedAt: new Date().toISOString() }
          : task,
      ),
    }));
  },

  updateSubtask: (parentId, paragraphIndex, partial) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === parentId ? withSubtaskUpdate(task, paragraphIndex, partial) : task,
      ),
    }));
  },

  triggerSubtaskGeneration: (parentId, paragraphIndex) => {
    get().subtaskGenerateHandlers.get(parentId)?.(paragraphIndex);
  },

  completeTask: (id) => {
    const now = new Date().toISOString();
    const handlers = new Map(get().abortHandlers);
    handlers.delete(id);
    const subtaskGenerateHandlers = new Map(get().subtaskGenerateHandlers);
    subtaskGenerateHandlers.delete(id);
    set((state) => ({
      abortHandlers: handlers,
      subtaskGenerateHandlers,
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              status: 'completed',
              progress: undefined,
              updatedAt: now,
              completedAt: now,
            }
          : task,
      ),
    }));
  },

  failTask: (id, error) => {
    const now = new Date().toISOString();
    const handlers = new Map(get().abortHandlers);
    handlers.delete(id);
    const subtaskGenerateHandlers = new Map(get().subtaskGenerateHandlers);
    subtaskGenerateHandlers.delete(id);
    set((state) => ({
      abortHandlers: handlers,
      subtaskGenerateHandlers,
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              status: 'failed',
              progress: undefined,
              error,
              updatedAt: now,
              completedAt: now,
              log: [...(task.log ?? []), error],
            }
          : task,
      ),
    }));
  },

  markCancelled: (id, reason) => {
    const now = new Date().toISOString();
    const handlers = new Map(get().abortHandlers);
    handlers.delete(id);
    const subtaskGenerateHandlers = new Map(get().subtaskGenerateHandlers);
    subtaskGenerateHandlers.delete(id);
    const logLine = reason ?? 'Cancelled';
    set((state) => ({
      abortHandlers: handlers,
      subtaskGenerateHandlers,
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              status: 'cancelled',
              progress: undefined,
              updatedAt: now,
              completedAt: now,
              log: [...(task.log ?? []), logLine],
              subtasks: task.subtasks?.map((s) =>
                s.status === 'running' || s.status === 'pending'
                  ? { ...s, status: 'cancelled' as const }
                  : s,
              ),
            }
          : task,
      ),
    }));
  },

  cancelTask: async (id) => {
    if (useIntentQueueStore.getState().hasIntent(id)) {
      useIntentQueueStore.getState().remove(id);
      get().markCancelled(id, 'Removed from queue');
      return;
    }

    const handler = get().abortHandlers.get(id);
    if (handler) handler();

    const now = new Date().toISOString();
    const handlers = new Map(get().abortHandlers);
    handlers.delete(id);
    const subtaskGenerateHandlers = new Map(get().subtaskGenerateHandlers);
    subtaskGenerateHandlers.delete(id);

    set((state) => ({
      abortHandlers: handlers,
      subtaskGenerateHandlers,
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              status: 'cancelled',
              progress: undefined,
              updatedAt: now,
              completedAt: now,
              subtasks: task.subtasks?.map((s) =>
                s.status === 'running' || s.status === 'pending'
                  ? { ...s, status: 'cancelled' as const }
                  : s,
              ),
              log: [...(task.log ?? []), 'Cancelled by user'],
            }
          : task,
      ),
    }));

    try {
      await api.cancelTask(id);
      await get().syncFromServer();
    } catch {
      /* client-only task */
    }
  },

  syncFromServer: async () => {
    try {
      const { tasks: serverTasks } = await api.listTasks();
      const serverIds = new Set(serverTasks.map((task) => task.id));
      const now = Date.now();

      set((state) => {
        const merged = new Map<string, TaskRecord>();
        for (const task of serverTasks) merged.set(task.id, task);

        for (const task of state.tasks) {
          if (merged.has(task.id)) continue;

          if (task.category === 'chat' && (task.status === 'running' || task.status === 'pending')) {
            const age = now - new Date(task.createdAt).getTime();
            if (!serverIds.has(task.id) && age > CHAT_TASK_ORPHAN_GRACE_MS) {
              continue;
            }
          }

          merged.set(task.id, task);
        }

        return {
          tasks: [...merged.values()].sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
          ),
        };
      });
    } catch {
      /* offline */
    }
  },

  setTasksOpen: (open) => set({ tasksOpen: open }),
}));