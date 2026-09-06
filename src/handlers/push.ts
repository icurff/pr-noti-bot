/**
 * Push event handler — notifies on direct pushes to the default branch
 */

import { Client, TextChannel } from 'discord.js';
import { StateDb } from '../db/state.js';
import { buildPushEmbed, buildForcePushEmbed } from '../embeds/builders.js';
import { getChannelForEvent, ChannelConfig } from '../config/channels.js';
import { withRetry } from '../utils/retry.js';

export interface PushEventPayload {
  ref: string;
  before: string;
  after: string;
  forced: boolean;
  compare: string;
  created: boolean;
  deleted: boolean;
  commits: Array<{
    id: string;
    message: string;
    author: { name: string; username?: string };
  }>;
  head_commit: { id: string; message: string } | null;
  pusher: { name: string };
  sender: { login: string; avatar_url: string };
  repository: { full_name: string; default_branch: string };
}

// Matches GitHub's default merge commit, squash merge, and branch merge formats
const PR_MERGE_PATTERNS = [
  /^Merge pull request #\d+/i,
  /^Merge branch /i,
  /\(#\d+\)(?:\n|$)/m,
];

export async function handlePushEvent(
  client: Client,
  db: StateDb,
  channelConfig: ChannelConfig,
  payload: PushEventPayload
): Promise<void> {
  const { ref, forced, created, deleted, commits, compare, sender, repository } = payload;
  const repo = repository.full_name;

  // Extract branch name from ref (refs/heads/main → main)
  const branch = ref.replace('refs/heads/', '');

  // Only notify for pushes to the default branch
  if (branch !== repository.default_branch) {
    return;
  }

  // Skip branch creation/deletion events
  if (created || deleted) {
    return;
  }

  // Skip if every commit is a PR merge commit (PR handler covers these)
  if (commits.length > 0 && commits.every(c => PR_MERGE_PATTERNS.some(p => p.test(c.message)))) {
    return;
  }

  // Skip if commits belong to a PR that was just merged in this repo (handles Rebase & Merge)
  if (db.isRecentPrMerge(repo, commits.map(c => c.id))) {
    console.log(`[repo-relay] Skipping push notification for ${repo} because commits belong to a recently merged PR`);
    return;
  }

  const channelId = getChannelForEvent(channelConfig, 'push');
  const channel = await withRetry(() => client.channels.fetch(channelId));
  if (!channel || !(channel instanceof TextChannel)) {
    throw new Error(`Channel ${channelId} not found or not a text channel`);
  }

  db.logEvent(repo, null, forced ? 'push.forced' : 'push', payload);

  let embed;
  if (forced) {
    embed = buildForcePushEmbed(
      branch,
      payload.before,
      payload.after,
      sender.login,
      sender.avatar_url,
      compare
    );
  } else {
    embed = buildPushEmbed(
      branch,
      commits,
      sender.login,
      sender.avatar_url,
      compare
    );
  }

  await withRetry(() => channel.send({ embeds: [embed] }));
}
