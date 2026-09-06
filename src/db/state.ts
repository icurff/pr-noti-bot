/**
 * SQLite state management for PR/Issue ↔ Discord message mappings
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface PrMessage {
  repo: string;
  prNumber: number;
  channelId: string;
  messageId: string;
  threadId: string | null;
  createdAt: string;
  lastUpdated: string;
}

export interface StoredPrData {
  repo: string;
  prNumber: number;
  title: string;
  url: string;
  author: string;
  authorUrl: string;
  authorAvatar: string | null;
  branch: string;
  baseBranch: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  state: string;
  draft: boolean;
  prCreatedAt: string;
}

export interface PrStatus {
  repo: string;
  prNumber: number;
  copilotStatus: 'pending' | 'reviewed';
  copilotComments: number;
  agentReviewStatus: 'pending' | 'approved' | 'changes_requested' | 'none';
  humanReviewStatus: 'approved' | 'changes_requested' | 'none';
  humanReviewLogin: string | null;
  ciStatus: 'pending' | 'running' | 'success' | 'failure' | 'cancelled';
  ciWorkflowName: string | null;
  ciUrl: string | null;
}

export interface IssueMessage {
  repo: string;
  issueNumber: number;
  channelId: string;
  messageId: string;
  threadId: string | null;
  createdAt: string;
  lastUpdated: string;
}

export interface EventLogEntry {
  id: number;
  repo: string;
  entityNumber: number | null;
  eventType: string;
  /** Null for rows written after the slimming change; rows from older DBs may
   * still carry payloads until the 30-day retention prunes them. */
  payload: string | null;
  createdAt: string;
}

export interface ReactionMediaItem {
  id: number;
  category: string;
  url: string;
  title: string | null;
  createdAt: string;
}

export const DEFAULT_MEDIA_SEEDS: Array<{ category: string; url: string; title: string }> = [
  // merged
  { category: 'merged', url: 'https://media.giphy.com/media/26u4cqiYI30juCOGY/giphy.gif', title: 'Minions Cheering' },
  { category: 'merged', url: 'https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif', title: 'High Five Victory' },
  { category: 'merged', url: 'https://media.giphy.com/media/DhstvI3CH03yOTXRjs/giphy.gif', title: 'Office Dancing' },
  { category: 'merged', url: 'https://media.giphy.com/media/10uEX5kfeodYgo/giphy.gif', title: 'Borat Great Success' },

  // opened
  { category: 'opened', url: 'https://media.giphy.com/media/LmN8OYiY4m0X85K0Zz/giphy.gif', title: 'Let Us Do This' },
  { category: 'opened', url: 'https://media.giphy.com/media/b5LTssxCLpvVe/giphy.gif', title: 'Hacker Fast Typing' },
  { category: 'opened', url: 'https://media.giphy.com/media/unQ3IJU2RG7DO/giphy.gif', title: 'Cat Coding Focus' },
  { category: 'opened', url: 'https://media.giphy.com/media/nbvFVPiEiJH6JOGIok/giphy.gif', title: 'Clapping Applause' },

  // approved
  { category: 'approved', url: 'https://media.giphy.com/media/XreQmk7ETCak0/giphy.gif', title: 'Approved Stamp' },
  { category: 'approved', url: 'https://media.giphy.com/media/NEvPzZ8bdvtxG/giphy.gif', title: 'Nod of Approval' },
  { category: 'approved', url: 'https://media.giphy.com/media/diUKszNTUghVe/giphy.gif', title: 'Chuck Norris Thumbs Up' },

  // needs_work
  { category: 'needs_work', url: 'https://media.giphy.com/media/3o7TKwmnDgQb5jemjK/giphy.gif', title: 'Wagging Finger No' },
  { category: 'needs_work', url: 'https://media.giphy.com/media/puOukoEvH4uAw/giphy.gif', title: 'Hold Up Wait A Minute' },
  { category: 'needs_work', url: 'https://media.giphy.com/media/QMHoU66sBXCAHonOmG/giphy.gif', title: 'This Is Fine Dog' },
  { category: 'needs_work', url: 'https://media.giphy.com/media/oOTTyHRHj0HYY/giphy.gif', title: 'Keyboard Smash' },
];

