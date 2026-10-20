import type { TaskStatus } from '@aether/shared';
import { api } from './api';
import { speakWithBrowser, stopBrowserSpeech } from './browser-speech';
import {
  clearTtsCacheForMessage,
  getTtsCache,
  makeTtsCacheKey,
  setTtsCache,
} from './tts-cache';
import { prepareTtsParagraphs, splitIntoParagraphs } from './tts-text';

export interface TtsPlaybackState {
  messageId: string;
  conversationId?: string;
  totalParagraphs: number;
  currentParagraph: number;
  isPlaying: boolean;
  isPreparing: boolean;
}

export interface SpeakMessageOptions {
  messageId: string;
  content: string;
  voiceId: string;
  conversationId?: string;
  conversationTitle?: string;
  prefetchAhead?: number;
  minParagraphs?: number;
  forceRegenerate?: boolean;
}

type ParagraphAudio = { kind: 'url'; url: string } | { kind: 'browser' };

type StateListener = (state: TtsPlaybackState | null) => void;

type TtsTaskHooks = {
  createTtsTask: (input: {
    messageId: string;
    conversationId?: string;
    conversationTitle?: string;
    paragraphIndex: number;
    paragraphText: string;
    onAbort?: () => void;
  }) => string;
  updateTtsTask: (taskId: string, status: TaskStatus, error?: string) => void;
  cancelTtsTask: (taskId: string, reason?: string) => void;
};

const noopTasks: TtsTaskHooks = {
  createTtsTask: () => '',
  updateTtsTask: () => {},
  cancelTtsTask: () => {},
};

interface GenerationJob {
  messageId: string;
  voiceId: string;
  paragraphs: string[];
  singleChunk: boolean;
  conversationId?: string;
  conversationTitle?: string;
  forceRegenerate: boolean;
  aborted: boolean;
  inFlight: number;
  playbackDismissed: boolean;
  userInitiatedGeneration: boolean;
  fetchPromises: Map<number, Promise<ParagraphAudio | null>>;
  paragraphTaskIds: Map<number, string>;
}

interface PlaybackSession {
  messageId: string;
  conversationId?: string;
  paragraphs: string[];
  currentIndex: number;
  autoAdvance: boolean;
}

export class TtsQueuePlayer {
  private audio: HTMLAudioElement | null = null;
  private state: TtsPlaybackState | null = null;
  private listener: StateListener | null = null;
  private playback: PlaybackSession | null = null;
  private generation: GenerationJob | null = null;
  private lastSpeakOptions: SpeakMessageOptions | null = null;
  private playGeneration = 0;
  private playAllSession = 0;
  private prefetchAhead = 2;
  private taskHooks: TtsTaskHooks = noopTasks;

  setTaskHooks(hooks: TtsTaskHooks): void {
    this.taskHooks = hooks;
  }

  setListener(listener: StateListener | null): void {
    this.listener = listener;
    if (listener) listener(this.state);
  }

  getState(): TtsPlaybackState | null {
    return this.state;
  }

  getActiveMessageId(): string | null {
    return this.playback?.messageId ?? null;
  }

  private emit(partial: Partial<TtsPlaybackState> | null): void {
    if (partial === null) {
      this.state = null;
    } else if (this.state) {
      this.state = { ...this.state, ...partial };
    } else {
      this.state = partial as TtsPlaybackState;
    }
    this.listener?.(this.state);
  }

  private ensurePlaybackState(): void {
    if (!this.playback) return;
    if (!this.state) {
      this.emit({
        messageId: this.playback.messageId,
        conversationId: this.playback.conversationId,
        totalParagraphs: this.playback.paragraphs.length,
        currentParagraph: this.playback.currentIndex + 1,
        isPlaying: false,
        isPreparing: false,
      });
    }
  }

  private haltAudio(): void {
    this.playGeneration++;
    this.audio?.pause();
    this.audio = null;
    stopBrowserSpeech();
  }

  private cancelGeneration(reason?: string): void {
    const job = this.generation;
    if (!job) return;
    job.aborted = true;
    for (const taskId of job.paragraphTaskIds.values()) {
      this.taskHooks.cancelTtsTask(taskId, reason);
    }
    job.paragraphTaskIds.clear();
    this.generation = null;
  }

  private handlePlaybackDismissed(): void {
    const job = this.generation;
    if (!job || job.aborted) return;

    job.playbackDismissed = true;

    if (job.userInitiatedGeneration) return;

    if (job.inFlight > 0) return;

    if (job.paragraphTaskIds.size > 0) {
      this.cancelGeneration('Playback dismissed');
    } else {
      this.generation = null;
    }
  }

  private maybeCancelAfterPlaybackDismissed(): void {
    const job = this.generation;
    if (!job || job.aborted || !job.playbackDismissed || job.userInitiatedGeneration) return;
    if (job.inFlight > 0) return;

    if (job.paragraphTaskIds.size > 0) {
      this.cancelGeneration('Playback dismissed');
    } else {
      this.generation = null;
    }
  }

