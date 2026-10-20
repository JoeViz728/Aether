import { useEffect, useState } from 'react';
import { X, Loader2, CheckCircle2, XCircle, Ban, ListTodo, ChevronDown, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import type { TaskRecord, TaskStatus, TaskSubtask } from '@aether/shared';
import type { ConversationSummary } from '../lib/api';
import { useAppStore } from '../store/app-store';
import { isActiveTask, isQueuedTask, useTaskStore } from '../store/task-store';

function formatTaskTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function resolveConversationTitle(task: TaskRecord, conversations: ConversationSummary[]): string | null {
  if (task.conversationTitle) return task.conversationTitle;
  if (!task.conversationId) return null;
  return conversations.find((c) => c.id === task.conversationId)?.title ?? null;
}

const STATUS_META: Record<TaskStatus, { label: string; className: string; icon: typeof Loader2 }> = {
  pending: { label: 'Pending', className: 'text-aether-muted', icon: Loader2 },
  running: { label: 'Running', className: 'text-blue-400', icon: Loader2 },
  completed: { label: 'Completed', className: 'text-green-400', icon: CheckCircle2 },
  failed: { label: 'Failed', className: 'text-red-400', icon: XCircle },
  cancelled: { label: 'Cancelled', className: 'text-amber-400', icon: Ban },
};

function StatusIcon({ status }: { status: TaskStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Icon
      className={clsx(
        'h-3.5 w-3.5 shrink-0',
        meta.className,
        status === 'running' && Icon === Loader2 && 'animate-spin',
      )}
    />
  );
}

function ProgressBar({ progress }: { progress: NonNullable<TaskRecord['progress']> }) {
  const progressPct = Math.round((progress.current / Math.max(progress.total, 1)) * 100);
  return (
    <div className="mt-2">
      <div className="mb-1 flex justify-between text-xs text-aether-muted">
        <span>
          {progress.label ?? 'Progress'} {progress.current}/{progress.total}
        </span>
        <span>{progressPct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-aether-surface-2">
        <div
          className="h-full rounded-full bg-aether-text/70 transition-all"
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}

function SubtaskRow({
  subtask,
  parentId,
  onGenerate,
}: {
  subtask: TaskSubtask;
  parentId: string;
  onGenerate: (parentId: string, paragraphIndex: number) => void;
}) {
  const meta = STATUS_META[subtask.status];
  const canGenerate = subtask.status === 'pending' && subtask.paragraphIndex !== undefined;

  return (
    <div className="flex items-start gap-2 rounded-md border border-aether-border/50 bg-aether-bg/40 px-2.5 py-2">
      <StatusIcon status={subtask.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-aether-text">{subtask.title}</p>
          <span className={clsx('text-[10px] uppercase tracking-wide', meta.className)}>{meta.label}</span>
        </div>
        {subtask.detail && (
          <p className="mt-0.5 text-[11px] text-aether-muted line-clamp-2">{subtask.detail}</p>
        )}
        {subtask.error && <p className="mt-0.5 text-[11px] text-red-400">{subtask.error}</p>}
      </div>
      {canGenerate && (
        <button
          type="button"
          onClick={() => onGenerate(parentId, subtask.paragraphIndex!)}
          className="shrink-0 rounded-md px-2 py-0.5 text-[11px] text-aether-muted hover:bg-aether-surface-2 hover:text-aether-text transition-colors"
        >
          Generate
        </button>
      )}
    </div>
  );
}

function TaskMeta({ task, chatTitle }: { task: TaskRecord; chatTitle: string | null }) {
  const ended = task.completedAt && !isActiveTask(task) && !isQueuedTask(task);

  return (
    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-aether-muted">
      {chatTitle && <span>Chat: {chatTitle}</span>}
      <span>Started {formatTaskTime(task.createdAt)}</span>
      {ended && task.completedAt && (
        <span>
          {task.status === 'cancelled' ? 'Cancelled' : task.status === 'failed' ? 'Failed' : 'Finished'}{' '}
          {formatTaskTime(task.completedAt)}
        </span>
      )}
      {!ended && task.updatedAt !== task.createdAt && (
        <span>Updated {formatTaskTime(task.updatedAt)}</span>
      )}
    </div>
  );
}

function TaskRow({
  task,
  chatTitle,
  onCancel,
  onGenerateSubtask,
}: {
  task: TaskRecord;
  chatTitle: string | null;
  onCancel: (id: string) => void;
  onGenerateSubtask: (parentId: string, paragraphIndex: number) => void;
}) {
  const isOpen = isActiveTask(task) || isQueuedTask(task);
  const [expanded, setExpanded] = useState(isOpen && Boolean(task.subtasks?.length));
  const meta = STATUS_META[task.status];
  const Icon = meta.icon;
  const showProgress = isOpen && task.progress;
  const hasSubtasks = Boolean(task.subtasks?.length);

  return (
    <div className="rounded-lg border border-aether-border bg-aether-bg/60 p-3">
      <div className="flex items-start gap-3">
        {hasSubtasks ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-0.5 shrink-0 text-aether-muted hover:text-aether-text"
            aria-label={expanded ? 'Collapse subtasks' : 'Expand subtasks'}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <Icon
            className={clsx(
              'mt-0.5 h-4 w-4 shrink-0',
              meta.className,
              task.status === 'running' && Icon === Loader2 && 'animate-spin',
            )}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-aether-text">{task.title}</p>
            <span className={clsx('text-xs uppercase tracking-wide', meta.className)}>{meta.label}</span>
          </div>
          {task.detail && <p className="mt-0.5 text-xs text-aether-muted">{task.detail}</p>}
          <TaskMeta task={task} chatTitle={chatTitle} />
          {showProgress && <ProgressBar progress={task.progress!} />}
          {task.error && <p className="mt-1 text-xs text-red-400">{task.error}</p>}
          {task.status === 'cancelled' && task.log && task.log.length > 0 && (
            <p className="mt-1 text-xs text-amber-400/90">{task.log[task.log.length - 1]}</p>
          )}
          {task.log && task.log.length > 0 && (
            <div className="mt-2 max-h-24 overflow-y-auto rounded border border-aether-border/60 bg-aether-surface/40 p-2">
              {task.log.slice(-6).map((line, i) => (
                <p key={i} className="font-mono text-[11px] text-aether-muted leading-relaxed">{line}</p>
              ))}
            </div>
          )}
          {hasSubtasks && expanded && (
            <div className="mt-2 space-y-1.5">
              {task.subtasks!.map((subtask) => (
                <SubtaskRow
                  key={subtask.id}
                  subtask={subtask}
                  parentId={task.id}
                  onGenerate={onGenerateSubtask}
                />
              ))}
            </div>
          )}
        </div>
        {task.cancellable && isOpen && (
          <button
            type="button"
            onClick={() => onCancel(task.id)}
            className="shrink-0 rounded-lg px-2.5 py-1 text-xs text-aether-muted hover:bg-aether-surface-2 hover:text-aether-text transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

export function TasksModal() {
  const conversations = useAppStore((s) => s.conversations);
  const {
    tasksOpen,
    tasks,
    setTasksOpen,
    syncFromServer,
    cancelTask,
    triggerSubtaskGeneration,
  } = useTaskStore();

  useEffect(() => {
    if (!tasksOpen) return;
    void syncFromServer();
  }, [tasksOpen, syncFromServer]);

  if (!tasksOpen) return null;

  const active = tasks.filter(isActiveTask);
  const queued = tasks.filter(isQueuedTask);
  const finished = tasks.filter((t) => !isActiveTask(t) && !isQueuedTask(t));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-aether-overlay" onClick={() => setTasksOpen(false)} />
      <div className="relative flex w-full max-w-2xl max-h-[85vh] flex-col rounded-2xl border border-aether-border bg-aether-surface shadow-2xl animate-fade-in">
        <div className="flex items-center justify-between border-b border-aether-border px-5 py-4">
          <div className="flex items-center gap-2">
            <ListTodo className="h-5 w-5 text-aether-muted" />
            <h2 className="text-lg font-semibold">Tasks</h2>
          </div>
          <button
            type="button"
            onClick={() => setTasksOpen(false)}
            className="rounded-lg p-1.5 text-aether-muted hover:text-aether-text"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <section>
            <h3 className="mb-3 text-sm font-medium text-aether-muted">Active</h3>
            {active.length === 0 ? (
              <p className="text-sm text-aether-muted">No active tasks.</p>
            ) : (
              <div className="space-y-2">
                {active.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    chatTitle={resolveConversationTitle(task, conversations)}
                    onCancel={(id) => void cancelTask(id)}
                    onGenerateSubtask={triggerSubtaskGeneration}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-3 text-sm font-medium text-aether-muted">Queued</h3>
            {queued.length === 0 ? (
              <p className="text-sm text-aether-muted">No queued tasks.</p>
            ) : (
              <div className="space-y-2">
                {queued.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    chatTitle={resolveConversationTitle(task, conversations)}
                    onCancel={(id) => void cancelTask(id)}
                    onGenerateSubtask={triggerSubtaskGeneration}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-3 text-sm font-medium text-aether-muted">History</h3>
            {finished.length === 0 ? (
              <p className="text-sm text-aether-muted">No completed tasks yet.</p>
            ) : (
              <div className="space-y-2">
                {finished.slice(0, 40).map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    chatTitle={resolveConversationTitle(task, conversations)}
                    onCancel={(id) => void cancelTask(id)}
                    onGenerateSubtask={triggerSubtaskGeneration}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}