export class StateDb {
  private db: Database.Database;

  constructor(repo: string, stateDir?: string) {
    // Expand ~ to actual home directory (GitHub Actions doesn't expand ~)
    let baseDir = stateDir ?? join(homedir(), '.repo-relay');
    if (baseDir.startsWith('~')) {
      baseDir = baseDir.replace('~', homedir());
    }
    const repoDir = join(baseDir, repo.replace('/', '-'));
    console.log(`[repo-relay] Using state directory: ${repoDir}`);

    if (!existsSync(repoDir)) {
      mkdirSync(repoDir, { recursive: true });
    }

    const dbPath = join(repoDir, 'state.db');
    this.db = new Database(dbPath);

    // Verify database integrity (catches corruption from incomplete cache restore)
    let integrityOk = false;
    let integrityDetail = 'unreadable';
    try {
      const integrityResult = this.db.pragma('integrity_check') as Array<{ integrity_check: string }>;
      const result = integrityResult[0]?.integrity_check;
      integrityOk = result === 'ok';
      if (!integrityOk) integrityDetail = result ?? 'unknown';
    } catch {
      // Completely corrupt file — pragma itself throws
    }
    if (!integrityOk) {
      console.warn(`[repo-relay] Database integrity check failed (${integrityDetail}), recreating...`);
      this.db.close();
      for (const suffix of ['', '-wal', '-shm']) {
        try { unlinkSync(dbPath + suffix); } catch { /* may not exist */ }
      }
      this.db = new Database(dbPath);
    }

    this.db.pragma('journal_mode = WAL');
    this.runMigrations();
    this.initSchema();
    this.seedDefaultMedia();
  }