  private releaseGeneration(): void {
    if (!this.generation) return;
    if (this.generation.inFlight > 0) {
      this.cancelGeneration('Superseded by new generation');
      return;
    }
    this.generation = null;
  }

  endPlayback(options?: { cancelQueuedTask?: boolean }): void {
    this.haltAudio();
    this.playback = null;
    this.emit(null);

    if (options?.cancelQueuedTask) {
      this.handlePlaybackDismissed();
    }
  }

  pause(): void {
    if (!this.playback) return;
    this.haltAudio();
    this.invalidatePlayAllSession();
    this.playback.autoAdvance = false;
    this.emit({ isPlaying: false, isPreparing: false });
  }

  async play(): Promise<void> {
    if (!this.playback) return;
    this.playback.autoAdvance = true;
    await this.playAllFrom(this.playback.currentIndex);
  }

  private invalidatePlayAllSession(): void {
    this.playAllSession++;
  }

  private async seekParagraph(delta: number): Promise<void> {
    if (!this.playback) return;

    const nextIndex = this.playback.currentIndex + delta;
    if (nextIndex < 0 || nextIndex >= this.playback.paragraphs.length) return;

    const shouldResume = this.playback.autoAdvance;
    this.haltAudio();
    this.invalidatePlayAllSession();
    this.playback.currentIndex = nextIndex;
    this.ensurePlaybackState();
    this.emit({
      currentParagraph: this.playback.currentIndex + 1,
      isPlaying: false,
      isPreparing: false,
    });

    if (shouldResume) {
      this.playback.autoAdvance = true;
      await this.playAllFrom(this.playback.currentIndex);
    }
  }

  async nextParagraph(): Promise<void> {
    await this.seekParagraph(1);
  }

  async previousParagraph(): Promise<void> {
    await this.seekParagraph(-1);
  }

  async regenerate(): Promise<void> {
    if (!this.lastSpeakOptions) return;
    await this.speak({ ...this.lastSpeakOptions, forceRegenerate: true });
  }

  generateParagraph(index: number, options?: { manual?: boolean }): void {
    if (!this.generation || index < 0 || index >= this.generation.paragraphs.length) return;
    if (options?.manual) {
      this.generation.userInitiatedGeneration = true;
    }
    void this.ensureParagraph(index);
  }

  async speak(options: SpeakMessageOptions): Promise<void> {
    this.lastSpeakOptions = options;
    this.releaseGeneration();
    this.endPlayback();

    const rawParagraphs = splitIntoParagraphs(options.content);
    const minParagraphs = Math.max(1, options.minParagraphs ?? 3);
    const paragraphs = prepareTtsParagraphs(options.content, minParagraphs);
    if (paragraphs.length === 0) return;

    const singleChunk = rawParagraphs.length < minParagraphs;

    if (options.forceRegenerate) {
      await clearTtsCacheForMessage(options.messageId, options.voiceId);
    }

    this.generation = {
      messageId: options.messageId,
      voiceId: options.voiceId,
      paragraphs,
      singleChunk,
      conversationId: options.conversationId,
      conversationTitle: options.conversationTitle,
      forceRegenerate: Boolean(options.forceRegenerate),
      aborted: false,
      inFlight: 0,
      playbackDismissed: false,
      userInitiatedGeneration: false,
      fetchPromises: new Map(),
      paragraphTaskIds: new Map(),
    };

    this.prefetchAhead = Math.max(0, options.prefetchAhead ?? 2);
    this.playback = {
      messageId: options.messageId,
      conversationId: options.conversationId,
      paragraphs,
      currentIndex: 0,
      autoAdvance: true,
    };

    this.emit({
      messageId: options.messageId,
      conversationId: options.conversationId,
      totalParagraphs: paragraphs.length,
      currentParagraph: 1,
      isPlaying: false,
      isPreparing: true,
    });

    await this.playAllFrom(this.playback.currentIndex);
  }

  private async playAllFrom(startIndex: number): Promise<void> {
    if (!this.playback) return;

    const session = ++this.playAllSession;
    const audioGen = this.playGeneration;

    for (let i = startIndex; i < this.playback.paragraphs.length; i++) {
      if (session !== this.playAllSession || !this.playback.autoAdvance) break;

      this.playback.currentIndex = i;
      this.emit({ currentParagraph: i + 1 });

      const played = await this.playParagraph(i, audioGen);
      if (!played || !this.playback.autoAdvance || session !== this.playAllSession) break;
    }

    if (session === this.playAllSession && this.playback) {
      this.emit({ isPlaying: false, isPreparing: false });
    }
  }

