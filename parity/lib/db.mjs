import { DatabaseSync } from "node:sqlite";
import path from "path";

// cwd-relative: npm scripts and the Next server both run from parity/
export const DB_PATH = path.join(process.cwd(), "data", "parity.db");

export function openDb(readonly = false) {
  const db = new DatabaseSync(DB_PATH, { readOnly: readonly });
  if (!readonly) db.exec("PRAGMA journal_mode = WAL;");
  return db;
}

export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vendors (
      name TEXT PRIMARY KEY,
      city TEXT, response_file TEXT, response_kind TEXT,
      coverage INTEGER, questionnaire_returned INTEGER,
      compliant_default INTEGER, compliant_strict INTEGER,
      compliance_note TEXT, confirm_back_status TEXT
    );
    CREATE TABLE IF NOT EXISTS lines (
      id TEXT PRIMARY KEY, description TEXT, style TEXT, ply INTEGER,
      dims TEXT, plant TEXT, qty_month INTEGER, annual_qty INTEGER,
      weight_kg REAL, weight_band_pct REAL
    );
    CREATE TABLE IF NOT EXISTS cells (
      line_id TEXT, vendor TEXT,
      price REAL,              -- landed INR per piece at the pinned FX rate (NULL if missing)
      state TEXT,              -- verified | inferred | missing
      converted INTEGER,       -- 1 if a deterministic conversion (FX, per-100) was applied
      raw_value REAL, raw_unit TEXT, raw_currency TEXT,
      freight_per_pc REAL,
      assumptions TEXT,        -- json array of {kind, detail}
      anchor TEXT,             -- json {type, ref, quote, row_index, page}
      trail TEXT,              -- json array of steps
      pass_a REAL, pass_b REAL,
      PRIMARY KEY (line_id, vendor)
    );
    CREATE TABLE IF NOT EXISTS exceptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor TEXT, line_id TEXT, kind TEXT, title TEXT,
      detail TEXT,             -- json
      status TEXT DEFAULT 'open',
      resolution TEXT
    );
    CREATE TABLE IF NOT EXISTS terms (
      vendor TEXT, key TEXT, text TEXT,
      conditional INTEGER, condition_text TEXT, anchor TEXT
    );
    CREATE TABLE IF NOT EXISTS questionnaire (
      vendor TEXT, item TEXT, label TEXT, answer TEXT,
      status TEXT,             -- pass | fail | missing | flagged | inferred
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS attachments (
      vendor TEXT, filename TEXT, kind TEXT, summary TEXT, valid_until TEXT, flag TEXT
    );
    CREATE TABLE IF NOT EXISTS qa_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, question TEXT,
      constraints_text TEXT, sql_used TEXT, answer TEXT
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  `);
}

export function setMeta(db, key, value) {
  db.prepare("INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(key, typeof value === "string" ? value : JSON.stringify(value));
}
export function getMeta(db, key) {
  const row = db.prepare("SELECT value FROM meta WHERE key=?").get(key);
  return row ? row.value : null;
}
