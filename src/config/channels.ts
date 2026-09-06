/**
 * Channel configuration and routing
 */

import { config } from './index.js';

export interface ChannelConfig {
  prs: string;
  issues?: string;
  releases?: string;
  deployments?: string;
  security?: string;
}

export function getChannelConfig(): ChannelConfig {
  return config.channels;
}

export function getChannelForEvent(
  cfg: ChannelConfig,
  eventType: 'pr' | 'issue' | 'release' | 'ci' | 'review' | 'comment' | 'deployment' | 'push' | 'security'
): string {
  switch (eventType) {
    case 'pr':
    case 'ci':
    case 'review':
    case 'comment':
    case 'push':
      return cfg.prs;
    case 'issue':
      return cfg.issues ?? cfg.prs;
    case 'release':
      return cfg.releases ?? cfg.prs;
    case 'deployment':
      return cfg.deployments ?? cfg.prs;
    case 'security':
      return cfg.security ?? cfg.prs;
  }
}
