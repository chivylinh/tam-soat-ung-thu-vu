'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const root = path.join(__dirname, '..');

test('config.env parser', () => {
  const { parse } = require('../src/config');
  const v = parse('﻿# ghi chú\r\nCLINIC_NAME=Phòng khám Đa khoa ABC\r\nPORT = 3100\r\nQUOTED="a=b"\r\nbad line\r\n');
  assert.deepEqual(v, { CLINIC_NAME: 'Phòng khám Đa khoa ABC', PORT: '3100', QUOTED: 'a=b' });
});

test('server uses config.env, keeps session secret, backs up daily, reports busy port', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-'));
  const cfg = path.join(dir, 'config.env');
  const port = String(20000 + Math.floor(Math.random() * 20000));
  fs.writeFileSync(cfg, `CLINIC_NAME=Phòng khám Thử Nghiệm\r\nPORT=${port}\r\nDB_PATH=${path.join(dir, 'data', 'clinic.db')}\r\n`);
  const env = { ...process.env, CONFIG_FILE: cfg };
  delete env.DB_PATH; delete env.PORT; delete env.CLINIC_NAME;

  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], { cwd: root, env });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  try {
    for (let i = 0; i < 50 && !out.includes('Đã sao lưu'); i++) await new Promise((r) => setTimeout(r, 100));
    const html = await (await fetch(`http://127.0.0.1:${port}/login`)).text();
    assert.match(html, /Phòng khám Thử Nghiệm/);
    assert.ok(fs.existsSync(path.join(dir, 'data', '.session-secret')), 'session secret persisted');
    const backups = fs.readdirSync(path.join(dir, 'data', 'backups'));
    assert.equal(backups.length, 1);
    assert.match(backups[0], /^clinic-\d{4}-\d{2}-\d{2}\.db$/);

    // A second instance on the same port exits with a clear message
    let second = '';
    try {
      execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], { cwd: root, env, stdio: 'pipe' });
    } catch (e) { second = String(e.stderr); }
    assert.match(second, /đang được dùng/);
  } finally {
    child.kill();
  }
  // Manual backup script
  const res = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/backup.js'], { cwd: root, env }).toString();
  assert.match(res, /Đã sao lưu/);
  fs.rmSync(dir, { recursive: true, force: true });
});
