import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { registerRoutes } from './routes/index.js';
import { ensureDataDir } from './storage/data-dir.js';
import { getProjectRoot } from './load-env.js';
import { isApiKeyConfigured } from './env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = getProjectRoot();

const HOST = process.env.AETHER_HOST ?? '127.0.0.1';
const PORT = Number(process.env.AETHER_PORT ?? 3847);
const DATA_DIR = process.env.AETHER_DATA_DIR
  ? path.resolve(projectRoot, process.env.AETHER_DATA_DIR)
  : path.join(projectRoot, 'data');

async function main() {
  await ensureDataDir(DATA_DIR);

  const app = Fastify({
    logger: true,
    bodyLimit: 120 * 1024 * 1024,
  });

  await app.register(cors, { origin: true });

  await registerRoutes(app, { dataDir: DATA_DIR });

  const webDist = path.resolve(__dirname, '../../web/dist');
  try {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      wildcard: false,
    });

    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api')) {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({ error: 'Not found' });
    });
  } catch {
    app.log.warn('Web dist not found — API-only mode. Run `pnpm build` for full app.');
  }

  await app.listen({ host: HOST, port: PORT });
  app.log.info(`Aether running at http://${HOST}:${PORT}`);
  app.log.info(`Data directory: ${DATA_DIR}`);
  app.log.info(`xAI API key: ${isApiKeyConfigured() ? 'configured' : 'NOT configured — set XAI_API_KEY in .env'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});