import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { Signal, SkillVersion } from '../types';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = process.env.DATABASE_PATH || './data/signals.db';
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS signals (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      current_plan TEXT NOT NULL DEFAULT '',
      profitwell_plans TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL CHECK(result IN ('HIGH','MEDIUM','LOW','SKIP')),
      product TEXT NOT NULL CHECK(product IN ('Grow','Train','Pro','Unknown')),
      signal_type TEXT NOT NULL CHECK(signal_type IN ('Explicit','Behavioral','Inferred','N/A')),
      stripe_verified INTEGER NOT NULL DEFAULT 0,
      quote TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL DEFAULT '',
      intercom_url TEXT NOT NULL DEFAULT '',
      slack_message_ts TEXT,
      detected_at TEXT NOT NULL,
      trigger TEXT NOT NULL CHECK(trigger IN ('scheduled','webhook_new','webhook_reply','manual')),
      feedback_status TEXT NOT NULL DEFAULT 'pending' CHECK(feedback_status IN ('pending','confirmed','false_positive','converted')),
      feedback_at TEXT,
      feedback_by TEXT,
      notes TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_signals_conversation_id ON signals(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_signals_detected_at ON signals(detected_at);
    CREATE INDEX IF NOT EXISTS idx_signals_result ON signals(result);
    CREATE INDEX IF NOT EXISTS idx_signals_feedback_status ON signals(feedback_status);

    CREATE TABLE IF NOT EXISTS skill_versions (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      prompt TEXT NOT NULL,
      deployed_at TEXT NOT NULL,
      deployed_by TEXT NOT NULL DEFAULT '',
      make_datastore_synced INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS scan_log (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      trigger TEXT NOT NULL,
      conversations_reviewed INTEGER NOT NULL DEFAULT 0,
      signals_found INTEGER NOT NULL DEFAULT 0,
      signals_skipped INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );
  `);
}

// Signal helpers
export function insertSignal(signal: Signal): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO signals (
      id, conversation_id, customer_name, customer_email,
      current_plan, profitwell_plans, result, product, signal_type,
      stripe_verified, quote, action, intercom_url, slack_message_ts,
      detected_at, trigger, feedback_status, feedback_at, feedback_by, notes
    ) VALUES (
      @id, @conversation_id, @customer_name, @customer_email,
      @current_plan, @profitwell_plans, @result, @product, @signal_type,
      @stripe_verified, @quote, @action, @intercom_url, @slack_message_ts,
      @detected_at, @trigger, @feedback_status, @feedback_at, @feedback_by, @notes
    )
  `).run({ ...signal, stripe_verified: signal.stripe_verified ? 1 : 0 });
}

export function updateSignalSlackTs(id: string, ts: string): void {
  getDb().prepare('UPDATE signals SET slack_message_ts = ? WHERE id = ?').run(ts, id);
}

export function getSignalByConversationId(conversationId: string): Signal | null {
  const row = getDb().prepare('SELECT * FROM signals WHERE conversation_id = ? ORDER BY detected_at DESC LIMIT 1').get(conversationId) as Record<string, unknown> | undefined;
  return row ? rowToSignal(row) : null;
}

export function getSignalById(id: string): Signal | null {
  const row = getDb().prepare('SELECT * FROM signals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToSignal(row) : null;
}

export function updateSignalFeedback(
  id: string,
  status: 'confirmed' | 'false_positive' | 'converted',
  by: string,
  notes?: string,
): boolean {
  const result = getDb().prepare(`
    UPDATE signals SET feedback_status = ?, feedback_at = ?, feedback_by = ?, notes = ?
    WHERE id = ?
  `).run(status, new Date().toISOString(), by, notes ?? null, id);
  return result.changes > 0;
}

export function insertSkillVersion(version: SkillVersion): void {
  getDb().prepare(`
    INSERT INTO skill_versions (id, version, prompt, deployed_at, deployed_by, make_datastore_synced, notes)
    VALUES (@id, @version, @prompt, @deployed_at, @deployed_by, @make_datastore_synced, @notes)
  `).run({ ...version, make_datastore_synced: version.make_datastore_synced ? 1 : 0 });
}

export function listSkillVersions(): SkillVersion[] {
  const rows = getDb().prepare('SELECT * FROM skill_versions ORDER BY deployed_at DESC').all() as Record<string, unknown>[];
  return rows.map(r => ({ ...(r as Omit<SkillVersion, 'make_datastore_synced'>), make_datastore_synced: r['make_datastore_synced'] === 1 }));
}

export function listSignals(filters: {
  since?: Date;
  result?: string;
  feedback_status?: string;
  limit?: number;
} = {}): Signal[] {
  let query = 'SELECT * FROM signals WHERE 1=1';
  const params: unknown[] = [];

  if (filters.since) {
    query += ' AND detected_at >= ?';
    params.push(filters.since.toISOString());
  }
  if (filters.result) {
    query += ' AND result = ?';
    params.push(filters.result);
  }
  if (filters.feedback_status) {
    query += ' AND feedback_status = ?';
    params.push(filters.feedback_status);
  }

  query += ' ORDER BY detected_at DESC';

  if (filters.limit) {
    query += ' LIMIT ?';
    params.push(filters.limit);
  }

  const rows = getDb().prepare(query).all(...params) as Record<string, unknown>[];
  return rows.map(rowToSignal);
}

export interface ScanStats {
  total_signals: number;
  high: number;
  medium: number;
  low: number;
  confirmed: number;
  false_positives: number;
  pending: number;
  converted: number;
  grow: number;
  train: number;
}

export function getSummaryStats(since?: Date): ScanStats {
  const db = getDb();
  const whereClause = since ? `WHERE detected_at >= '${since.toISOString()}'` : '';

  const row = db.prepare(`
    SELECT
      COUNT(*) as total_signals,
      SUM(CASE WHEN result = 'HIGH' THEN 1 ELSE 0 END) as high,
      SUM(CASE WHEN result = 'MEDIUM' THEN 1 ELSE 0 END) as medium,
      SUM(CASE WHEN result = 'LOW' THEN 1 ELSE 0 END) as low,
      SUM(CASE WHEN feedback_status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
      SUM(CASE WHEN feedback_status = 'false_positive' THEN 1 ELSE 0 END) as false_positives,
      SUM(CASE WHEN feedback_status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN feedback_status = 'converted' THEN 1 ELSE 0 END) as converted,
      SUM(CASE WHEN product = 'Grow' THEN 1 ELSE 0 END) as grow,
      SUM(CASE WHEN product = 'Train' THEN 1 ELSE 0 END) as train
    FROM signals ${whereClause}
  `).get() as ScanStats;

  return row;
}

function rowToSignal(row: Record<string, unknown>): Signal {
  return {
    ...(row as Omit<Signal, 'stripe_verified'>),
    stripe_verified: row['stripe_verified'] === 1,
  };
}

export interface BreakdownStats {
  product: string;
  total: number;
  high: number;
  medium: number;
  low: number;
  confirmed: number;
  false_positives: number;
  converted: number;
  pending: number;
}

export interface AccuracyPoint {
  date: string;
  total: number;
  confirmed: number;
  false_positives: number;
  converted: number;
  precision: number;
}

export interface ConversionFunnel {
  total_detected: number;
  reviewed: number;
  confirmed: number;
  converted: number;
  false_positives: number;
  pending: number;
  review_rate: number;
  confirm_rate: number;
  convert_rate: number;
  precision: number;
}

export function getBreakdownByProduct(since?: Date): BreakdownStats[] {
  const db = getDb();
  const whereClause = since ? `WHERE detected_at >= '${since.toISOString()}'` : '';
  const rows = db.prepare(`
    SELECT
      product,
      COUNT(*) as total,
      SUM(CASE WHEN result = 'HIGH' THEN 1 ELSE 0 END) as high,
      SUM(CASE WHEN result = 'MEDIUM' THEN 1 ELSE 0 END) as medium,
      SUM(CASE WHEN result = 'LOW' THEN 1 ELSE 0 END) as low,
      SUM(CASE WHEN feedback_status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
      SUM(CASE WHEN feedback_status = 'false_positive' THEN 1 ELSE 0 END) as false_positives,
      SUM(CASE WHEN feedback_status = 'converted' THEN 1 ELSE 0 END) as converted,
      SUM(CASE WHEN feedback_status = 'pending' THEN 1 ELSE 0 END) as pending
    FROM signals ${whereClause}
    GROUP BY product
    ORDER BY total DESC
  `).all() as BreakdownStats[];
  return rows;
}

export function getBreakdownByTrigger(since?: Date): Array<{ trigger: string; total: number; high: number; medium: number; low: number }> {
  const db = getDb();
  const whereClause = since ? `WHERE detected_at >= '${since.toISOString()}'` : '';
  return db.prepare(`
    SELECT
      trigger,
      COUNT(*) as total,
      SUM(CASE WHEN result = 'HIGH' THEN 1 ELSE 0 END) as high,
      SUM(CASE WHEN result = 'MEDIUM' THEN 1 ELSE 0 END) as medium,
      SUM(CASE WHEN result = 'LOW' THEN 1 ELSE 0 END) as low
    FROM signals ${whereClause}
    GROUP BY trigger
    ORDER BY total DESC
  `).all() as Array<{ trigger: string; total: number; high: number; medium: number; low: number }>;
}

export function getAccuracyOverTime(since?: Date, groupBy: 'day' | 'week' = 'day'): AccuracyPoint[] {
  const db = getDb();
  const whereClause = since ? `WHERE detected_at >= '${since.toISOString()}'` : '';
  const dateTrunc = groupBy === 'week'
    ? "strftime('%Y-W%W', detected_at)"
    : "strftime('%Y-%m-%d', detected_at)";
  const rows = db.prepare(`
    SELECT
      ${dateTrunc} as date,
      COUNT(*) as total,
      SUM(CASE WHEN feedback_status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
      SUM(CASE WHEN feedback_status = 'false_positive' THEN 1 ELSE 0 END) as false_positives,
      SUM(CASE WHEN feedback_status = 'converted' THEN 1 ELSE 0 END) as converted
    FROM signals ${whereClause}
    GROUP BY date
    ORDER BY date ASC
  `).all() as Array<{ date: string; total: number; confirmed: number; false_positives: number; converted: number }>;

  return rows.map(r => {
    const reviewed = r.confirmed + r.false_positives + r.converted;
    const precision = reviewed > 0 ? Math.round(((r.confirmed + r.converted) / reviewed) * 100) : 0;
    return { ...r, precision };
  });
}

export function getConversionFunnel(since?: Date): ConversionFunnel {
  const db = getDb();
  const whereClause = since ? `WHERE detected_at >= '${since.toISOString()}'` : '';
  const row = db.prepare(`
    SELECT
      COUNT(*) as total_detected,
      SUM(CASE WHEN feedback_status != 'pending' THEN 1 ELSE 0 END) as reviewed,
      SUM(CASE WHEN feedback_status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
      SUM(CASE WHEN feedback_status = 'converted' THEN 1 ELSE 0 END) as converted,
      SUM(CASE WHEN feedback_status = 'false_positive' THEN 1 ELSE 0 END) as false_positives,
      SUM(CASE WHEN feedback_status = 'pending' THEN 1 ELSE 0 END) as pending
    FROM signals ${whereClause}
  `).get() as { total_detected: number; reviewed: number; confirmed: number; converted: number; false_positives: number; pending: number };

  const total = row.total_detected;
  const reviewed = row.reviewed;
  const precision = reviewed > 0 ? Math.round(((row.confirmed + row.converted) / reviewed) * 100) : 0;
  return {
    ...row,
    review_rate: total > 0 ? Math.round((reviewed / total) * 100) : 0,
    confirm_rate: total > 0 ? Math.round(((row.confirmed + row.converted) / total) * 100) : 0,
    convert_rate: (row.confirmed + row.converted) > 0 ? Math.round((row.converted / (row.confirmed + row.converted)) * 100) : 0,
    precision,
  };
}

// Scan log helpers
export function insertScanLog(id: string, trigger: string): void {
  getDb().prepare(`
    INSERT INTO scan_log (id, started_at, trigger) VALUES (?, ?, ?)
  `).run(id, new Date().toISOString(), trigger);
}

export function completeScanLog(id: string, reviewed: number, found: number, skipped: number, error?: string): void {
  getDb().prepare(`
    UPDATE scan_log SET completed_at = ?, conversations_reviewed = ?, signals_found = ?, signals_skipped = ?, error = ?
    WHERE id = ?
  `).run(new Date().toISOString(), reviewed, found, skipped, error ?? null, id);
}
