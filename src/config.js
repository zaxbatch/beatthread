'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Minimal .env loader (no dependency). Reads KEY=VALUE lines from the given
 * file into process.env without overwriting values that are already set.
 * Falls back to the repo-root .env (one level above this project) so the
 * shared Z Dot LLC credentials are picked up when running locally.
 */
function loadEnvFile(file) {
  if (!file || !fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(__dirname, '..', '..', '.env'));

module.exports = {
  port: process.env.PORT || 3000,
  // Data file lives outside src so it is easy to back up / reset.
  dataFile: process.env.BT_DATA_FILE || path.join(__dirname, '..', 'data', 'db.json')
};
