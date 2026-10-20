import { ResponseOptionsDialog } from './ResponseOptionsDialog';

interface Props {
  storyMode?: boolean;
  castPersonaIds?: string[];
  onClose: () => void;
  onConfirm: (opts: {
    influencePrompt?: string;
    respondAs?: { type: import('@aether/shared').ResponderType; id: string };
  }) => void | Promise<void>;
}

export function RegenerateDialog({ storyMode, castPersonaIds, onClose, onConfirm }: Props) {
  return (
    <ResponseOptionsDialog
      title="Regenerate response"
      description={
        storyMode
          ? 'Creates a new branch. The narrator regenerates; optionally focus context on a cast character.'
          : 'Creates a new branch from this point. The previous response is saved as an alternate branch.'
      }
      confirmLabel="Regenerate"
      confirmingLabel="Regenerating…"
      storyMode={storyMode}
      castPersonaIds={castPersonaIds}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}