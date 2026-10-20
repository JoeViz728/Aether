type SpeechRecognitionCtor = SpeechRecognitionConstructor;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isBrowserSttSupported(): boolean {
  return getSpeechRecognition() !== null;
}

export function transcribeWithBrowser(): Promise<string> {
  const Ctor = getSpeechRecognition();
  if (!Ctor) return Promise.reject(new Error('Browser speech recognition not supported'));

  return new Promise((resolve, reject) => {
    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = navigator.language || 'en-US';

    let finalText = '';

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalText += event.results[i][0].transcript;
        }
      }
    };

    recognition.onerror = (event) => {
      reject(new Error(event.error || 'Speech recognition failed'));
    };

    recognition.onend = () => {
      resolve(finalText.trim());
    };

    recognition.start();
  });
}

export function speakWithBrowser(text: string): Promise<void> {
  if (!('speechSynthesis' in window)) {
    return Promise.reject(new Error('Browser speech synthesis not supported'));
  }

  return new Promise((resolve, reject) => {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => resolve();
    utterance.onerror = () => reject(new Error('Speech synthesis failed'));
    speechSynthesis.speak(utterance);
  });
}

export function stopBrowserSpeech(): void {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}