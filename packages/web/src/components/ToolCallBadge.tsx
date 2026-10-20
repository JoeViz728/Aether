import { Globe, Code, Wrench, Twitter } from 'lucide-react';
import type { ToolCallRecord } from '@aether/shared';
import clsx from 'clsx';

const TOOL_ICONS: Record<string, typeof Globe> = {
  web_search: Globe,
  x_search: Twitter,
  code_interpreter: Code,
  code_execution: Code,
};

interface Props {
  toolCalls: ToolCallRecord[];
}

export function ToolCallBadge({ toolCalls }: Props) {
  if (toolCalls.length === 0) return null;

  return (
    <div className="mb-1 flex flex-wrap gap-2 animate-fade-in">
      {toolCalls.map((tool) => {
        const Icon = TOOL_ICONS[tool.name] ?? Wrench;
        return (
          <div
            key={tool.id}
            className={clsx(
              'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs',
              tool.status === 'running'
                ? 'border-green-500/30 bg-aether-tool text-aether-tool-active'
                : 'border-aether-border bg-aether-surface text-aether-muted',
            )}
          >
            <Icon className="h-3 w-3" />
            <span>{formatToolName(tool.name)}</span>
            {tool.status === 'running' && (
              <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse-dot" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatToolName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}