/**
 * Discord embed builders for various notification types
 */

import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, type MessageCreateOptions } from 'discord.js';
import type { FailedStep } from '../github/ci.js';
import type { DependabotAlertPayload, SecretScanningAlertPayload, CodeScanningAlertPayload } from '../handlers/security.js';
import { VIBRANT_COLORS, getRandomGif, buildReactionEmbed, areGifsEnabled } from './media.js';

export interface PrData {
  number: number;
  title: string;
  url: string;
  author: string;
  authorUrl: string;
  authorAvatar?: string;
  branch: string;
  baseBranch: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  body?: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  createdAt: string;
  mergedAt?: string;
  mergedBy?: string;
}

export interface CiStatus {
  status: 'pending' | 'running' | 'success' | 'failure' | 'cancelled';
  workflowName?: string;
  conclusion?: string;
  url?: string;
}

export interface ReviewStatus {
  /** Latest human verdict (#146). */
  humanReview?: 'approved' | 'changes_requested' | 'none';
  humanReviewer?: string;
}

/**
 * Generate a visual code diff bar representing additions and deletions.
 * e.g., 🟩🟩🟩🟩🟥 (+120, -30)
 */
export function buildDiffBar(additions: number, deletions: number): string {
  const total = additions + deletions;
  if (total === 0) return '`⬜⬜⬜⬜⬜` *(+0, -0)*';
  const blocks = 5;
  const addRatio = additions / total;
  const addBlocks = Math.min(blocks, Math.max(0, Math.round(addRatio * blocks)));
  const delBlocks = blocks - addBlocks;
  const green = '🟩'.repeat(addBlocks);
  const red = '🟥'.repeat(delBlocks);
  return `${green}${red} *(+${additions}, -${deletions})*`;
}

export function buildPrEmbed(
  pr: PrData,
  ci?: CiStatus,
  reviews?: ReviewStatus
): EmbedBuilder {
  const stateLabel = getPrStateLabel(pr.state, pr.draft);

  const embed = new EmbedBuilder()
    .setColor(getPrColor(pr.state, pr.draft))
    .setTitle(truncateTitle(`PR #${pr.number}: ${pr.title}${stateLabel}`))
    .setURL(pr.url)
    .setAuthor({
      name: pr.author,
      iconURL: pr.authorAvatar,
      url: pr.authorUrl,
    })
    .addFields(
      {
        name: 'Branch',
        value: `\`${pr.branch}\` ➔ \`${pr.baseBranch}\``,
        inline: true,
      },
      {
        name: 'Changes',
        value: `${pr.changedFiles} files • ${buildDiffBar(pr.additions, pr.deletions)}`,
        inline: true,
      }
    )
    .setTimestamp(new Date(pr.createdAt));

  // Add review section
  const reviewStatusText = reviews?.humanReview && reviews.humanReview !== 'none'
    ? getHumanReviewStatus(reviews.humanReview, reviews.humanReviewer)
    : '*Awaiting Review*';

  embed.addFields({
    name: 'Reviews',
    value: reviewStatusText,
    inline: false,
  });

  // Add CI section
  const ciStatus = ci ? getCiStatusText(ci) : '*Pending*';
  embed.addFields({
    name: 'CI Status',
    value: ciStatus,
    inline: false,
  });

  // Add merged info if applicable
  if (pr.state === 'merged' && pr.mergedAt) {
    embed.addFields({
      name: 'Merged',
      value: `${pr.mergedBy ? `by **@${pr.mergedBy}** ` : ''}on ${new Date(pr.mergedAt).toLocaleString()}`,
      inline: false,
    });

    if (areGifsEnabled()) {
      embed.setImage(getRandomGif('merged'));
    }
  }

  return embed;
}

export function buildPrComponents(prUrl: string, ciUrl?: string): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  row.addComponents(
    new ButtonBuilder().setLabel('View PR').setStyle(ButtonStyle.Link).setURL(prUrl),
    new ButtonBuilder().setLabel('View Diff').setStyle(ButtonStyle.Link).setURL(`${prUrl}/files`),
  );
  if (ciUrl) {
    row.addComponents(
      new ButtonBuilder().setLabel('View CI').setStyle(ButtonStyle.Link).setURL(ciUrl),
    );
  }
  return row;
}

