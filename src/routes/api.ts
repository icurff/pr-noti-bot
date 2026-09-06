import { Router, type Request, type Response } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeCategory } from '../embeds/media.js';
import { mapGitHubEvent } from '../index.js';
import { config } from '../config/index.js';
import { safeErrorMessage } from '../utils/errors.js';
import type { RepoRelay } from '../index.js';

const TEST_SCENARIOS: Record<string, { event: string; path: string }> = {
  open:     { event: 'pull_request',        path: './test-events/1-pr-opened.json' },
  ci:       { event: 'workflow_run',        path: './test-events/2-ci-passed.json' },
  'ci-fail':{ event: 'workflow_run',        path: './test-events/2-ci-failed.json' },
  approve:  { event: 'pull_request_review', path: './test-events/3-review-approved.json' },
  changes:  { event: 'pull_request_review', path: './test-events/3-review-changes.json' },
  merge:    { event: 'pull_request',        path: './test-events/4-pr-merged.json' },
};

function createDefaultMockPayload(scenarioKey: string, prNumber: number, repo: string = process.env.GITHUB_REPOSITORY || 'my-org/my-project'): Record<string, unknown> {
  const orgName = repo.includes('/') ? repo.split('/')[0] : 'my-org';

  switch (scenarioKey) {
    case 'open':
      return {
        action: 'opened',
        pull_request: {
          number: prNumber,
          title: `feat: Tích hợp xác thực GitHub OAuth và Webhook Real-time (PR #${prNumber})`,
          html_url: `https://github.com/${repo}/pull/${prNumber}`,
          user: {
            login: 'developer-octo',
            html_url: 'https://github.com/developer-octo',
            avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4',
          },
          head: { ref: `feat/feature-pr-${prNumber}`, sha: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4' },
          base: { ref: 'main' },
          additions: 186,
          deletions: 42,
          changed_files: 8,
          body: 'Tự động đồng bộ hóa và phản hồi trạng thái PR trực tiếp trên Discord qua kênh tương tác thông minh.',
          state: 'open',
          draft: false,
          merged: false,
          merged_at: null,
          created_at: new Date().toISOString(),
        },
        repository: { full_name: repo },
        sender: { login: 'developer-octo' },
      };

    case 'ci':
      return {
        action: 'completed',
        workflow_run: {
          id: 991827364,
          name: 'CI / Test Suite & Build Verification',
          head_sha: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4',
          head_branch: `feat/feature-pr-${prNumber}`,
          status: 'completed',
          conclusion: 'success',
          html_url: `https://github.com/${repo}/actions/runs/991827364`,
          pull_requests: [{ number: prNumber }],
        },
        repository: { full_name: repo },
      };

    case 'ci-fail':
      return {
        action: 'completed',
        workflow_run: {
          id: 991827365,
          name: 'CI / Test Suite & Build Verification',
          head_sha: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4',
          head_branch: `feat/feature-pr-${prNumber}`,
          status: 'completed',
          conclusion: 'failure',
          html_url: `https://github.com/${repo}/actions/runs/991827365`,
          pull_requests: [{ number: prNumber }],
        },
        repository: { full_name: repo },
      };

    case 'approve':
      return {
        action: 'submitted',
        review: {
          id: 772233445,
          user: { login: 'senior-reviewer', type: 'User' },
          body: 'LGTM! Code sạch sẽ, đầy đủ test cases và performance rất tốt! 👍🚀',
          state: 'approved',
          html_url: `https://github.com/${repo}/pull/${prNumber}#pullrequestreview-772233445`,
          author_association: 'COLLABORATOR',
        },
        pull_request: { number: prNumber },
        repository: { full_name: repo, owner: { login: orgName } },
      };

    case 'changes':
      return {
        action: 'submitted',
        review: {
          id: 772233446,
          user: { login: 'lead-architect', type: 'User' },
          body: 'Cần bổ sung thêm cơ chế retry và bắt timeout khi kết nối gateway mạng. ⚠️',
          state: 'changes_requested',
          html_url: `https://github.com/${repo}/pull/${prNumber}#pullrequestreview-772233446`,
          author_association: 'COLLABORATOR',
        },
        pull_request: { number: prNumber },
        repository: { full_name: repo, owner: { login: orgName } },
      };

    case 'merge':
      return {
        action: 'closed',
        pull_request: {
          number: prNumber,
          title: `feat: Tích hợp xác thực GitHub OAuth và Webhook Real-time (PR #${prNumber})`,
          html_url: `https://github.com/${repo}/pull/${prNumber}`,
          user: {
            login: 'developer-octo',
            html_url: 'https://github.com/developer-octo',
            avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4',
          },
          head: { ref: `feat/feature-pr-${prNumber}`, sha: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4' },
          base: { ref: 'main' },
          additions: 186,
          deletions: 42,
          changed_files: 8,
          body: 'Tự động đồng bộ hóa và phản hồi trạng thái PR trực tiếp trên Discord qua kênh tương tác thông minh.',
          state: 'closed',
          draft: false,
          merged: true,
          merged_at: new Date().toISOString(),
          merged_by: { login: 'lead-architect' },
          created_at: new Date().toISOString(),
        },
        repository: { full_name: repo },
        sender: { login: 'lead-architect' },
      };

    default:
      throw new Error(`Unsupported scenario: ${scenarioKey}`);
  }
}

export function createApiRouter(relay: RepoRelay): Router {
  const router = Router();
  let activeTestPrNumber = 101;

  // Health check
  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      bot: relay.isReady() ? 'connected' : 'connecting',
      uptime: process.uptime(),
    });
  });

  // Bot & system status
  router.get('/status', (_req: Request, res: Response) => {
    const client = relay.getClient();
    const me = client.user;
    const memory = process.memoryUsage();
    const relayCfg = relay.getConfig();

    res.json({
      bot: {
        id: me?.id,
        tag: me?.tag ?? 'RepoRelay Bot',
        username: me?.username ?? 'RepoRelay',
        avatar: me?.displayAvatarURL({ size: 128 }) ?? null,
        status: relay.isReady() ? 'online' : 'connecting',
        ping: client.ws.ping >= 0 ? client.ws.ping : null,
      },
      system: {
        uptime: process.uptime(),
        nodeVersion: process.version,
        memoryUsageMB: Math.round(memory.heapUsed / 1024 / 1024),
        totalHeapMB: Math.round(memory.heapTotal / 1024 / 1024),
        rssMB: Math.round(memory.rss / 1024 / 1024),
      },
      config: {
        ...relayCfg,
        webhookPath: config.webhookPath || '/webhook',
        hasSecret: Boolean(config.webhookSecret),
        channels: {
          prs: config.channels.prs || (typeof relayCfg.channelConfig === 'object' ? relayCfg.channelConfig.prs : ''),
          issues: config.channels.issues || '',
          releases: config.channels.releases || '',
          deployments: config.channels.deployments || '',
          security: config.channels.security || '',
        },
      },
    });
  });

  // Reaction media
  router.get('/media', (req: Request, res: Response) => {
    try {
      const db = relay.getDb();
      const category = req.query.category as string | undefined;
      const items = category ? db.getReactionMediaByCategory(category) : db.getAllReactionMedia();
      res.json({ items });
    } catch (err) {
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  router.post('/media', (req: Request, res: Response) => {
    try {
      const { category, url, title } = req.body;
      if (!category || !url) {
        res.status(400).json({ error: 'Missing category or url' });
        return;
      }
      try { new URL(url); } catch {
        res.status(400).json({ error: 'Invalid URL format' });
        return;
      }
      const item = relay.getDb().addReactionMedia(normalizeCategory(category), url, title);
      res.json({ success: true, item });
    } catch (err) {
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  router.delete('/media/:id', (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid media ID' });
        return;
      }
      res.json({ success: relay.getDb().deleteReactionMedia(id) });
    } catch (err) {
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  // Recent events
  router.get('/events', (req: Request, res: Response) => {
    try {
      const repo = (req.query.repo as string) || process.env.GITHUB_REPOSITORY || 'my-org/my-project';
      res.json({ events: relay.getDb().getRecentEvents(repo, undefined, 30) });
    } catch (err) {
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  // Webhook simulator
  router.post('/test', async (req: Request, res: Response) => {
    try {
      const scenarioKey = (req.body.scenario as string)?.toLowerCase();
      const scenario = TEST_SCENARIOS[scenarioKey];
      if (!scenario) {
        res.status(400).json({ error: `Unknown scenario: ${scenarioKey}` });
        return;
      }

      const targetPrNumber = typeof req.body.prNumber === 'number' && req.body.prNumber > 0
        ? req.body.prNumber
        : activeTestPrNumber;
      activeTestPrNumber = targetPrNumber;

      const filePath = resolve(process.cwd(), scenario.path);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let payload: any;

      if (existsSync(filePath)) {
        try {
          payload = JSON.parse(readFileSync(filePath, 'utf8'));
        } catch {
          payload = createDefaultMockPayload(scenarioKey, targetPrNumber);
        }
      } else {
        // Fallback directly to built-in generator so missing file never breaks the simulator
        payload = createDefaultMockPayload(scenarioKey, targetPrNumber);
      }

      if (payload.pull_request) {
        payload.pull_request.number = targetPrNumber;
        payload.pull_request.html_url = `https://github.com/my-org/my-project/pull/${targetPrNumber}`;
        if (scenarioKey === 'open') {
          payload.pull_request.title = `feat: Hỗ trợ tích hợp chạy thử với Bun (PR #${targetPrNumber})`;
        }
      }
      if (payload.workflow_run?.pull_requests?.[0]) {
        payload.workflow_run.pull_requests[0].number = targetPrNumber;
      }
      if (payload.review && payload.pull_request) {
        payload.review.html_url = `https://github.com/my-org/my-project/pull/${targetPrNumber}#pullrequestreview-987654321`;
      }

      const eventData = mapGitHubEvent(scenario.event, payload);
      if (!eventData) {
        res.status(400).json({ error: 'Failed to map event' });
        return;
      }

      await relay.handleEvent(eventData);
      res.json({ success: true, scenario: scenarioKey, event: scenario.event, prNumber: targetPrNumber });
    } catch (err) {
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  return router;
}
