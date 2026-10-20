import OpenAI from 'openai';
import { getApiKey } from '../env.js';

let client: OpenAI | null = null;

export function getXaiClient(): OpenAI {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('XAI_API_KEY is not configured. Add it to the .env file at the project root.');
  }

  if (!client) {
    client = new OpenAI({
      apiKey,
      baseURL: 'https://api.x.ai/v1',
      timeout: 3600_000,
    });
  }

  return client;
}

// Simple in-memory cache for model list (cheap endpoint, changes infrequently)
let cachedModels: { ids: string[]; fetchedAt: number } | null = null;
const MODELS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function listAvailableModels(): Promise<string[]> {
  const now = Date.now();
  if (cachedModels && (now - cachedModels.fetchedAt < MODELS_CACHE_TTL_MS)) {
    return cachedModels.ids;
  }

  try {
    const c = getXaiClient();
    const response = await c.models.list();
    const ids = (response.data || [])
      .map((m: any) => m?.id)
      .filter((id: any): id is string => typeof id === 'string' && id.length > 0)
      .sort((a, b) => a.localeCompare(b));

    cachedModels = { ids, fetchedAt: now };
    return ids.length > 0 ? ids : getDefaultModelIds();
  } catch {
    return getDefaultModelIds();
  }
}

function getDefaultModelIds(): string[] {
  return ['grok-2', 'grok-2-1212', 'grok-beta', 'grok-build-0.1'];
}


export type BuiltinServerTool =
  | { type: 'web_search' }
  | { type: 'x_search' }
  | { type: 'code_interpreter' };

export type FunctionToolDef = {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type XaiToolDef = BuiltinServerTool | FunctionToolDef;

export function buildTools(
  settings: {
    enableWebSearch: boolean;
    enableXSearch: boolean;
    enableCodeExecution: boolean;
  },
  functionTools: FunctionToolDef[] = [],
): XaiToolDef[] {
  const tools: XaiToolDef[] = [];

  if (settings.enableWebSearch) tools.push({ type: 'web_search' });
  if (settings.enableXSearch) tools.push({ type: 'x_search' });
  if (settings.enableCodeExecution) tools.push({ type: 'code_interpreter' });
  tools.push(...functionTools);

  return tools;
}