  private runMigrations(): void {
    // Migration: Add thread_id column if it doesn't exist
    // Guard: table may not exist yet on a fresh DB (initSchema runs after)
    const prColumns = this.db.prepare("PRAGMA table_info(pr_messages)").all() as Array<{ name: string }>;
    if (prColumns.length > 0 && !prColumns.some(col => col.name === 'thread_id')) {
      console.log('[repo-relay] Running migration: Adding thread_id column to pr_messages');
      this.db.exec("ALTER TABLE pr_messages ADD COLUMN thread_id TEXT");
    }

    // Migration: Rename event_log.pr_number → entity_number
    // Must run before initSchema so the index on entity_number can be created
    const eventColumns = this.db.prepare("PRAGMA table_info(event_log)").all() as Array<{ name: string }>;
    if (eventColumns.length > 0 && eventColumns.some(col => col.name === 'pr_number')) {
      console.log('[repo-relay] Running migration: Renaming event_log.pr_number to entity_number');
      this.db.exec("ALTER TABLE event_log RENAME COLUMN pr_number TO entity_number");
      this.db.exec("DROP INDEX IF EXISTS idx_event_log_repo_pr");
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_event_log_repo_entity ON event_log(repo, entity_number)");
    }

    // Migration: Add human review columns to pr_status (#146)
    // Guard: table may not exist yet on a fresh DB (initSchema runs after)
    const statusColumns = this.db.prepare("PRAGMA table_info(pr_status)").all() as Array<{ name: string }>;
    if (statusColumns.length > 0 && !statusColumns.some(col => col.name === 'human_review_status')) {
      console.log('[repo-relay] Running migration: Adding human review columns to pr_status');
      this.db.exec("ALTER TABLE pr_status ADD COLUMN human_review_status TEXT DEFAULT 'none'");
      this.db.exec("ALTER TABLE pr_status ADD COLUMN human_review_login TEXT");
    }

    // Migration: Normalize all categories to the 4 core types (opened, approved, merged, needs_work)
    const mediaColumns = this.db.prepare("PRAGMA table_info(reaction_media)").all() as Array<{ name: string }>;
    if (mediaColumns.length > 0) {
      this.db.exec(`
        UPDATE reaction_media SET category = 'merged'     WHERE category IN ('positive', 'ci_success', 'deploy_success');
        UPDATE reaction_media SET category = 'needs_work' WHERE category IN ('negative', 'ci_failure', 'deploy_failure', 'security', 'security_alert', 'review_changes_requested');

        -- Re-assign specific items to opened and approved pools
        UPDATE reaction_media SET category = 'opened' WHERE url IN (
          'https://media.giphy.com/media/LmN8OYiY4m0X85K0Zz/giphy.gif',
          'https://media.giphy.com/media/b5LTssxCLpvVe/giphy.gif',
          'https://media.giphy.com/media/unQ3IJU2RG7DO/giphy.gif',
          'https://media.giphy.com/media/nbvFVPiEiJH6JOGIok/giphy.gif',
          'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif'
        ) OR title LIKE '%Coding%' OR title LIKE '%Hacker%' OR title LIKE '%Let Us Do This%';

        UPDATE reaction_media SET category = 'approved' WHERE url IN (
          'https://media.giphy.com/media/XreQmk7ETCak0/giphy.gif',
          'https://media.giphy.com/media/NEvPzZ8bdvtxG/giphy.gif',
          'https://media.giphy.com/media/diUKszNTUghVe/giphy.gif'
        ) OR title LIKE '%Approved%' OR title LIKE '%Approval%' OR title LIKE '%Chuck Norris%';
      `);
    }
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pr_messages (
        repo TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        thread_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (repo, pr_number)
      );

      CREATE TABLE IF NOT EXISTS pr_status (
        repo TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        copilot_status TEXT DEFAULT 'pending',
        copilot_comments INTEGER DEFAULT 0,
        agent_review_status TEXT DEFAULT 'pending',
        human_review_status TEXT DEFAULT 'none',
        human_review_login TEXT,
        ci_status TEXT DEFAULT 'pending',
        ci_workflow_name TEXT,
        ci_url TEXT,
        PRIMARY KEY (repo, pr_number)
      );

      CREATE TABLE IF NOT EXISTS pr_data (
        repo TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        author TEXT NOT NULL,
        author_url TEXT NOT NULL,
        author_avatar TEXT,
        branch TEXT NOT NULL,
        base_branch TEXT NOT NULL,
        additions INTEGER DEFAULT 0,
        deletions INTEGER DEFAULT 0,
        changed_files INTEGER DEFAULT 0,
        state TEXT DEFAULT 'open',
        draft INTEGER DEFAULT 0,
        pr_created_at TEXT NOT NULL,
        PRIMARY KEY (repo, pr_number)
      );

      CREATE TABLE IF NOT EXISTS issue_messages (
        repo TEXT NOT NULL,
        issue_number INTEGER NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        thread_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (repo, issue_number)
      );

      CREATE TABLE IF NOT EXISTS event_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo TEXT NOT NULL,
        entity_number INTEGER,
        event_type TEXT,
        payload TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_event_log_repo_entity
        ON event_log(repo, entity_number);

      CREATE TABLE IF NOT EXISTS reaction_media (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        title TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_reaction_media_category
        ON reaction_media(category);
    `);

    // Retention: the event log is a debugging affordance, not an archive —
    // unbounded growth bloats the actions/cache artifact on hosted runners
    this.db.exec("DELETE FROM event_log WHERE created_at < datetime('now', '-30 days')");
  }

  private seedDefaultMedia(): void {
    try {
      const row = this.db.prepare("SELECT COUNT(*) as count FROM reaction_media").get() as { count: number };
      if (row && row.count === 0) {
        const insert = this.db.prepare(
          "INSERT OR IGNORE INTO reaction_media (category, url, title) VALUES (?, ?, ?)"
        );
        const insertMany = this.db.transaction((items: Array<{ category: string; url: string; title: string }>) => {
          for (const item of items) {
            insert.run(item.category, item.url, item.title);
          }
        });
        insertMany(DEFAULT_MEDIA_SEEDS);
      }
    } catch {
      // Best-effort initialization
    }
  }

  getPrMessage(repo: string, prNumber: number): PrMessage | null {
    const stmt = this.db.prepare(`
      SELECT repo, pr_number as prNumber, channel_id as channelId,
             message_id as messageId, thread_id as threadId,
             created_at as createdAt, last_updated as lastUpdated
      FROM pr_messages
      WHERE repo = ? AND pr_number = ?
    `);
    return (stmt.get(repo, prNumber) as PrMessage) ?? null;
  }

  savePrMessage(
    repo: string,
    prNumber: number,
    channelId: string,
    messageId: string,
    threadId?: string
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO pr_messages (repo, pr_number, channel_id, message_id, thread_id)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(repo, pr_number) DO UPDATE SET
        message_id = excluded.message_id,
        channel_id = excluded.channel_id,
        thread_id = excluded.thread_id,
        last_updated = CURRENT_TIMESTAMP
    `);
    stmt.run(repo, prNumber, channelId, messageId, threadId ?? null);
  }

