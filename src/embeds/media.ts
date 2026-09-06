/**
 * Media library for Discord reaction GIFs.
 * 4 categories: merged / opened / approved / needs_work — giống example webex-bot.
 */

import { EmbedBuilder } from 'discord.js';

export type ReactionCategory = 'merged' | 'opened' | 'approved' | 'needs_work';

const GIF_POOLS: Record<ReactionCategory, string[]> = {
  merged: [
    'https://media.giphy.com/media/26u4cqiYI30juCOGY/giphy.gif', // Minions cheering
    'https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif', // High five victory
    'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif', // Leo DiCaprio toast
    'https://media.giphy.com/media/DhstvI3CH03yOTXRjs/giphy.gif', // Office dancing
    'https://media.giphy.com/media/g9582DNuQppxC/giphy.gif',     // Gatsby celebration
    'https://media.giphy.com/media/ely3apij36BJhoZ234/giphy.gif', // Confetti
    'https://media.giphy.com/media/10uEX5kfeodYgo/giphy.gif',     // Borat great success
  ],
  opened: [
    'https://media.giphy.com/media/LmN8OYiY4m0X85K0Zz/giphy.gif', // Let's do this
    'https://media.giphy.com/media/b5LTssxCLpvVe/giphy.gif',     // Hacker typing fast
    'https://media.giphy.com/media/unQ3IJU2RG7DO/giphy.gif',     // Cat coding
    'https://media.giphy.com/media/nbvFVPiEiJH6JOGIok/giphy.gif', // Clapping
    'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif',     // Thumbs up
  ],
  approved: [
    'https://media.giphy.com/media/XreQmk7ETCak0/giphy.gif',     // Approved stamp
    'https://media.giphy.com/media/NEvPzZ8bdvtxG/giphy.gif',     // Nod of approval
    'https://media.giphy.com/media/diUKszNTUghVe/giphy.gif',     // Chuck Norris thumbs up
    'https://media.giphy.com/media/lMameLIF8ymIjqZXue/giphy.gif', // Party
  ],
  needs_work: [
    'https://media.giphy.com/media/3o7TKwmnDgQb5jemjK/giphy.gif', // Wagging finger no
    'https://media.giphy.com/media/puOukoEvH4uAw/giphy.gif',     // Hold up wait a minute
    'https://media.giphy.com/media/l4pT0NtPSMV3pwJ20/giphy.gif', // Deep thinking
    'https://media.giphy.com/media/3gNotAoIRZsb9UHPnj/giphy.gif', // Squinting inspecting
    'https://media.giphy.com/media/QMHoU66sBXCAHonOmG/giphy.gif', // This is fine dog
    'https://media.giphy.com/media/oOTTyHRHj0HYY/giphy.gif',     // Keyboard smash
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