  private prefetchFrom(index: number): void {
    if (!this.playback || !this.generation) return;
    for (let ahead = 1; ahead <= this.prefetchAhead; ahead++) {
      const nextIndex = index + ahead;
      if (nextIndex < this.playback.paragraphs.length) void this.ensureParagraph(nextIndex);
    }
  }



  private async synthesize(index: number, forceRegenerate: boolean): Promise<ParagraphAudio | null> {
    const job = this.generation;
    if (!job || job.aborted) return null;

    const text = job.paragraphs[index];
    const cacheKey = makeTtsCacheKey(job.messageId, job.voiceId, index, text);

    let taskId: string | undefined;

    try {
      if (job.aborted) throw new Error('Cancelled');

      if (!forceRegenerate) {
        const cached = await getTtsCache(cacheKey);
        if (cached) {
          return { kind: 'url', url: URL.createObjectURL(cached) };
        }
      }

      if (job.aborted) throw new Error('Cancelled');

      // Only create a task log entry for paragraphs we are actively generating.
      // No pending tasks for the rest of the message.
      taskId = this.taskHooks.createTtsTask({
        messageId: job.messageId,
        conversationId: job.conversationId,
        conversationTitle: job.conversationTitle,
        paragraphIndex: index,
        paragraphText: text,
        onAbort: () => {
          if (!this.generation || this.generation.aborted) return;
          this.generation.aborted = true;
          this.haltAudio();
          if (this.playback?.messageId === job.messageId) {
            this.playback.autoAdvance = false;
          }
        },
      });

      job.paragraphTaskIds.set(index, taskId);
      job.inFlight++;
      this.taskHooks.updateTtsTask(taskId, 'running');

      try {
        const blob = await api.tts(text, job.voiceId);
        if (job.aborted) throw new Error('Cancelled');

        if (blob) {
          await setTtsCache(cacheKey, blob);
          this.taskHooks.updateTtsTask(taskId, 'completed');
          return { kind: 'url', url: URL.createObjectURL(blob) };
        }

        this.taskHooks.updateTtsTask(taskId, 'completed');
        return { kind: 'browser' };
      } finally {
        job.inFlight = Math.max(0, job.inFlight - 1);
        this.maybeCancelAfterPlaybackDismissed();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'TTS failed';
      if (taskId) {
        if (message === 'Cancelled') {
          this.taskHooks.updateTtsTask(taskId, 'cancelled');
        } else {
          this.taskHooks.updateTtsTask(taskId, 'failed', message);
        }
      }
      return null;
    }
  }

  private ensureParagraph(index: number): Promise<ParagraphAudio | null> {
    const job = this.generation;
    if (!job) return Promise.resolve(null);

    if (!job.fetchPromises.has(index)) {
      job.fetchPromises.set(
        index,
        this.synthesize(index, job.forceRegenerate),
      );
    }
    return job.fetchPromises.get(index)!;
  }

  private async getPlaybackAudio(index: number): Promise<ParagraphAudio | null> {
    const job = this.generation;
    if (!job) return null;

    const synthesized = await this.ensureParagraph(index);
    if (!synthesized) return null;

    const text = job.paragraphs[index];
    const cacheKey = makeTtsCacheKey(job.messageId, job.voiceId, index, text);
    const cached = await getTtsCache(cacheKey);
    if (cached) {
      return { kind: 'url', url: URL.createObjectURL(cached) };
    }

    return synthesized.kind === 'browser' ? { kind: 'browser' } : null;
  }

  private async playParagraph(index: number, generation = this.playGeneration): Promise<boolean> {
    if (!this.playback || !this.generation) return false;

    this.emit({ isPreparing: true, isPlaying: false });
    this.prefetchFrom(index);

    const audio = await this.getPlaybackAudio(index);
    if (generation !== this.playGeneration || !this.playback) {
      if (audio?.kind === 'url') URL.revokeObjectURL(audio.url);
      return false;
    }

    if (!audio) {
      this.emit({ isPreparing: false, isPlaying: false });
      return false;
    }

    this.emit({ isPreparing: false, isPlaying: true });

    if (audio.kind === 'url') {
      const finished = await this.playUrl(audio.url, generation);
      URL.revokeObjectURL(audio.url);
      if (generation === this.playGeneration) {
        this.emit({ isPlaying: false });
      }
      return finished;
    }

    try {
      await speakWithBrowser(this.playback.paragraphs[index]);
    } finally {
      if (generation === this.playGeneration) {
        this.emit({ isPlaying: false });
      }
    }
    return generation === this.playGeneration;
  }

  private playUrl(url: string, generation: number): Promise<boolean> {
    return new Promise((resolve) => {
      const audio = new Audio(url);
      this.audio = audio;

      const finish = (ok: boolean) => {
        if (this.audio === audio) this.audio = null;
        resolve(ok && generation === this.playGeneration);
      };

      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);
      audio.play().catch(() => finish(false));
    });
  }
}