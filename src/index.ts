/**
 * Repo Relay - GitHub-Discord Integration Bot
 *
 * Entry point for the bot library.
 */

import { Client, Events, GatewayIntentBits, GuildChannel, PermissionsBitField, REST, Routes } from 'discord.js';
import { StateDb } from './db/state.js';
import { type ChannelConfig } from './config/channels.js';
import { setActiveMediaDb } from './embeds/media.js';
import {
  handlePrEvent,
  handleCiEvent,
  handleReviewEvent,
  handleIssueEvent,
  handleReleaseEvent,
  handleDeploymentEvent,
  handlePushEvent,
  handleSecurityAlertEvent,
  type PrEventPayload,
  type WorkflowRunPayload,
  type PrReviewPayload,
  type IssueEventPayload,
  type ReleaseEventPayload,
  type DeploymentStatusPayload,
  type PushEventPayload,
  type DependabotAlertPayload,
  type SecretScanningAlertPayload,
  type CodeScanningAlertPayload,
} from './handlers/index.js';
import { ConfigError, safeErrorMessage } from './utils/errors.js';
import { isConfigError } from './utils/discord-errors.js';
import { REPO_NAME_PATTERN } from './utils/validation.js';
import { withRetry } from './utils/retry.js';

export interface RepoRelayConfig {
  discordToken: string;
  githubToken?: string;
  channelConfig: ChannelConfig;
  stateDir?: string;
}

export type GitHubEventPayload =
  | { event: 'pull_request'; payload: PrEventPayload }
  | { event: 'workflow_run'; payload: WorkflowRunPayload }
  | { event: 'pull_request_review'; payload: PrReviewPayload }
  | { event: 'issues'; payload: IssueEventPayload }
  | { event: 'release'; payload: ReleaseEventPayload }
  | { event: 'deployment_status'; payload: DeploymentStatusPayload }
  | { event: 'push'; payload: PushEventPayload }
  | { event: 'dependabot_alert'; payload: DependabotAlertPayload }
  | { event: 'secret_scanning_alert'; payload: SecretScanningAlertPayload }
  | { event: 'code_scanning_alert'; payload: CodeScanningAlertPayload };

export { REPO_NAME_PATTERN };

/** Hard deadline for the gateway ready event after login. */
const READY_TIMEOUT_MS = 60_000;

const REQUIRED_PERMISSIONS = [
  { flag: PermissionsBitField.Flags.SendMessages, name: 'Send Messages' },
  { flag: PermissionsBitField.Flags.EmbedLinks, name: 'Embed Links' },
  { flag: PermissionsBitField.Flags.ReadMessageHistory, name: 'Read Message History' },
];

function parseSessionLimitReset(error: unknown): Date | null {
  if (!(error instanceof Error)) return null;
  const match = error.message.match(/Not enough sessions remaining.*resets at (\S+)/);
  if (!match) return null;
  const date = new Date(match[1]);
  return isNaN(date.getTime()) ? null : date;
}

export class RepoRelay {
  private client: Client;
  private db: StateDb | null = null;
  private config: RepoRelayConfig;
  private repo: string | null = null;

  constructor(config: RepoRelayConfig) {
    this.config = config;
    this.client = this.createClient();
  }

  private createClient(): Client {
    // Guilds alone suffices: the bot consumes no message gateway events and
    // all reads/writes go through REST
    const client = new Client({
      intents: [GatewayIntentBits.Guilds],
    });
    // A listener-less 'error' emit crashes the process with a raw stack,
    // bypassing safeErrorMessage — always keep sanitized listeners attached
    client.on(Events.Error, (err) => {
      console.error(`[repo-relay] Discord client error: ${safeErrorMessage(err)}`);
    });
    client.on(Events.Warn, (msg) => {
      console.log(`[repo-relay] Discord client warning: ${msg}`);
    });
    return client;
  }