export function buildPushReply(
  author: string,
  sha: string,
  compareUrl?: string
): string {
  const shaShort = sha.substring(0, 7);
  const link = compareUrl ? `[\`${shaShort}\`](${compareUrl})` : `\`${shaShort}\``;
  return `**Push by @${author}** • (${link})`;
}

export function buildCiReplyText(ci: CiStatus): string {
  const statusLabel = ci.status === 'success' ? 'Passed' : ci.status === 'failure' ? 'Failed' : ci.status === 'running' ? 'Running...' : 'Pending';
  const workflowLabel = ci.workflowName ? `\`${ci.workflowName}\`` : '`CI`';
  return `**CI Workflow: ${statusLabel}** • ${workflowLabel}`;
}

export function buildCiReply(ci: CiStatus): MessageCreateOptions {
  const content = buildCiReplyText(ci);
  const embeds = [];
  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  if (areGifsEnabled()) {
    if (ci.status === 'success') {
      embeds.push(buildReactionEmbed('merged', 'CI Passed All Checks'));
    } else if (ci.status === 'failure') {
      embeds.push(buildReactionEmbed('needs_work', 'CI Run Failed'));
    }
  }

  if (ci.url) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('View Run')
        .setStyle(ButtonStyle.Link)
        .setURL(ci.url)
    );
    components.push(row);
  }

  return {
    content,
    ...(embeds.length > 0 ? { embeds } : {}),
    ...(components.length > 0 ? { components } : {}),
  };
}

const MESSAGE_LIMIT = 2000; // Discord message content hard cap

export function buildCiFailureReply(ci: CiStatus, failedSteps: FailedStep[]): MessageCreateOptions {
  const base = buildCiReplyText(ci);
  let content = base;
  if (failedSteps.length > 0) {
    const maxDisplay = 5;
    const maxNameLength = 80; // matrix job names can be arbitrarily long
    const lines = failedSteps.slice(0, maxDisplay).map(
      s => `> \`${truncateDescription(s.jobName, maxNameLength)}\` ➔ \`${truncateDescription(s.stepName, maxNameLength)}\``
    );
    if (failedSteps.length > maxDisplay) {
      lines.push(`> *...and ${failedSteps.length - maxDisplay} more failed steps*`);
    }
    content = `${base}\n\n**Failed steps:**\n${lines.join('\n')}`;
    // Belt-and-suspenders: never exceed the message limit regardless of inputs
    if (content.length > MESSAGE_LIMIT) {
      content = content.substring(0, MESSAGE_LIMIT - 1) + '…';
    }
  }

  const embeds = [];
  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  if (areGifsEnabled()) {
    embeds.push(buildReactionEmbed('needs_work', 'CI Build Failed'));
  }

  if (ci.url) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('View Run')
        .setStyle(ButtonStyle.Link)
        .setURL(ci.url)
    );
    components.push(row);
  }

  return {
    content,
    ...(embeds.length > 0 ? { embeds } : {}),
    ...(components.length > 0 ? { components } : {}),
  };
}

export function buildReviewReply(
  type: 'human' | string,
  status: string,
  comments?: number,
  url?: string,
  reviewer?: string
): MessageCreateOptions {
  const isApproved = status === 'approved';
  const label = isApproved ? 'Approved' : 'Changes Requested';
  const reviewerText = reviewer ? `@${reviewer}` : 'Reviewer';
  const content = `**Review by ${reviewerText}** • **${label}**`;

  const embeds = [];
  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  if (areGifsEnabled()) {
    const category = isApproved ? 'approved' : 'needs_work';
    const title = isApproved
      ? `Approved by @${reviewer ?? 'Reviewer'}`
      : `Changes Requested by @${reviewer ?? 'Reviewer'}`;
    const color = isApproved ? VIBRANT_COLORS.EMERALD : VIBRANT_COLORS.AMBER;
    embeds.push(buildReactionEmbed(category, title, color));
  }

  if (url) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('View Review')
        .setStyle(ButtonStyle.Link)
        .setURL(url)
    );
    components.push(row);
  }

  return {
    content,
    ...(embeds.length > 0 ? { embeds } : {}),
    ...(components.length > 0 ? { components } : {}),
  };
}

