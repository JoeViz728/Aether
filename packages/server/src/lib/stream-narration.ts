import type { ToolCallRecord } from '@aether/shared';

type LooseRecord = Record<string, unknown>;

function asRecord(value: unknown): LooseRecord | null {
  return value && typeof value === 'object' ? (value as LooseRecord) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function formatBuiltinToolName(name: string): string {
  const labels: Record<string, string> = {
    web_search: 'web search',
    web_search_with_snippets: 'web search',
    browse_page: 'page analysis',
    open_page: 'page analysis',
    open_page_with_find: 'page analysis',
    x_search: 'X search',
    x_user_search: 'X user search',
    x_keyword_search: 'X keyword search',
    x_semantic_search: 'X semantic search',
    x_thread_fetch: 'X thread fetch',
    code_interpreter: 'code execution',
    code_execution: 'code execution',
  };

  return labels[name] ?? name.replace(/_/g, ' ');
}

export function narrateWebSearchItem(item: LooseRecord, status: ToolCallRecord['status']): string {
  const action = asRecord(item.action);
  const actionType = asString(action?.type);
  const query = asString(action?.query);
  const url = asString(action?.url);

  if (actionType === 'search' && query) {
    return status === 'running'
      ? `Searching the web for “${query}”.`
      : `Searched the web for “${query}”.`;
  }

  if ((actionType === 'open_page' || actionType === 'browse_page') && url) {
    let host = url;
    try {
      host = new URL(url).hostname;
    } catch {
      /* keep raw url */
    }
    return status === 'running'
      ? `Reading and analyzing ${host}.`
      : `Reviewed ${host} for relevant details.`;
  }

  if (status === 'running') return 'Searching the web for relevant information.';
  return 'Completed a web search pass.';
}

export function narrateWebSearchSources(item: LooseRecord): string | undefined {
  const action = asRecord(item.action);
  const sources = Array.isArray(action?.sources) ? action!.sources : [];
  if (sources.length === 0) return undefined;

  const lines = sources.slice(0, 8).map((source) => {
    const record = asRecord(source);
    const title = asString(record?.title);
    const url = asString(record?.url);
    if (title && url) return `• ${title} (${url})`;
    if (url) return `• ${url}`;
    return null;
  }).filter((line): line is string => Boolean(line));

  if (lines.length === 0) return undefined;
  const suffix = sources.length > lines.length ? `\n• …and ${sources.length - lines.length} more` : '';
  return `Sources reviewed:\n${lines.join('\n')}${suffix}`;
}

export function narrateCodeInterpreter(item: LooseRecord, status: ToolCallRecord['status']): string {
  if (status === 'running') return 'Running code to analyze the problem.';
  const outputs = Array.isArray(item.outputs) ? item.outputs : [];
  if (outputs.length > 0) return 'Ran code execution and incorporated the results.';
  return 'Completed code execution.';
}

export function narrateXSearch(item: LooseRecord, status: ToolCallRecord['status']): string {
  const action = asRecord(item.action);
  const query = asString(action?.query);
  if (query) {
    return status === 'running'
      ? `Searching X for “${query}”.`
      : `Searched X for “${query}”.`;
  }
  return status === 'running' ? 'Searching X for relevant posts.' : 'Completed an X search pass.';
}

export function narrateOutputItem(
  item: unknown,
  status: ToolCallRecord['status'],
): { name: string; summary: string; detail?: string } | null {
  const record = asRecord(item);
  if (!record) return null;

  const type = asString(record.type);
  if (!type) return null;

  if (type === 'web_search_call') {
    const summary = narrateWebSearchItem(record, status);
    const detail = status === 'complete' ? narrateWebSearchSources(record) : undefined;
    return { name: 'web_search', summary, detail };
  }

  if (type === 'x_search_call') {
    return { name: 'x_search', summary: narrateXSearch(record, status) };
  }

  if (type === 'code_interpreter_call') {
    return { name: 'code_interpreter', summary: narrateCodeInterpreter(record, status) };
  }

  if (type.includes('function') || type.includes('tool')) {
    const name = asString(record.name) ?? 'tool';
    return {
      name,
      summary: status === 'running'
        ? `Running ${formatBuiltinToolName(name)}.`
        : `Finished ${formatBuiltinToolName(name)}.`,
    };
  }

  return null;
}

export function narrateWebSearchEvent(type: string): string | undefined {
  switch (type) {
    case 'response.web_search_call.in_progress':
      return 'Starting a web search.';
    case 'response.web_search_call.searching':
      return 'Searching the web for relevant pages.';
    case 'response.web_search_call.completed':
      return 'Web search finished.';
    default:
      return undefined;
  }
}