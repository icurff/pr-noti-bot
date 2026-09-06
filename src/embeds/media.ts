/**
 * Media library for Discord reaction GIFs.
 * 4 categories: merged / opened / approved / needs_work — giống example webex-bot.
 */

import { EmbedBuilder } from 'discord.js';

export type ReactionCategory = 'merged' | 'opened' | 'approved' | 'needs_work';

const GIF_POOLS: Record<ReactionCategory, string[]> = {
  merged: [
    'https://i.giphy.com/26u4cqiYI30juCOGY.gif', // Minions cheering
    'https://i.giphy.com/artj92V8o75VPL7AeQ.gif', // High five victory
    'https://i.giphy.com/3o7abKhOpu0NwenH3O.gif', // Leo DiCaprio toast
    'https://i.giphy.com/g9582DNuQppxC.gif',     // Gatsby celebration
    'https://i.giphy.com/10uEX5kfeodYgo.gif',     // Borat great success
  ],
  opened: [
    'https://i.giphy.com/LmN8OYiY4m0X85K0Zz.gif', // Let's do this
    'https://i.giphy.com/b5LTssxCLpvVe.gif',     // Hacker typing fast
    'https://i.giphy.com/nbvFVPiEiJH6JOGIok.gif', // Clapping
    'https://i.giphy.com/111ebonMs90YLu.gif',     // Thumbs up
  ],
  approved: [
    'https://i.giphy.com/diUKszNTUghVe.gif',     // Chuck Norris thumbs up (Verified)
    'https://i.giphy.com/111ebonMs90YLu.gif',     // Thumbs up classic (Verified)
    'https://i.giphy.com/13G7mmmG4GYvEU.gif',     // Obama thumbs up (Verified)
  ],
  needs_work: [
    'https://i.giphy.com/3o7TKwmnDgQb5jemjK.gif', // Wagging finger no
    'https://i.giphy.com/puOukoEvH4uAw.gif',     // Hold up wait a minute
    'https://i.giphy.com/l4pT0NtPSMV3pwJ20.gif', // Deep thinking
    'https://i.giphy.com/QMHoU66sBXCAHonOmG.gif', // This is fine dog
  ],
};

export const VIBRANT_COLORS = {
  EMERALD: 0x10B981,
  PURPLE:  0x8B5CF6,
  CORAL:   0xEF4444,
  AMBER:   0xF59E0B,
  CYAN:    0x06B6D4,
  SLATE:   0x64748B,
  INDIGO:  0x6366F1,
  BLUE:    0x3B82F6,
} as const;

const CATEGORY_COLORS: Record<ReactionCategory, number> = {
  merged:     VIBRANT_COLORS.PURPLE,
  opened:     VIBRANT_COLORS.EMERALD,
  approved:   VIBRANT_COLORS.EMERALD,
  needs_work: VIBRANT_COLORS.AMBER,
};

let activeMediaDb: { getRandomReactionMedia: (cat: string) => { url: string } | null } | null = null;

export function setActiveMediaDb(db: { getRandomReactionMedia: (cat: string) => { url: string } | null } | null): void {
  activeMediaDb = db;
}

export function areGifsEnabled(): boolean {
  return process.env.ENABLE_REACTION_GIFS !== 'false';
}

export function normalizeCategory(category?: string | null): ReactionCategory {
  if (!category) return 'opened';
  const lower = category.toLowerCase().trim();
  // Map legacy / extended names → 4 core categories
  if (lower === 'merged'   || lower === 'positive' || lower === 'ci_success' || lower === 'deploy_success') return 'merged';
  if (lower === 'approved')                                                                                  return 'approved';
  if (lower === 'needs_work' || lower === 'negative' || lower === 'ci_failure' ||
      lower === 'deploy_failure' || lower === 'security')                                                    return 'needs_work';
  return 'opened';
}

export function getRandomGif(category: ReactionCategory | string): string {
  const cat = normalizeCategory(category);
  if (activeMediaDb) {
    try {
      const dbItem = activeMediaDb.getRandomReactionMedia(cat);
      if (dbItem?.url) return dbItem.url;
    } catch { /* fallback to pool */ }
  }
  const pool = GIF_POOLS[cat] ?? GIF_POOLS.opened;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function buildReactionEmbed(
  category: ReactionCategory | string,
  title?: string,
  color?: number
): EmbedBuilder {
  const cat = normalizeCategory(category);
  const embed = new EmbedBuilder()
    .setColor(color ?? CATEGORY_COLORS[cat])
    .setImage(getRandomGif(cat));
  if (title) embed.setTitle(title);
  return embed;
}