export function buildMergedReply(mergedBy?: string, baseBranch?: string): MessageCreateOptions {
  const byText = mergedBy ? ` by **@${mergedBy}**` : '';
  const content = `**PR Merged to \`${baseBranch ?? 'main'}\`**${byText}`;
  const embeds = [];
  if (areGifsEnabled()) {
    embeds.push(buildReactionEmbed('merged', 'PR Merged & Shipped', VIBRANT_COLORS.PURPLE));
  }
  return {
    content,
    ...(embeds.length > 0 ? { embeds } : {}),
  };
}

export function buildClosedReply(closedBy?: string): MessageCreateOptions {
  const byText = closedBy ? ` by **@${closedBy}**` : '';
  return {
    content: `**PR Closed without merging**${byText}`,
  };
}

export interface IssueData {
  number: number;
  title: string;
  url: string;
  author: string;
  authorAvatar?: string;
  state: 'open' | 'closed';
  stateReason?: string | null;
  labels: string[];
  body?: string;
  createdAt: string;
}

export function buildIssueEmbed(issue: IssueData): EmbedBuilder {
  const isOpen = issue.state === 'open';
  const stateLabel = getIssueStateLabel(issue.state, issue.stateReason);

  const embed = new EmbedBuilder()
    .setColor(isOpen ? VIBRANT_COLORS.EMERALD : VIBRANT_COLORS.PURPLE)
    .setTitle(truncateTitle(`Issue #${issue.number}: ${issue.title}${stateLabel}`))
    .setURL(issue.url)
    .setAuthor({
      name: issue.author,
      iconURL: issue.authorAvatar,
    })
    .setTimestamp(new Date(issue.createdAt));

  if (issue.labels.length > 0) {
    embed.addFields({
      name: 'Labels',
      value: formatLabelsField(issue.labels),
      inline: false,
    });
  }

  if (issue.body && issue.body.length > 0) {
    embed.setDescription(safeDescription(issue.body, 200));
  }

  return embed;
}

export function buildIssueClosedReply(closedBy?: string, stateReason?: string | null): string {
  const byText = closedBy ? ` by @${closedBy}` : '';
  if (stateReason === 'not_planned') {
    return `**Closed as not planned**${byText}`;
  }
  return `**Issue Closed**${byText}`;
}

export function buildIssueReopenedReply(reopenedBy?: string): string {
  const byText = reopenedBy ? ` by @${reopenedBy}` : '';
  return `**Issue Reopened**${byText}`;
}

export function buildReleaseEmbed(
  name: string,
  tagName: string,
  url: string,
  author: string,
  authorAvatar: string | undefined,
  body?: string,
  prerelease?: boolean
): EmbedBuilder {
  const label = prerelease ? ' `[PRE-RELEASE]`' : '';

  const embed = new EmbedBuilder()
    .setColor(prerelease ? VIBRANT_COLORS.AMBER : VIBRANT_COLORS.INDIGO)
    .setTitle(truncateTitle(`Release: ${name}${label}`))
    .setURL(url)
    .setAuthor({
      name: author,
      iconURL: authorAvatar,
    })
    .addFields({
      name: 'Tag',
      value: `\`${tagName}\``,
      inline: true,
    });

  if (body && body.length > 0) {
    embed.setDescription(safeDescription(body, 500));
  }

  if (!prerelease && areGifsEnabled()) {
    embed.setThumbnail(getRandomGif('merged'));
  }

  return embed;
}

