import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'activity.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS app_state (
  app TEXT PRIMARY KEY,
  is_open INTEGER NOT NULL DEFAULT 0,
  opened_at INTEGER
);
CREATE TABLE IF NOT EXISTS app_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app TEXT NOT NULL,
  event TEXT NOT NULL,
  ts INTEGER NOT NULL,
  duration_seconds INTEGER
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON app_events(ts);
CREATE INDEX IF NOT EXISTS idx_events_app ON app_events(app);
`);

export default db;
