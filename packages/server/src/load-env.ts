import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findEnvFile(): string | undefined {
  const candidates = [
    path.resolve(__dirname, '../../../.env'),
    path.resolve(__dirname, '../../../../.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return undefined;
}

const envPath = findEnvFile();
if (envPath) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

if (process.env.XAI_API_KEY) {
  process.env.XAI_API_KEY = process.env.XAI_API_KEY.trim();
}

export function getProjectRoot(): string {
  if (envPath) return path.dirname(envPath);
  return path.resolve(__dirname, '../../..');
}