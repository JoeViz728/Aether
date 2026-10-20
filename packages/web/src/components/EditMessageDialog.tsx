import { useState } from 'react';
import { X } from 'lucide-react';
import type { ChatMessage } from '@aether/shared';

interface Props {
  message: ChatMessage;
  onClose: () => void;
  onConfirm: (content: string) => void | Promise<void>;
}

export function EditMessageDialog({ message, onClose, onConfirm }: Props) {
  const [content, setContent] = useState(message.content);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmed = content.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onConfirm(trimmed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-aether-overlay" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-aether-border bg-aether-surface p-6 shadow-2xl animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Edit {message.role === 'user' ? 'message' : 'response'}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-aether-muted hover:text-aether-text">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-aether-muted mb-4">
          Saving creates a new branch. Messages after this point are archived as an alternate path.
          {message.role === 'user' && ' A new assistant response will be generated.'}
        </p>

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={8}
          className="w-full rounded-lg border border-aether-border bg-aether-bg px-3 py-2 text-sm outline-none resize-y mb-6"
        />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-aether-border px-4 py-2.5 text-sm font-medium hover:bg-aether-surface-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !content.trim()}
            className="flex-1 rounded-xl bg-aether-accent text-aether-bg px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Save & branch'}
          </button>
        </div>
      </div>
    </div>
  );
}