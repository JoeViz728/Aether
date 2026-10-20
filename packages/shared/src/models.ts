export type ModelTier = 'fast' | 'balanced' | 'reasoning' | 'multi-agent' | 'build';

export interface ModelDefinition {
  id: string;
  label: string;
  tier: ModelTier;
  description: string;
  supportsReasoning: boolean;
  supportsTools: boolean;
  supportsMultiAgent: boolean;
  contextWindow: number;
}

/**
 * Static registry of known models + their intended purpose.
 * Used for fallbacks and metadata. Real selection prefers the live list
 * passed into selectModelForPrompt so we adapt to whatever the user's
 * xAI account actually has access to.
 */
export const AETHER_MODELS: ModelDefinition[] = [
  {
    id: 'grok-2',
    label: 'grok-2',
    tier: 'balanced',
    description: 'General-purpose model. Good default for most conversation, analysis and research.',
    supportsReasoning: true,
    supportsTools: true,
    supportsMultiAgent: false,
    contextWindow: 128_000,
  },
  {
    id: 'grok-2-1212',
    label: 'grok-2-1212',
    tier: 'balanced',
    description: 'Grok 2 snapshot. Solid balanced model for chat and tools.',
    supportsReasoning: true,
    supportsTools: true,
    supportsMultiAgent: false,
    contextWindow: 128_000,
  },
  {
    id: 'grok-beta',
    label: 'grok-beta',
    tier: 'fast',
    description: 'Faster / lighter model. Best for quick, simple responses.',
    supportsReasoning: false,
    supportsTools: true,
    supportsMultiAgent: false,
    contextWindow: 128_000,
  },
  {
    id: 'grok-build-0.1',
    label: 'grok-build-0.1',
    tier: 'build',
    description: 'Specialized agentic coding model. Intended for build tasks, code generation, refactoring, tool-heavy agent workflows, scaffolding, and development work.',
    supportsReasoning: true,
    supportsTools: true,
    supportsMultiAgent: false,
    contextWindow: 256_000,
  },
];

export function getModelById(id: string): ModelDefinition | undefined {
  return AETHER_MODELS.find((m) => m.id === id);
}

function categorizePromptForRouting(prompt: string, enableMultiAgent: boolean): 'build' | 'reasoning' | 'fast' | 'general' {
  const lower = prompt.toLowerCase();
  const wordCount = prompt.trim().split(/\s+/).length;

  // Build / agentic coding / development work
  // Be quite broad — these should go to a model whose *intended purpose* is coding & tools
  const buildSignals = [
    'build', 'create app', 'implement', 'write code', 'write a function',
    'code', 'script', 'fix bug', 'debug', 'refactor', 'develop',
    'scaffold', 'component', 'api endpoint', 'database', 'class ',
    'function ', 'website', 'web app', 'cli tool', 'file', 'edit the',
    'generate a ', 'make a ', 'add a feature',
  ];
  if (buildSignals.some((s) => lower.includes(s))) {
    return 'build';
  }

  // Strong reasoning / complex analysis / planning
  const reasoningSignals = [
    'analyze', 'compare', 'evaluate', 'pros and cons', 'step by step',
    'detailed plan', 'architecture', 'design', 'strategy', 'prove',
    'explain why', 'complex', 'trade-off', 'reason about', 'break down',
    'multi-step', 'in depth',
  ];
  const isLongOrComplex = wordCount > 80 || reasoningSignals.some((s) => lower.includes(s));

  if (enableMultiAgent && isLongOrComplex) {
    return 'reasoning';
  }

  if (isLongOrComplex) {
    return 'reasoning';
  }

  // Research / current events / broad information gathering
  const researchSignals = [
    'research', 'latest', 'current', 'news', 'what happened',
    'look up', 'investigate', 'find information', 'summary of',
  ];
  if (researchSignals.some((s) => lower.includes(s)) || wordCount > 110) {
    return 'general';
  }

  // Very short / casual → prefer fast model
  if (wordCount < 12 || /^(hi|hello|hey|thanks|ok|yes|no|sure|got it)\b/.test(lower.trim())) {
    return 'fast';
  }

  return 'general';
}

/**
 * Pick the best model from the live list for a given purpose category.
 * This is the key part that makes routing "mindful" of intended purpose
 * even as xAI adds/removes models over time.
 */
function pickModelForPurpose(purpose: 'build' | 'reasoning' | 'fast' | 'general', available: string[]): string | null {
  if (!available || available.length === 0) return null;

  const lower = available.map((m) => m.toLowerCase());

  if (purpose === 'build') {
    // Strongly prefer any model whose name signals "build" or agentic coding purpose.
    const buildMatch = available.find((m) => /build|agentic|code-agent/i.test(m))
      || available.find((m, i) => lower[i].includes('build'));
    if (buildMatch) return buildMatch;

    // If no dedicated build model, fall back to the most capable general model
    // (we still want to avoid using a pure "fast" model for serious build work).
    const nonFast = available.filter((m) => !/beta|fast|mini|turbo/i.test(m));
    return nonFast[0] ?? available[0];
  }

  if (purpose === 'fast') {
    const fastMatch = available.find((m) => /beta|fast|mini|small|turbo|quick/i.test(m));
    if (fastMatch) return fastMatch;
    // Otherwise just take the first (server will still work)
    return available[0];
  }

  // reasoning or general: prefer capable non-build models.
  // Avoid routing normal conversation to a model whose *intended purpose* is build/agentic work.
  const nonBuild = available.filter((m) => !/build/i.test(m));
  const pool = nonBuild.length > 0 ? nonBuild : available;

  // Heuristic: prefer "grok-2" family over pure beta if both present.
  const grok2 = pool.find((m) => /grok-2|grok-3|grok-4/i.test(m));
  if (grok2) return grok2;

  return pool[0];
}

export function selectModelForPrompt(
  prompt: string,
  options: {
    forceModel?: string;
    enableMultiAgent?: boolean;
    /** Live list from /models — when present we pick a model whose *intended purpose* matches the prompt. */
    availableModels?: string[];
  } = {},
): string {
  if (options.forceModel) return options.forceModel;

  const available = options.availableModels ?? [];
  const purpose = categorizePromptForRouting(prompt, !!options.enableMultiAgent);

  // First choice: adapt to whatever models the current API key actually has
  const fromAvailable = pickModelForPurpose(purpose, available);
  if (fromAvailable) {
    return fromAvailable;
  }

  // Static fallbacks (kept in sync with intended purposes)
  if (purpose === 'build') {
    return 'grok-build-0.1';
  }
  if (purpose === 'fast') {
    return 'grok-beta';
  }
  // reasoning and general both land on a solid general model
  return 'grok-2';
}