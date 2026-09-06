import { Router, type Request, type Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config/index.js';
import { shouldSkipEvent } from '../pre-filter.js';
import { mapGitHubEvent } from '../index.js';
import { safeErrorMessage } from '../utils/errors.js';
import type { RepoRelay } from '../index.js';

interface RawRequest extends Request {
  rawBody?: string;
}

function verifySignature(secret: string, rawBody: string, header?: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const sig = header.slice(7);
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createWebhookRouter(relay: RepoRelay): Router {
  const router = Router();

  router.post('/', async (req: RawRequest, res: Response) => {
    try {
      const sigHeaderRaw = req.headers['x-hub-signature-256'];
      const sigHeader = Array.isArray(sigHeaderRaw) ? sigHeaderRaw[0] : sigHeaderRaw;

      if (config.webhookSecret) {
        if (!verifySignature(config.webhookSecret, req.rawBody || JSON.stringify(req.body), sigHeader)) {
          res.status(401).json({ error: 'Invalid HMAC signature' });
          return;
        }
      }

      const eventHeader = req.headers['x-github-event'];
      const eventName = Array.isArray(eventHeader) ? eventHeader[0] : eventHeader;
      if (!eventName) {
        res.status(400).json({ error: 'Missing x-github-event header' });
        return;
      }

      const eventData = mapGitHubEvent(eventName, req.body);
      if (!eventData) {
        res.status(200).json({ status: 'ignored', reason: `Unhandled event type '${eventName}'` });
        return;
      }

      const skipReason = shouldSkipEvent(eventData);
      if (skipReason) {
        console.log(`[repo-relay] Pre-filter skipped ${eventName}: ${skipReason}`);
        res.status(200).json({ status: 'skipped', reason: skipReason });
        return;
      }

      await relay.handleEvent(eventData);
      res.status(200).json({ status: 'ok', event: eventName });
    } catch (error) {
      console.error(`[repo-relay] Webhook error: ${safeErrorMessage(error)}`);
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  return router;
}
