import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ChevronDown,
  ChevronRight,
  Brain,
  Route,
  Bot,
  Globe,
  Code,
  Wrench,
  Twitter,
  Link2,
} from 'lucide-react';
import type { Citation, ThinkingBlock, ThinkingBlockType, ToolCallRecord } from '@aether/shared';
import {
  buildThinkingTrace,
  formatThinkingSectionTitle,
  formatToolStepBody,
  formatToolStepTitle,
  getThinkingEndMs,
  getThinkingStartMs,
  getVisibleToolDetail,
  isThinkingPhaseActive,
  parseSourceLine,
  parseToolSourcesDetail,
  type ThinkingTraceStep,
} from '../lib/thinking-trace';

interface Props {
  blocks: ThinkingBlock[];
  toolCalls?: ToolCallRecord[];
  citations?: Citation[];
  isStreaming?: boolean;
  hasResponseContent?: boolean;
}

const BLOCK_META: Record<ThinkingBlockType, { icon: LucideIcon; fallbackLabel: string }> = {
  routing: { icon: Route, fallbackLabel: 'Model routing' },
  reasoning: { icon: Brain, fallbackLabel: 'Reasoning' },
  agent: { icon: Bot, fallbackLabel: 'Agent' },
  tool: { icon: Wrench, fallbackLabel: 'Tool' },
};

const TOOL_ICONS: Record<string, LucideIcon> = {
  web_search: Globe,
  x_search: Twitter,
  code_interpreter: Code,
  code_execution: Code,
};

function getBlockLabel(block: ThinkingBlock): string {
  if (block.agentLabel) {
    if (block.type === 'reasoning' && block.agentLabel === 'Thinking') {
      return 'Reasoning';
    }
    return block.agentLabel;
  }
  return BLOCK_META[block.type ?? 'reasoning'].fallbackLabel;
}

function ThinkingBlockCard({ block }: { block: ThinkingBlock }) {
  const type = block.type ?? 'reasoning';
  const meta = BLOCK_META[type] ?? BLOCK_META.reasoning;
  const Icon = meta.icon;

  return (
    <div className="rounded-lg border border-aether-border/60 bg-aether-surface/60 p-3 text-sm">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-aether-text/70">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {getBlockLabel(block)}
      </div>
      <p className="whitespace-pre-wrap leading-relaxed text-aether-muted">{block.content}</p>
      {block.status === 'streaming' && (
        <span className="mt-1 inline-block h-3 w-0.5 bg-aether-muted animate-pulse" />
      )}
    </div>
  );
}