export function buildDeploymentEmbed(
  state: 'success' | 'failure' | 'error' | 'pending' | 'in_progress' | 'queued' | 'inactive',
  environment: string,
  ref: string,
  sha: string,
  author: string,
  authorAvatar: string | undefined,
  description?: string,
  targetUrl?: string
): EmbedBuilder {
  const isSuccess = state === 'success';
  const isFailure = state === 'failure' || state === 'error';
  const title = isSuccess
    ? `Deployed to ${environment} successfully`
    : isFailure
      ? `Deploy Failed: ${environment}`
      : `Deploying to ${environment}...`;

  const color = isSuccess ? VIBRANT_COLORS.EMERALD : isFailure ? VIBRANT_COLORS.CORAL : VIBRANT_COLORS.AMBER;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(truncateTitle(title))
    .setAuthor({
      name: author,
      iconURL: authorAvatar,
    })
    .addFields(
      { name: 'Environment', value: `\`${environment}\``, inline: true },
      { name: 'Ref', value: `\`${ref}\``, inline: true },
      { name: 'Commit', value: `\`${sha.substring(0, 7)}\``, inline: true },
      { name: 'Status', value: `**${capitalize(state)}**`, inline: true }
    );

  if (description) {
    embed.setDescription(safeDescription(description, 500));
  }

  if (targetUrl) {
    embed.setURL(targetUrl);
  }

  if (isSuccess && areGifsEnabled()) {
    embed.setThumbnail(getRandomGif('merged'));
  } else if (isFailure && areGifsEnabled()) {
    embed.setThumbnail(getRandomGif('needs_work'));
  }

  return embed;
}

export function buildPushEmbed(
  branch: string,
  commits: Array<{ id: string; message: string }>,
  sender: string,
  senderAvatar: string,
  compareUrl: string
): EmbedBuilder {
  const maxDisplay = 5;
  const commitLines = commits.slice(0, maxDisplay).map(c => {
    const sha = c.id.substring(0, 7);
    const firstLine = escapeMaskedLinks(c.message.split('\n')[0]);
    const truncated = firstLine.length > 100 ? firstLine.substring(0, 97) + '...' : firstLine;
    return `\`${sha}\` ${truncated}`;
  });

  if (commits.length > maxDisplay) {
    commitLines.push(`and ${commits.length - maxDisplay} more...`);
  }

  return new EmbedBuilder()
    .setColor(VIBRANT_COLORS.AMBER)
    .setTitle(truncateTitle(`Push to ${branch}`))
    .setAuthor({ name: sender, iconURL: senderAvatar })
    .setDescription(commitLines.join('\n'))
    .addFields({ name: 'Compare', value: `[View changes](${compareUrl})`, inline: false });
}

export function buildForcePushEmbed(
  branch: string,
  beforeSha: string,
  afterSha: string,
  sender: string,
  senderAvatar: string,
  compareUrl: string
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(VIBRANT_COLORS.CORAL)
    .setTitle(truncateTitle(`Force Push to ${branch}`))
    .setAuthor({ name: sender, iconURL: senderAvatar })
    .addFields(
      { name: 'Before', value: `\`${beforeSha.substring(0, 7)}\``, inline: true },
      { name: 'After', value: `\`${afterSha.substring(0, 7)}\``, inline: true },
      { name: 'Compare', value: `[View changes](${compareUrl})`, inline: false }
    );
}

// Security alert embeds

const SEVERITY_COLORS: Record<string, number> = {
  critical: 0x991B1B, // Deep Crimson
  high: VIBRANT_COLORS.CORAL,
  error: VIBRANT_COLORS.CORAL,
  medium: VIBRANT_COLORS.AMBER,
  warning: VIBRANT_COLORS.AMBER,
  low: VIBRANT_COLORS.SLATE,
  note: VIBRANT_COLORS.SLATE,
  none: VIBRANT_COLORS.SLATE,
};

