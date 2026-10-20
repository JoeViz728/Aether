import './load-env.js';

export function getApiKey(): string | undefined {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key || key === 'your_api_key_here') return undefined;
  return key;
}

export function isApiKeyConfigured(): boolean {
  return Boolean(getApiKey());
}