function ToolSourcesList({ lines }: { lines: string[] }) {
  return (
    <ul className="mt-2 space-y-1 border-t border-aether-border/40 pt-2 text-aether-muted">
      {lines.map((line, index) => {
        const { label, url } = parseSourceLine(line);
        return (
          <li key={`${line}-${index}`} className="text-xs leading-relaxed">
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all hover:text-aether-text underline underline-offset-2"
              >
                {url}
              </a>
            ) : (
              <span className="text-aether-muted/80">{label}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ToolStepCard({ tool }: { tool: ToolCallRecord }) {
  const Icon = TOOL_ICONS[tool.name] ?? Wrench;
  const isActive = tool.status === 'running' || tool.status === 'pending';
  const sourceLines = parseToolSourcesDetail(tool.detail);
  const visibleDetail = getVisibleToolDetail(tool);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const sourceCount = sourceLines?.filter((line) => !/^…and\s+\d+\s+more$/i.test(line)).length ?? 0;

  return (
    <div className="rounded-lg border border-aether-border/60 bg-aether-surface/60 p-3 text-sm">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-aether-text/70">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {formatToolStepTitle(tool.name)}
        {isActive && (
          <span className="ml-1 inline-flex gap-0.5">
            <span className="h-1 w-1 rounded-full bg-aether-muted animate-pulse-dot" />
            <span className="h-1 w-1 rounded-full bg-aether-muted animate-pulse-dot [animation-delay:0.2s]" />
            <span className="h-1 w-1 rounded-full bg-aether-muted animate-pulse-dot [animation-delay:0.4s]" />
          </span>
        )}
      </div>
      <p className="whitespace-pre-wrap leading-relaxed text-aether-muted">{formatToolStepBody(tool)}</p>
      {visibleDetail && (
        <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-aether-muted/90">{visibleDetail}</p>
      )}
      {sourceLines && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setSourcesExpanded((open) => !open)}
            className="flex w-full items-center gap-1.5 text-xs text-aether-muted hover:text-aether-text transition-colors"
          >
            {sourcesExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            )}
            <Link2 className="h-3.5 w-3.5 shrink-0" />
            <span>
              Sources reviewed
              {sourceCount > 0 ? ` (${sourceCount})` : ''}
            </span>
          </button>
          {sourcesExpanded && <ToolSourcesList lines={sourceLines} />}
        </div>
      )}
    </div>
  );
}

function SourcesStepCard({ citations }: { citations: Citation[] }) {
  return (
    <div className="rounded-lg border border-aether-border/60 bg-aether-surface/60 p-3 text-sm">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-aether-text/70">
        <Link2 className="h-3.5 w-3.5 shrink-0" />
        Sources reviewed
      </div>
      <ul className="space-y-1 text-aether-muted">
        {citations.map((cite, index) => (
            <li key={`${cite.url}-${index}`}>
              <a
                href={cite.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs break-all hover:text-aether-text underline underline-offset-2"
              >
                {cite.url}
              </a>
              {cite.snippet && (
                <p className="mt-0.5 text-[11px] leading-snug text-aether-muted/80">{cite.snippet}</p>
              )}
            </li>
        ))}
      </ul>
    </div>
  );
}

function TraceStep({ step }: { step: ThinkingTraceStep }) {
  if (step.kind === 'block') return <ThinkingBlockCard block={step.block} />;
  if (step.kind === 'tool') return <ToolStepCard tool={step.tool} />;
  return <SourcesStepCard citations={step.citations} />;
}

export function ThinkingPanel({
  blocks,
  toolCalls = [],
  citations = [],
  isStreaming,
  hasResponseContent,
}: Props) {
  const responseStartedAtRef = useRef<number | null>(null);
  const [expanded, setExpanded] = useState(() => !hasResponseContent);
  const [now, setNow] = useState(() => Date.now());

  const trace = buildThinkingTrace(blocks, toolCalls, citations);
  if (trace.length === 0) return null;

  const thinkingActive = isThinkingPhaseActive(
    blocks,
    toolCalls,
    isStreaming ?? false,
    hasResponseContent ?? false,
  );

  useEffect(() => {
    if (hasResponseContent) {
      setExpanded(false);
    }
  }, [hasResponseContent]);

  useEffect(() => {
    if (isStreaming && hasResponseContent && responseStartedAtRef.current === null) {
      responseStartedAtRef.current = Date.now();
    }
  }, [isStreaming, hasResponseContent]);

  useEffect(() => {
    if (!thinkingActive) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [thinkingActive]);

  const startMs = getThinkingStartMs(blocks, toolCalls);
  const responseEndedAtMs = isStreaming ? responseStartedAtRef.current : null;
  const endMs = thinkingActive
    ? now
    : getThinkingEndMs(blocks, toolCalls, responseEndedAtMs);
  const sectionTitle = formatThinkingSectionTitle(thinkingActive, startMs, endMs);

  return (
    <div className="mb-1 rounded-xl border border-aether-border bg-aether-thinking/50 overflow-hidden animate-fade-in">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-aether-muted hover:text-aether-text transition-colors"
      >
        <Brain className="h-4 w-4 shrink-0" />
        <span className="font-medium">
          {sectionTitle}
          {thinkingActive && (
            <span className="ml-2 inline-flex gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-aether-muted animate-pulse-dot" />
              <span className="h-1.5 w-1.5 rounded-full bg-aether-muted animate-pulse-dot [animation-delay:0.2s]" />
              <span className="h-1.5 w-1.5 rounded-full bg-aether-muted animate-pulse-dot [animation-delay:0.4s]" />
            </span>
          )}
        </span>
        <span className="ml-auto">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {trace.map((step, index) => (
            <TraceStep key={`${step.kind}-${index}`} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}