  updatePrThread(repo: string, prNumber: number, threadId: string): void {
    const stmt = this.db.prepare(`
      UPDATE pr_messages
      SET thread_id = ?, last_updated = CURRENT_TIMESTAMP
      WHERE repo = ? AND pr_number = ?
    `);
    stmt.run(threadId, repo, prNumber);
  }

  updatePrMessageTimestamp(repo: string, prNumber: number): void {
    const stmt = this.db.prepare(`
      UPDATE pr_messages
      SET last_updated = CURRENT_TIMESTAMP
      WHERE repo = ? AND pr_number = ?
    `);
    stmt.run(repo, prNumber);
  }

  deletePrMessage(repo: string, prNumber: number): void {
    const stmt = this.db.prepare(`
      DELETE FROM pr_messages
      WHERE repo = ? AND pr_number = ?
    `);
    stmt.run(repo, prNumber);
  }

  getPrStatus(repo: string, prNumber: number): PrStatus | null {
    const stmt = this.db.prepare(`
      SELECT repo, pr_number as prNumber,
             copilot_status as copilotStatus,
             copilot_comments as copilotComments,
             agent_review_status as agentReviewStatus,
             human_review_status as humanReviewStatus,
             human_review_login as humanReviewLogin,
             ci_status as ciStatus,
             ci_workflow_name as ciWorkflowName,
             ci_url as ciUrl
      FROM pr_status
      WHERE repo = ? AND pr_number = ?
    `);
    return (stmt.get(repo, prNumber) as PrStatus) ?? null;
  }

  savePrStatus(repo: string, prNumber: number): void {
    const stmt = this.db.prepare(`
      INSERT INTO pr_status (repo, pr_number)
      VALUES (?, ?)
      ON CONFLICT(repo, pr_number) DO NOTHING
    `);
    stmt.run(repo, prNumber);
  }

  updateCopilotStatus(
    repo: string,
    prNumber: number,
    status: 'pending' | 'reviewed',
    comments: number
  ): void {
    this.savePrStatus(repo, prNumber);
    const stmt = this.db.prepare(`
      UPDATE pr_status
      SET copilot_status = ?, copilot_comments = ?
      WHERE repo = ? AND pr_number = ?
    `);
    stmt.run(status, comments, repo, prNumber);
  }

  updateAgentReviewStatus(
    repo: string,
    prNumber: number,
    status: 'pending' | 'approved' | 'changes_requested' | 'none'
  ): void {
    this.savePrStatus(repo, prNumber);
    const stmt = this.db.prepare(`
      UPDATE pr_status
      SET agent_review_status = ?
      WHERE repo = ? AND pr_number = ?
    `);
    stmt.run(status, repo, prNumber);
  }

  updateHumanReviewStatus(
    repo: string,
    prNumber: number,
    status: 'approved' | 'changes_requested' | 'none',
    login: string | null
  ): void {
    this.savePrStatus(repo, prNumber);
    const stmt = this.db.prepare(`
      UPDATE pr_status
      SET human_review_status = ?, human_review_login = ?
      WHERE repo = ? AND pr_number = ?
    `);
    stmt.run(status, login, repo, prNumber);
  }

