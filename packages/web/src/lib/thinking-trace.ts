import type { Citation, ThinkingBlock, ToolCallRecord } from '@aether/shared';

export type ThinkingTraceStep =
  | { kind: 'block'; block: ThinkingBlock; sortKey: number }
  | { kind: 'tool'; tool: ToolCallRecord; sortKey: number }
  | { kind: 'sources'; citations: Citation[]; sortKey: number };

function parseTime(iso: string | undefined): number {
  if (!iso) return 0;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function formatThinkingDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

export function formatThinkingSectionTitle(
  thinkingActive: boolean,
  startMs: number | null,
  endMs: number | null,
): string {
  if (startMs == null || endMs == null) {
    return 'Thinking';
  }

  const duration = formatThinkingDuration(Math.max(0, endMs - startMs));
  return thinkingActive ? `Thinking for ${duration}` : `Thought for ${duration}`;
}

export function getThinkingStartMs(
  blocks: ThinkingBlock[],
  toolCalls: ToolCallRecord[],
): number | null {
  const times = [
    ...blocks.map((block) => parseTime(block.startedAt)),
    ...toolCalls.map((tool) => parseTime(tool.startedAt)),
  ].filter((time) => time > 0);

  if (times.length === 0) return null;
  return Math.min(...times);
}

export function getThinkingEndMs(
  blocks: ThinkingBlock[],
  toolCalls: ToolCallRecord[],
  responseStartedAtMs: number | null,
): number | null {
  if (responseStartedAtMs) return responseStartedAtMs;

  const endTimes = [
    ...blocks.filter((block) => block.status === 'complete').map((block) => parseTime(block.completedAt)),
    ...toolCalls.filter((tool) => tool.status === 'complete' || tool.status === 'failed').map(
      (tool) => parseTime(tool.completedAt),
    ),
  ].filter((time) => time > 0);

  if (endTimes.length === 0) return null;
  return Math.max(...endTimes);
}

export function isThinkingPhaseActive(
  blocks: ThinkingBlock[],
  toolCalls: ToolCallRecord[],
  isStreaming: boolean,
  hasResponseContent: boolean,
): boolean {
  if (!isStreaming) return false;
  if (hasResponseContent) return false;
  if (blocks.some((block) => block.status === 'streaming')) return true;
  if (toolCalls.some((tool) => tool.status === 'running' || tool.status === 'pending')) return true;
  return isStreaming;
}

export function buildThinkingTrace(
  blocks: ThinkingBlock[],
  toolCalls: ToolCallRecord[],
  citations: Citation[],
): ThinkingTraceStep[] {
  const steps: ThinkingTraceStep[] = [
    ...blocks.map((block) => ({
      kind: 'block' as const,
      block,
      sortKey: parseTime(block.startedAt) || 0,
    })),
    ...toolCalls.map((tool) => ({
      kind: 'tool' as const,
      tool,
      sortKey: parseTime(tool.startedAt) || 0,
    })),
  ].sort((a, b) => a.sortKey - b.sortKey);

  if (citations.length > 0) {
    const lastSort = steps[steps.length - 1]?.sortKey ?? 0;
    steps.push({
      kind: 'sources',
      citations,
      sortKey: lastSort + 1,
    });
  }

  return steps;
}

export function formatToolStepTitle(name: string): string {
  const labels: Record<string, string> = {
    web_search: 'Web search',
    web_search_with_snippets: 'Web search',
    browse_page: 'Page analysis',
    open_page: 'Page analysis',
    open_page_with_find: 'Page analysis',
    x_search: 'X search',
    x_user_search: 'X user search',
    x_keyword_search: 'X keyword search',
    x_semantic_search: 'X semantic search',
    x_thread_fetch: 'X thread fetch',
    code_interpreter: 'Code execution',
    code_execution: 'Code execution',
  };

  return labels[name] ?? name.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatToolStepBody(tool: ToolCallRecord): string {
  if (tool.summary) return tool.summary;

  const title = formatToolStepTitle(tool.name);
  if (tool.status === 'running' || tool.status === 'pending') {
    return `${title} is in progress…`;
  }
  if (tool.status === 'failed') {
    return `${title} did not complete successfully.`;
  }
  return `${title} completed.`;
}

const SOURCES_DETAIL_HEADER = /^Sources reviewed:\s*/i;

export function isWebSearchTool(name: string): boolean {
  return (
    name === 'web_search' ||
    name === 'web_search_with_snippets' ||
    name === 'browse_page' ||
    name === 'open_page' ||
    name === 'open_page_with_find'
  );
}

export function parseToolSourcesDetail(detail?: string): string[] | null {
  if (!detail || !SOURCES_DETAIL_HEADER.test(detail)) return null;

  const lines = detail
    .replace(SOURCES_DETAIL_HEADER, '')
    .split('\n')
    .map((line) => line.replace(/^•\s*/, '').trim())
    .filter(Boolean);

  return lines.length > 0 ? lines : null;
}

export function parseSourceLine(line: string): { label: string; url: string | null } {
  const overflowMatch = line.match(/^…and\s+(\d+)\s+more$/i);
  if (overflowMatch) {
    return { label: line, url: null };
  }

  const titledUrlMatch = line.match(/^(.+?)\s*\((https?:\/\/[^)]+)\)\s*$/);
  if (titledUrlMatch) {
    return { label: titledUrlMatch[1].trim(), url: titledUrlMatch[2] };
  }

  const bareUrlMatch = line.match(/^(https?:\/\/\S+)/);
  if (bareUrlMatch) {
    let label = bareUrlMatch[1];
    try {
      label = new URL(bareUrlMatch[1]).hostname;
    } catch {
      /* keep full url */
    }
    return { label, url: bareUrlMatch[1] };
  }

  return { label: line, url: null };
}

export function getVisibleToolDetail(tool: ToolCallRecord): string | null {
  if (!tool.detail) return null;
  if (isWebSearchTool(tool.name) && parseToolSourcesDetail(tool.detail)) return null;
  return tool.detail;
}