export function buildDependabotAlertEmbed(payload: DependabotAlertPayload): EmbedBuilder {
  const { alert } = payload;
  const severity = alert.security_advisory.severity;
  const pkg = alert.dependency.package.name;
  const fixVersion = alert.security_vulnerability.first_patched_version?.identifier;

  const embed = new EmbedBuilder()
    .setColor(SEVERITY_COLORS[severity] ?? VIBRANT_COLORS.SLATE)
    .setTitle(truncateTitle(`Dependabot: ${capitalize(severity)} vulnerability in ${pkg}`))
    .setURL(alert.html_url)
    .setDescription(safeDescription(alert.security_advisory.summary, 4096))
    .addFields(
      { name: 'Severity', value: capitalize(severity), inline: true },
      { name: 'Package', value: `\`${pkg}\` (${alert.dependency.package.ecosystem})`, inline: true },
    );

  if (alert.security_advisory.cve_id) {
    embed.addFields({ name: 'CVE', value: alert.security_advisory.cve_id, inline: true });
  }

  embed.addFields({
    name: 'Fix Available',
    value: fixVersion ? `Upgrade to \`${fixVersion}\`` : 'No fix available',
    inline: true,
  });

  if ((severity === 'critical' || severity === 'high') && areGifsEnabled()) {
    embed.setThumbnail(getRandomGif('needs_work'));
  }

  return embed;
}

export function buildSecretScanningAlertEmbed(payload: SecretScanningAlertPayload): EmbedBuilder {
  const { alert } = payload;

  const bypassValue = alert.push_protection_bypassed === true
    ? 'Bypassed'
    : alert.push_protection_bypassed === false
      ? 'Active'
      : '—';

  const embed = new EmbedBuilder()
    .setColor(VIBRANT_COLORS.CORAL)
    .setTitle(truncateTitle(`Secret Detected: ${alert.secret_type_display_name}`))
    .setURL(alert.html_url)
    .addFields(
      { name: 'Secret Type', value: alert.secret_type_display_name, inline: true },
      { name: 'Push Protection', value: bypassValue, inline: true },
    );

  if (areGifsEnabled()) {
    embed.setThumbnail(getRandomGif('needs_work'));
  }

  return embed;
}

export function buildCodeScanningAlertEmbed(payload: CodeScanningAlertPayload): EmbedBuilder {
  const { alert } = payload;
  const severity = alert.rule.severity;
  const location = alert.most_recent_instance.location;

  return new EmbedBuilder()
    .setColor(SEVERITY_COLORS[severity] ?? VIBRANT_COLORS.SLATE)
    .setTitle(truncateTitle(`Code Scanning: ${alert.rule.name}`))
    .setURL(alert.html_url)
    .setDescription(safeDescription(alert.rule.description, 200))
    .addFields(
      { name: 'Rule', value: `\`${alert.rule.id}\``, inline: true },
      { name: 'Severity', value: capitalize(severity), inline: true },
      { name: 'Tool', value: alert.tool.name, inline: true },
      { name: 'Location', value: `\`${location.path}:${location.start_line}\``, inline: true },
    );
}

// Helper functions

function getPrEmoji(state: 'open' | 'closed' | 'merged', draft: boolean): string {
  if (draft) return '📝';
  switch (state) {
    case 'open':
      return '🔀';
    case 'merged':
      return '✅';
    case 'closed':
      return '🚫';
  }
}

function getPrStateLabel(
  state: 'open' | 'closed' | 'merged',
  draft: boolean
): string {
  if (draft) return ' `[DRAFT]`';
  if (state === 'merged') return ' `[MERGED]`';
  if (state === 'closed') return ' `[CLOSED]`';
  return '';
}

function getPrColor(
  state: 'open' | 'closed' | 'merged',
  draft: boolean
): number {
  if (draft) return VIBRANT_COLORS.SLATE;
  switch (state) {
    case 'open':
      return VIBRANT_COLORS.EMERALD;
    case 'merged':
      return VIBRANT_COLORS.PURPLE;
    case 'closed':
      return VIBRANT_COLORS.CORAL;
  }
}

function getHumanReviewStatus(
  status: 'approved' | 'changes_requested',
  reviewer?: string
): string {
  const label = status === 'approved' ? '**Approved**' : '**Changes Requested**';
  return reviewer ? `${label} by @${reviewer}` : label;
}


function getCiStatusText(ci: CiStatus): string {
  const name = ci.workflowName ? ` *(${ci.workflowName})*` : '';

  switch (ci.status) {
    case 'pending':
      return `*Pending*${name}`;
    case 'running':
      return `**Running...**${name}`;
    case 'success':
      return `**Passed**${name}`;
    case 'failure':
      return `**Failed**${name}`;
    case 'cancelled':
      return `**Cancelled**${name}`;
  }
}