  async connect(): Promise<void> {
    await this.logSessionBudget();

    const parsed = parseInt(process.env.REPO_RELAY_SESSION_MAX_WAIT ?? '', 10);
    const maxWaitMs = isNaN(parsed) ? 300_000 : Math.max(0, parsed);

    const maxRetries = 3;
    for (let attempt = 0; ; attempt++) {
      try {
        await new Promise<void>((resolve, reject) => {
          // Hard deadline: if login resolves but ready never fires (gateway
          // flap), a fire-once CLI must fail fast, not hang to the job timeout
          const timeout = setTimeout(
            () => reject(new Error(`Discord ready event not received within ${READY_TIMEOUT_MS / 1000}s`)),
            READY_TIMEOUT_MS
          );
          this.client.once(Events.ClientReady, () => {
            clearTimeout(timeout);
            resolve();
          });
          this.client.login(this.config.discordToken).catch((err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });
        break;
      } catch (error) {
        const resetAt = parseSessionLimitReset(error);
        if (!resetAt) throw error;

        if (attempt >= maxRetries) {
          throw new Error(
            `Session limit retry exhausted after ${maxRetries} attempts. ` +
            `Resets at ${resetAt.toISOString()}. Re-run this job after the reset.`
          );
        }

        const waitMs = resetAt.getTime() - Date.now();
        if (waitMs <= 0) {
          console.log(`[repo-relay] Session limit reset time has passed, retrying immediately (attempt ${attempt + 1}/${maxRetries})...`);
          await this.client.destroy();
          this.client = this.createClient();
          continue;
        }

        if (waitMs > maxWaitMs) {
          throw new Error(
            `Session limit exhausted. Resets at ${resetAt.toISOString()} (${Math.ceil(waitMs / 60_000)}min away), ` +
            `which exceeds max wait of ${Math.ceil(maxWaitMs / 60_000)}min. Re-run this job after the reset.`
          );
        }

        const waitMin = (waitMs / 60_000).toFixed(1);
        console.log(`[repo-relay] Session limit exhausted. Waiting ${waitMin}min until reset at ${resetAt.toISOString()}...`);
        await new Promise(r => setTimeout(r, waitMs + 1000)); // +1s buffer
        await this.client.destroy();
        this.client = this.createClient();
      }
    }

    console.log(`[repo-relay] Connected to Discord as ${this.client.user?.tag}`);
  }

  private async logSessionBudget(): Promise<void> {
    if (!process.env.REPO_RELAY_LOG_SESSION_BUDGET) return;
    try {
      const rest = new REST().setToken(this.config.discordToken);
      const data = await rest.get(Routes.gatewayBot()) as {
        session_start_limit: {
          total: number;
          remaining: number;
          reset_after: number;
        };
      };
      const { remaining, total } = data.session_start_limit;
      const pct = total > 0 ? Math.round((remaining / total) * 100) : 0;
      console.log(`[repo-relay] Session budget: ${remaining}/${total} (${pct}%)`);

      if (remaining <= 10) {
        console.log(`[repo-relay] WARNING: Session budget critically low (${remaining} remaining)`);
      } else if (pct <= 20) {
        console.log(`[repo-relay] WARNING: Session budget below 20% (${remaining}/${total})`);
      }
    } catch (err) {
      console.log(
        '[repo-relay] Could not fetch session budget (non-fatal):',
        safeErrorMessage(err),
      );
    }
  }

  async validatePermissions(): Promise<void> {
    const requiredNames = REQUIRED_PERMISSIONS.map((p) => p.name).join(', ');

    // Collect unique channel IDs
    const { prs, issues, releases, deployments, security } = this.config.channelConfig;
    const channelIds = [...new Set([prs, issues, releases, deployments, security].filter(Boolean) as string[])];

    const errors: string[] = [];

    for (const channelId of channelIds) {
      let channel;
      try {
        channel = await withRetry(() => this.client.channels.fetch(channelId));
      } catch (error) {
        // Only fold definitive config errors (bad auth, unknown channel) into
        // the aggregate ConfigError below; transient trouble (exhausted 5xx
        // retries, network) must propagate raw so best-effort delivery can
        // classify it as infrastructure, not configuration
        if (!isConfigError(error)) throw error;
        errors.push(
          `[repo-relay] ERROR: Could not access channel ${channelId}\n` +
          `  The channel may not exist or the bot may not have access to it.`
        );
        continue;
      }

      if (!channel || !('guild' in channel)) {
        errors.push(
          `[repo-relay] ERROR: Channel ${channelId} is not a guild text channel`
        );
        continue;
      }

      const guildChannel = channel as GuildChannel;
      const me = guildChannel.guild.members.me;
      if (!me) {
        errors.push(
          `[repo-relay] ERROR: Could not resolve bot member in guild for channel ${channelId}`
        );
        continue;
      }

      const permissions = guildChannel.permissionsFor(me);
      if (!permissions) {
        errors.push(
          `[repo-relay] ERROR: Could not resolve permissions for channel ${channelId}`
        );
        continue;
      }

      const missing = REQUIRED_PERMISSIONS
        .filter((p) => !permissions.has(p.flag))
        .map((p) => p.name);

      if (missing.length > 0) {
        errors.push(
          `[repo-relay] ERROR: Bot lacks permissions in channel ${channelId}\n` +
          `  Missing: ${missing.join(', ')}\n` +
          `  Required: ${requiredNames}`
        );
      }
    }

    if (errors.length > 0) {
      const message = errors.join('\n');
      console.error(message);
      throw new ConfigError(
        `Missing Discord permissions in ${errors.length} channel(s). See logs above for details.`
      );
    }

    console.log('[repo-relay] Permission check passed for all channels');
  }

  isReady(): boolean {
    return this.client.isReady();
  }

  async disconnect(): Promise<void> {
    try {
      this.db?.close();
    } catch (error) {
      // A DB close failure must not skip the gateway teardown below — a live
      // gateway socket would hold the event loop open until the job timeout
      console.log(`[repo-relay] State DB close failed (non-fatal): ${safeErrorMessage(error)}`);
    }
    // destroy() is async — exiting before the gateway close handshake wastes
    // a resumable session, which matters against the 1000/day identify budget
    await this.client.destroy();
    console.log('[repo-relay] Disconnected from Discord');
  }

  async handleEvent(eventData: GitHubEventPayload): Promise<void> {
    // Extract repo from payload
    const repo = this.extractRepo(eventData);
    if (!repo) {
      throw new Error('Could not extract repository from event payload');
    }

    // Initialize or switch DB if repo changed
    if (this.repo !== repo) {
      this.db?.close();
      this.db = new StateDb(repo, this.config.stateDir);
      this.repo = repo;
      setActiveMediaDb(this.db);
    }

    console.log(`[repo-relay] Handling ${eventData.event} event for ${repo}`);

    // TypeScript narrowing ensures db is initialized after the block above
    const db = this.db!;

    switch (eventData.event) {
      case 'pull_request':
        await handlePrEvent(
          this.client,
          db,
          this.config.channelConfig,
          eventData.payload
        );
        break;

      case 'workflow_run':
        await handleCiEvent(
          this.client,
          db,
          this.config.channelConfig,
          eventData.payload,
          this.config.githubToken
        );
        break;

      case 'pull_request_review':
        await handleReviewEvent(
          this.client,
          db,
          this.config.channelConfig,
          eventData.payload
        );
        break;

      case 'issues':
        await handleIssueEvent(
          this.client,
          db,
          this.config.channelConfig,
          eventData.payload
        );
        break;

      case 'release':
        await handleReleaseEvent(
          this.client,
          db,
          this.config.channelConfig,
          eventData.payload
        );
        break;

      case 'deployment_status':
        await handleDeploymentEvent(
          this.client,
          db,
          this.config.channelConfig,
          eventData.payload
        );
        break;

      case 'push':
        await handlePushEvent(
          this.client,
          db,
          this.config.channelConfig,
          eventData.payload
        );
        break;

      case 'dependabot_alert':
      case 'secret_scanning_alert':
      case 'code_scanning_alert':
        await handleSecurityAlertEvent(
          this.client,
          db,
          this.config.channelConfig,
          eventData
        );
        break;

      default:
        console.log(`[repo-relay] Unknown event type, skipping`);
    }
  }

  private extractRepo(eventData: GitHubEventPayload): string | null {
    let repo: string | null = null;
    switch (eventData.event) {
      case 'pull_request':
      case 'workflow_run':
      case 'pull_request_review':
      case 'issues':
      case 'release':
      case 'deployment_status':
      case 'push':
      case 'dependabot_alert':
      case 'secret_scanning_alert':
      case 'code_scanning_alert':
        repo = eventData.payload.repository.full_name;
        break;
      default:
        return null;
    }
    if (!repo || !REPO_NAME_PATTERN.test(repo)) {
      return null;
    }
    return repo;
  }

  getClient(): Client {
    return this.client;
  }

  getDb(repoName?: string): StateDb {
    const repo = repoName ?? this.repo ?? process.env.GITHUB_REPOSITORY ?? 'my-org/my-project';
    if (!this.db || this.repo !== repo) {
      this.db?.close();
      this.repo = repo;
      this.db = new StateDb(repo, this.config.stateDir);
      setActiveMediaDb(this.db);
    }
    return this.db;
  }

  getConfig(): RepoRelayConfig {
    return this.config;
  }
}

// Re-export types and utilities
export { StateDb } from './db/state.js';
export { getChannelConfig, type ChannelConfig } from './config/channels.js';
export * from './embeds/builders.js';
export * from './handlers/index.js';

export function mapGitHubEvent(eventName: string, payload: unknown): GitHubEventPayload | null {
  switch (eventName) {
    case 'pull_request':          return { event: 'pull_request',          payload: payload as PrEventPayload };
    case 'workflow_run':          return { event: 'workflow_run',          payload: payload as WorkflowRunPayload };
    case 'pull_request_review':   return { event: 'pull_request_review',   payload: payload as PrReviewPayload };
    case 'issues':                return { event: 'issues',                payload: payload as IssueEventPayload };
    case 'release':               return { event: 'release',               payload: payload as ReleaseEventPayload };
    case 'deployment_status':     return { event: 'deployment_status',     payload: payload as DeploymentStatusPayload };
    case 'push':                  return { event: 'push',                  payload: payload as PushEventPayload };
    case 'dependabot_alert':      return { event: 'dependabot_alert',      payload: payload as DependabotAlertPayload };
    case 'secret_scanning_alert': return { event: 'secret_scanning_alert', payload: payload as SecretScanningAlertPayload };
    case 'code_scanning_alert':   return { event: 'code_scanning_alert',   payload: payload as CodeScanningAlertPayload };
    default:                      return null;
  }
}