  updateCiStatus(
    repo: string,
    prNumber: number,
    status: 'pending' | 'running' | 'success' | 'failure' | 'cancelled',
    workflowName?: string,
    url?: string
  ): void {
    this.savePrStatus(repo, prNumber);
    const stmt = this.db.prepare(`
      UPDATE pr_status
      SET ci_status = ?, ci_workflow_name = ?, ci_url = ?
      WHERE repo = ? AND pr_number = ?
    `);
    stmt.run(status, workflowName ?? null, url ?? null, repo, prNumber);
  }

  getPrData(repo: string, prNumber: number): StoredPrData | null {
    const stmt = this.db.prepare(`
      SELECT repo, pr_number as prNumber, title, url, author,
             author_url as authorUrl, author_avatar as authorAvatar,
             branch, base_branch as baseBranch, additions, deletions,
             changed_files as changedFiles, state, draft,
             pr_created_at as prCreatedAt
      FROM pr_data
      WHERE repo = ? AND pr_number = ?
    `);
    // SQLite returns draft as integer (0/1), need to convert to boolean
    interface DbRow {
      repo: string;
      prNumber: number;
      title: string;
      url: string;
      author: string;
      authorUrl: string;
      authorAvatar: string | null;
      branch: string;
      baseBranch: string;
      additions: number;
      deletions: number;
      changedFiles: number;
      state: string;
      draft: number;
      prCreatedAt: string;
    }
    const row = stmt.get(repo, prNumber) as DbRow | undefined;
    if (!row) return null;
    return {
      repo: row.repo,
      prNumber: row.prNumber,
      title: row.title,
      url: row.url,
      author: row.author,
      authorUrl: row.authorUrl,
      authorAvatar: row.authorAvatar,
      branch: row.branch,
      baseBranch: row.baseBranch,
      additions: row.additions,
      deletions: row.deletions,
      changedFiles: row.changedFiles,
      state: row.state,
      draft: Boolean(row.draft),
      prCreatedAt: row.prCreatedAt,
    };
  }

  savePrData(data: StoredPrData): void {
    const stmt = this.db.prepare(`
      INSERT INTO pr_data (repo, pr_number, title, url, author, author_url,
                          author_avatar, branch, base_branch, additions,
                          deletions, changed_files, state, draft, pr_created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(repo, pr_number) DO UPDATE SET
        title = excluded.title,
        url = excluded.url,
        branch = excluded.branch,
        base_branch = excluded.base_branch,
        additions = excluded.additions,
        deletions = excluded.deletions,
        changed_files = excluded.changed_files,
        state = excluded.state,
        draft = excluded.draft
    `);
    stmt.run(
      data.repo, data.prNumber, data.title, data.url, data.author,
      data.authorUrl, data.authorAvatar, data.branch, data.baseBranch,
      data.additions, data.deletions, data.changedFiles, data.state,
      data.draft ? 1 : 0, data.prCreatedAt
    );
  }

  getOpenPrNumbers(repo: string): number[] {
    const stmt = this.db.prepare(
      'SELECT pr_number FROM pr_data WHERE repo = ? AND state = ? ORDER BY pr_number ASC'
    );
    return (stmt.all(repo, 'open') as Array<{ pr_number: number }>).map(r => r.pr_number);
  }

  getIssueMessage(repo: string, issueNumber: number): IssueMessage | null {
    const stmt = this.db.prepare(`
      SELECT repo, issue_number as issueNumber, channel_id as channelId,
             message_id as messageId, thread_id as threadId,
             created_at as createdAt, last_updated as lastUpdated
      FROM issue_messages
      WHERE repo = ? AND issue_number = ?
    `);
    return (stmt.get(repo, issueNumber) as IssueMessage) ?? null;
  }

