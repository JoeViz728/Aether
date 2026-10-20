import fs from 'node:fs/promises';
import path from 'node:path';

export async function ensureDataDir(dataDir: string): Promise<void> {
  const dirs = [
    dataDir,
    path.join(dataDir, 'conversations'),
    path.join(dataDir, 'extensions'),
    path.join(dataDir, 'scripts'),
    path.join(dataDir, 'approvals'),
    path.join(dataDir, 'tools'),
    path.join(dataDir, 'notes'),
    path.join(dataDir, 'notes', 'conversations'),
    path.join(dataDir, 'personas'),
    path.join(dataDir, 'personas', 'avatars'),
  ];

  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
}