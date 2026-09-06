/**
 * App configuration — đọc từ .env
 */

export const config = {
  discordToken: process.env.DISCORD_BOT_TOKEN ?? '',
  githubToken: process.env.GITHUB_TOKEN,

  port: parseInt(process.env.PORT ?? '3000', 10),
  host: process.env.HOST ?? '0.0.0.0',

  webhookPath: process.env.WEBHOOK_PATH ?? '/webhook',
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,

  channels: {
    prs:         process.env.DISCORD_CHANNEL_PRS ?? '',
    issues:      process.env.DISCORD_CHANNEL_ISSUES,
    releases:    process.env.DISCORD_CHANNEL_RELEASES,
    deployments: process.env.DISCORD_CHANNEL_DEPLOYMENTS,
    security:    process.env.DISCORD_CHANNEL_SECURITY,
  },

  stateDir: process.env.STATE_DIR,
};