  saveIssueMessage(
    repo: string,
    issueNumber: number,
    channelId: string,
    messageId: string,
    threadId?: string
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO issue_messages (repo, issue_number, channel_id, message_id, thread_id)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(repo, issue_number) DO UPDATE SET
        message_id = excluded.message_id,
        channel_id = excluded.channel_id,
        thread_id = excluded.thread_id,
        last_updated = CURRENT_TIMESTAMP
    `);
    stmt.run(repo, issueNumber, channelId, messageId, threadId ?? null);
  }

  updateIssueThread(repo: string, issueNumber: number, threadId: string): void {
    const stmt = this.db.prepare(`
      UPDATE issue_messages
      SET thread_id = ?, last_updated = CURRENT_TIMESTAMP
      WHERE repo = ? AND issue_number = ?
    `);
    stmt.run(threadId, repo, issueNumber);
  }

  updateIssueMessageTimestamp(repo: string, issueNumber: number): void {
    const stmt = this.db.prepare(`
      UPDATE issue_messages
      SET last_updated = CURRENT_TIMESTAMP
      WHERE repo = ? AND issue_number = ?
    `);
    stmt.run(repo, issueNumber);
  }

  deleteIssueMessage(repo: string, issueNumber: number): void {
    const stmt = this.db.prepare(`
      DELETE FROM issue_messages
      WHERE repo = ? AND issue_number = ?
    `);
    stmt.run(repo, issueNumber);
  }


  logEvent(
    repo: string,
    entityNumber: number | null,
    eventType: string,
    _payload: object
  ): void {
    // Payloads are deliberately NOT persisted: full event JSON (30-80KB each)
    // grew the actions/cache artifact unboundedly and put private-repo content
    // at rest in the cache. Actions logs already record every payload; the
    // parameter is kept so the 9 handler call sites stay untouched.
    const stmt = this.db.prepare(`
      INSERT INTO event_log (repo, entity_number, event_type, payload)
      VALUES (?, ?, ?, NULL)
    `);
    stmt.run(repo, entityNumber, eventType);
  }

  getRecentEvents(
    repo: string,
    entityNumber?: number,
    limit = 50
  ): EventLogEntry[] {
    let query = `
      SELECT id, repo, entity_number as entityNumber, event_type as eventType,
             payload, created_at as createdAt
      FROM event_log
      WHERE repo = ?
    `;
    const params: (string | number)[] = [repo];

    if (entityNumber !== undefined) {
      query += ' AND entity_number = ?';
      params.push(entityNumber);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as EventLogEntry[];
  }

  getAllReactionMedia(): ReactionMediaItem[] {
    const stmt = this.db.prepare(`
      SELECT id, category, url, title, created_at as createdAt
      FROM reaction_media
      ORDER BY category ASC, id DESC
    `);
    return stmt.all() as ReactionMediaItem[];
  }

  getReactionMediaByCategory(category: string): ReactionMediaItem[] {
    const stmt = this.db.prepare(`
      SELECT id, category, url, title, created_at as createdAt
      FROM reaction_media
      WHERE category = ?
      ORDER BY id DESC
    `);
    return stmt.all(category) as ReactionMediaItem[];
  }

  getRandomReactionMedia(category: string): ReactionMediaItem | null {
    const stmt = this.db.prepare(`
      SELECT id, category, url, title, created_at as createdAt
      FROM reaction_media
      WHERE category = ?
      ORDER BY RANDOM() LIMIT 1
    `);
    const result = stmt.get(category) as ReactionMediaItem | undefined;
    return result ?? null;
  }

  addReactionMedia(category: string, url: string, title?: string): ReactionMediaItem {
    const stmt = this.db.prepare(`
      INSERT INTO reaction_media (category, url, title)
      VALUES (?, ?, ?)
    `);
    const info = stmt.run(category, url, title ?? null);
    const getStmt = this.db.prepare(`
      SELECT id, category, url, title, created_at as createdAt
      FROM reaction_media
      WHERE id = ?
    `);
    return getStmt.get(info.lastInsertRowid) as ReactionMediaItem;
  }

  deleteReactionMedia(id: number): boolean {
    const stmt = this.db.prepare("DELETE FROM reaction_media WHERE id = ?");
    const info = stmt.run(id);
    return info.changes > 0;
  }

  close(): void {
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // Checkpoint can fail if DB is already closed or not in WAL mode
    } finally {
      this.db.close();
    }
  }
}