function getIssueStateLabel(state: 'open' | 'closed', stateReason?: string | null): string {
  if (state === 'closed') {
    return stateReason === 'not_planned' ? ' [NOT PLANNED]' : ' [CLOSED]';
  }
  return '';
}

function truncateTitle(title: string): string {
  return title.length > 256 ? title.substring(0, 255) + '…' : title;
}

const THREAD_NAME_LIMIT = 100; // Discord hard cap — exceeding it is an API 400

/**
 * Build a thread name that fits Discord's 100-char limit. The prefix length
 * varies with the entity number, so the title budget must be computed from
 * the full name — truncating the title alone overflows for large numbers.
 */
export function buildThreadName(kind: 'PR' | 'Issue', number: number, title: string): string {
  const prefix = `${kind} #${number}: `;
  const room = THREAD_NAME_LIMIT - prefix.length;
  const fitted = title.length > room ? title.substring(0, Math.max(room - 1, 0)) + '…' : title;
  // Unconditional clamp: an absurdly large entity number could leave no room
  return (prefix + fitted).substring(0, THREAD_NAME_LIMIT);
}

const FIELD_VALUE_LIMIT = 1024; // Discord embed field value hard cap

/** Join backtick-wrapped labels, capping at the field limit with a "+N more" tail. */
function formatLabelsField(labels: string[]): string {
  const parts: string[] = [];
  let length = 0;
  for (let i = 0; i < labels.length; i++) {
    const piece = `\`${labels[i]}\``;
    // Reserve room for the separator and the actual "+N more" tail
    const tail = `+${labels.length - i} more`;
    const reserve = i < labels.length - 1 ? tail.length + 1 : 0;
    if (length + piece.length + 1 + reserve > FIELD_VALUE_LIMIT) {
      parts.push(tail);
      break;
    }
    parts.push(piece);
    length += piece.length + 1;
  }
  // Unconditional clamp — the cap must hold for any inputs
  const joined = parts.join(' ');
  return joined.length > FIELD_VALUE_LIMIT ? joined.substring(0, FIELD_VALUE_LIMIT) : joined;
}

function truncateDescription(text: string, maxLength: number): string {
  return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
}

/**
 * Neutralize markdown masked links. Discord renders [text](url) inside embed
 * descriptions, letting untrusted GitHub content (issue bodies, release notes,
 * commit messages) display disguised phishing links with the bot's credibility.
 * Escaping the opening bracket breaks link rendering; Discord shows it as "[".
 */
function escapeMaskedLinks(text: string): string {
  return text.replace(/\[/g, '\\[');
}

/** Sanitize + length-cap untrusted text bound for an embed description. */
function safeDescription(text: string, maxLength: number): string {
  return truncateDescription(escapeMaskedLinks(text), maxLength);
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function extractRepoFromUrl(url: string): string | null {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)\//);
  return match ? match[1] : null;
}

// Footer metadata for state recovery

const FOOTER_PREFIX = 'repo-relay:v1:';

export interface PrFooterMetadata {
  type: 'pr';
  pr: number;
  repo: string;
  ci: CiStatus['status'];
  copilot?: string;
  copilotComments?: number;
  agent?: string;
  /** Present only when a human verdict exists — pre-#146 footers lack it. */
  human?: 'approved' | 'changes_requested';
  humanBy?: string;
}

export interface IssueFooterMetadata {
  type: 'issue';
  issue: number;
  repo: string;
}

export type FooterMetadata = PrFooterMetadata | IssueFooterMetadata;

function encodeFooter(data: FooterMetadata): string {
  return `${FOOTER_PREFIX}${JSON.stringify(data)}`;
}

export function parseFooterMetadata(footerText: string): FooterMetadata | null {
  if (!footerText.startsWith(FOOTER_PREFIX)) return null;
  try {
    return JSON.parse(footerText.slice(FOOTER_PREFIX.length)) as FooterMetadata;
  } catch {
    return null;
  }
}
