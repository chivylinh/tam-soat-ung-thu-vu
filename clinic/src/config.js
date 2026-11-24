'use strict';
/**
 * Loads settings from clinic/config.env (KEY=VALUE per line, UTF-8) into process.env.
 * Real environment variables take precedence. Lines starting with # are comments.
 */
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = process.env.CONFIG_FILE || path.join(__dirname, '..', 'config.env');

function parse(text) {
  const out = {};
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (/^[A-Z_][A-Z0-9_]*$/i.test(key)) out[key] = value;
  }
  return out;
}

function load(file = CONFIG_PATH) {
  if (!fs.existsSync(file)) return {};
  const values = parse(fs.readFileSync(file, 'utf8'));
  for (const [k, v] of Object.entries(values)) {
    if (process.env[k] === undefined && v !== '') process.env[k] = v;
  }
  return values;
}

load();
process.env.TZ = process.env.TZ || 'Asia/Ho_Chi_Minh';

module.exports = { parse, load, CONFIG_PATH };
