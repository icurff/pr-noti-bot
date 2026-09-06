/**
 * Repo Relay — Express server entry point (new style)
 *
 * Setup express app, mount routes, connect Discord bot, start listening.
 */

import express from 'express';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { RepoRelay } from './index.js';
import { getChannelConfig } from './config/channels.js';
import { config } from './config/index.js';
import { createWebhookRouter } from './routes/webhook.js';
import { createApiRouter } from './routes/api.js';
import { safeErrorMessage } from './utils/errors.js';

interface RawRequest extends express.Request {
  rawBody?: string;
}

async function start(): Promise<void> {
  console.log('[repo-relay] Starting...');

  const relay = new RepoRelay({
    discordToken: config.discordToken,
    githubToken: config.githubToken,
    channelConfig: getChannelConfig(),
    stateDir: config.stateDir,
  });

  await relay.connect();
  await relay.validatePermissions();

  const app = express();

  // Preserve raw body for HMAC signature verification
  app.use(express.json({
    limit: '10mb',
    verify: (req: RawRequest, _res, buf) => { req.rawBody = buf.toString('utf8'); },
  }));

  // Static UI
  const publicDir = resolve(process.cwd(), 'public');
  app.use(express.static(publicDir));

  // Routes
  app.use('/api', createApiRouter(relay));
  app.use(config.webhookPath, createWebhookRouter(relay));

  // Fallback to index.html (client-side routing)
  app.get('/{*splat}', (_req, res) => {
    const indexPath = join(publicDir, 'index.html');
    existsSync(indexPath) ? res.sendFile(indexPath) : res.status(404).json({ error: 'Not found' });
  });

  const server = app.listen(config.port, config.host, () => {
    console.log(`[repo-relay] Running at http://${config.host}:${config.port}`);
    console.log(`[repo-relay] Webhook: http://${config.host}:${config.port}${config.webhookPath}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n[repo-relay] ${signal} received, shutting down...`);
    server.close(() => console.log('[repo-relay] HTTP server closed'));
    try { await relay.disconnect(); } catch (err) {
      console.error('[repo-relay] Disconnect error:', safeErrorMessage(err));
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  console.error('[repo-relay] Fatal error:', err);
  process.exit(1);
});
