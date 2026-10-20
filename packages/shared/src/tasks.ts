export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type TaskCategory = 'chat' | 'tts' | 'stt' | 'server' | 'maintenance';

export interface TaskProgress {
  current: number;
  total: number;
  label?: string;
}

export interface TaskSubtask {
  id: string;
  title: string;
  detail?: string;
  status: TaskStatus;
  paragraphIndex?: number;
  error?: string;
}

export interface TaskRecord {
  id: string;
  category: TaskCategory;
  title: string;
  detail?: string;
  status: TaskStatus;
  progress?: TaskProgress;
  conversationId?: string;
  conversationTitle?: string;
  messageId?: string;
  subtasks?: TaskSubtask[];
  cancellable: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  log?: string[];
}

export interface CreateTaskInput {
  id?: string;
  category: TaskCategory;
  title: string;
  detail?: string;
  conversationId?: string;
  conversationTitle?: string;
  messageId?: string;
  cancellable?: boolean;
  progress?: TaskProgress;
  subtasks?: TaskSubtask[];
}

export interface CreateParentTaskInput extends CreateTaskInput {
  onGenerateSubtask?: (paragraphIndex: number) => void;
}