'use strict';
/** Daily SQLite backups using VACUUM INTO (safe while the app is running). */
const fs = require('node:fs');
const path = require('node:path');
const { db, DB_PATH } = require('./db');
const { today } = require('./helpers');

function backupDir() {
  return process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), 'backups');
}

/** Write today's backup if it doesn't exist yet; keep the newest `keep` files. Returns the file path or null. */
function runBackup({ force = false, keep = Number(process.env.BACKUP_KEEP) || 30 } = {}) {
  if (DB_PATH === ':memory:') return null;
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `clinic-${today()}.db`);
  if (fs.existsSync(file)) {
    if (!force) return null;
    fs.unlinkSync(file);
  }
  db.prepare('VACUUM INTO ?').run(file);
  const old = fs.readdirSync(dir).filter((f) => /^clinic-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse().slice(keep);
  for (const f of old) fs.unlinkSync(path.join(dir, f));
  return file;
}

/** Back up at start-up and then every hour (only once per day is actually written). */
function scheduleBackups() {
  const tick = () => {
    try {
      const f = runBackup();
      if (f) console.log(`Đã sao lưu dữ liệu: ${f}`);
    } catch (e) {
      console.error('Sao lưu thất bại:', e.message);
    }
  };
  tick();
  setInterval(tick, 60 * 60 * 1000).unref();
}

module.exports = { runBackup, scheduleBackups, backupDir };
