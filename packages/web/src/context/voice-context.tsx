import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { VoiceSettings } from '@aether/shared';
import { api } from '../lib/api';
import {
  isBrowserSttSupported,
  stopBrowserSpeech,
} from '../lib/browser-speech';
import { TtsQueuePlayer, type TtsPlaybackState } from '../lib/tts-player';
import { useAppStore } from '../store/app-store';
import { useTaskStore } from '../store/task-store';

interface SpeakMessageParams {
  messageId: string;
  content: string;
  conversationId?: string;
  conversationTitle?: string;
  forceRegenerate?: boolean;
}

interface VoiceContextValue {
  isRecording: boolean;
  isTranscribing: boolean;
  isSpeaking: boolean;
  playback: TtsPlaybackState | null;
  sttAvailable: boolean;
  startDictation: () => Promise<void>;
  stopDictation: () => Promise<string | null>;
  speakMessage: (params: SpeakMessageParams) => Promise<void>;
  pauseTts: () => void;
  playTts: () => Promise<void>;
  nextParagraph: () => Promise<void>;
  previousParagraph: () => Promise<void>;
  regenerateTts: () => Promise<void>;
  dismissTts: () => void;
  isSpeakingMessage: (messageId: string) => boolean;
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

type SpeechRecognitionCtor = SpeechRecognitionConstructor;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function pickMimeType(): string {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? 'audio/webm';
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  const settings = useAppStore((s) => s.settings);
  const apiKeyConfigured = useAppStore((s) => s.apiKeyConfigured);
  const { registerTask, updateTask, completeTask, failTask, markCancelled } = useTaskStore();

  const voiceSettings: VoiceSettings = settings?.voice ?? {
    ttsEnabled: true,
    ttsVoice: 'eve',
    ttsPrefetchAhead: 2,
    ttsMinParagraphs: 3,
    sttEnabled: true,
    dictationOnNewChat: false,
    autoReadResponses: false,
  };

  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [playback, setPlayback] = useState<TtsPlaybackState | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const browserTranscriptRef = useRef('');
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const ttsPlayerRef = useRef(new TtsQueuePlayer());

  useEffect(() => {
    const player = ttsPlayerRef.current;
    player.setListener(setPlayback);
    player.setTaskHooks({
      // Only create a task entry for paragraphs we are actively generating.
      // No batch parent, no pending TTS tasks.
      createTtsTask: (input) =>
        registerTask({
          category: 'tts',
          title: 'Generating TTS audio',
          detail:
            input.paragraphText.length > 80
              ? `${input.paragraphText.slice(0, 80)}…`
              : input.paragraphText,
          conversationId: input.conversationId,
          conversationTitle: input.conversationTitle,
          messageId: input.messageId,
          cancellable: true,
          onAbort: input.onAbort,
        }),
      updateTtsTask: (taskId, status, error) => {
        if (status === 'completed') {
          completeTask(taskId);
        } else if (status === 'failed') {
          failTask(taskId, error || 'TTS failed');
        } else if (status === 'cancelled') {
          markCancelled(taskId, error);
        } else {
          updateTask(taskId, { status });
        }
      },
      cancelTtsTask: (taskId, reason) => markCancelled(taskId, reason),
    });
    return () => player.setListener(null);
  }, [registerTask, updateTask, completeTask, failTask, markCancelled]);

  const pauseTts = useCallback(() => {
    ttsPlayerRef.current.pause();
    stopBrowserSpeech();
  }, []);

  const playTts = useCallback(async () => {
    await ttsPlayerRef.current.play();
  }, []);

  const nextParagraph = useCallback(async () => {
    await ttsPlayerRef.current.nextParagraph();
  }, []);

  const previousParagraph = useCallback(async () => {
    await ttsPlayerRef.current.previousParagraph();
  }, []);

  const speakMessage = useCallback(async ({
    messageId,
    content,
    conversationId,
    conversationTitle,
    forceRegenerate,
  }: SpeakMessageParams) => {
    if (!voiceSettings.ttsEnabled) return;

    await ttsPlayerRef.current.speak({
      messageId,
      content,
      conversationId,
      conversationTitle,
      voiceId: voiceSettings.ttsVoice,
      prefetchAhead: voiceSettings.ttsPrefetchAhead,
      minParagraphs: voiceSettings.ttsMinParagraphs,
      forceRegenerate,
    });
  }, [
    voiceSettings.ttsEnabled,
    voiceSettings.ttsVoice,
    voiceSettings.ttsPrefetchAhead,
    voiceSettings.ttsMinParagraphs,
  ]);

  const regenerateTts = useCallback(async () => {
    await ttsPlayerRef.current.regenerate();
  }, []);

  const dismissTts = useCallback(() => {
    ttsPlayerRef.current.endPlayback({ cancelQueuedTask: true });
    stopBrowserSpeech();
  }, []);

  const isSpeakingMessage = useCallback(
    (messageId: string) =>
      playback?.messageId === messageId && (playback.isPlaying || playback.isPreparing),
    [playback],
  );

  const stopBrowserRecognition = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  }, []);

  const startBrowserRecognition = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;

    browserTranscriptRef.current = '';
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      browserTranscriptRef.current = transcript.trim();
    };

    recognition.onerror = () => {
      /* keep recorded audio path as primary */
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, []);

  const startDictation = useCallback(async () => {
    if (!voiceSettings.sttEnabled || isRecording) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      if (isBrowserSttSupported()) {
        startBrowserRecognition();
        setIsRecording(true);
      }
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    mediaRecorderRef.current = recorder;
    recorder.start();

    if (isBrowserSttSupported()) {
      startBrowserRecognition();
    }

    setIsRecording(true);
  }, [voiceSettings.sttEnabled, isRecording, startBrowserRecognition]);

  const stopDictation = useCallback(async (): Promise<string | null> => {
    if (!isRecording) return null;

    setIsRecording(false);
    setIsTranscribing(true);
    stopBrowserRecognition();

    try {
      const recorder = mediaRecorderRef.current;

      if (recorder && recorder.state !== 'inactive') {
        const text = await new Promise<string | null>((resolve) => {
          recorder.onstop = async () => {
            recorder.stream.getTracks().forEach((t) => t.stop());

            const mimeType = recorder.mimeType || pickMimeType();
            const blob = new Blob(chunksRef.current, { type: mimeType });

            if (blob.size > 0 && apiKeyConfigured) {
              const result = await api.stt(blob);
              if (result?.trim()) {
                resolve(result.trim());
                return;
              }
            }

            const browserText = browserTranscriptRef.current.trim();
            resolve(browserText || null);
          };

          recorder.stop();
        });

        return text;
      }

      return browserTranscriptRef.current.trim() || null;
    } finally {
      setIsTranscribing(false);
      mediaRecorderRef.current = null;
      chunksRef.current = [];
      browserTranscriptRef.current = '';
    }
  }, [isRecording, apiKeyConfigured, stopBrowserRecognition]);

  const sttAvailable = voiceSettings.sttEnabled && (
    Boolean(navigator.mediaDevices?.getUserMedia) || isBrowserSttSupported()
  );

  const isSpeaking = Boolean(playback?.isPlaying || playback?.isPreparing);

  const value = useMemo<VoiceContextValue>(() => ({
    isRecording,
    isTranscribing,
    isSpeaking,
    playback,
    sttAvailable,
    startDictation,
    stopDictation,
    speakMessage,
    pauseTts,
    playTts,
    nextParagraph,
    previousParagraph,
    regenerateTts,
    dismissTts,
    isSpeakingMessage,
  }), [
    isRecording,
    isTranscribing,
    isSpeaking,
    playback,
    sttAvailable,
    startDictation,
    stopDictation,
    speakMessage,
    pauseTts,
    playTts,
    nextParagraph,
    previousParagraph,
    regenerateTts,
    dismissTts,
    isSpeakingMessage,
  ]);

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice(): VoiceContextValue {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error('useVoice must be used within VoiceProvider');
  return ctx;
}