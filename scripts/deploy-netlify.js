'use strict';

/**
 * Deploy BeatThread to Netlify (zerric's team account).
 *
 * Steps:
 *   1. Load credentials from the repo-root .env (NETLIFY_AUTH_TOKEN).
 *   2. Find or create the Netlify site named "beatthread".
 *   3. Put NETLIFY_SITE_ID / NETLIFY_AUTH_TOKEN into the site's environment
 *      so the API function can persist to Netlify Blobs.
 *   4. Deploy the public/ dir + functions to production via netlify-cli.
 *
 * Usage: node scripts/deploy-netlify.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ENV_FILE = path.join(ROOT, '..', '.env');
const SITE_NAME = 'beatthread';
const NETLIFY_API = 'https://api.netlify.com/api/v1';

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
}
loadEnv(ENV_FILE);

// zerric's team hosts BeatThread (fall back to the Z Dot account if needed).
const TOKEN = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_AUTH_TOKEN_ZDOT;

if (!TOKEN) {
  console.error('NETLIFY_AUTH_TOKEN is missing (check ../.env)');
  process.exit(1);
}

async function api(method, urlPath, body) {
  const res = await fetch(NETLIFY_API + urlPath, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function findOrCreateSite() {
  const { data: sites } = await api('GET', '/sites?per_page=100');
  const existing = (sites || []).find((s) => s.name === SITE_NAME);
  if (existing) {
    console.log(`✔ Using existing site "${SITE_NAME}" — ${existing.ssl_url || existing.url}`);
    return existing;
  }
  const { status, data } = await api('POST', '/sites', { name: SITE_NAME });
  if (status >= 300 || !data || !data.id) {
    throw new Error(`Could not create site (HTTP ${status}): ${JSON.stringify(data).slice(0, 300)}`);
  }
  console.log(`✔ Created site "${SITE_NAME}" — ${data.ssl_url || data.url}`);
  return data;
}

async function setSiteEnvVar(siteId, key, value) {
  try {
    const { data: accounts } = await api('GET', '/accounts');
    const accountId = Array.isArray(accounts) && accounts[0] && accounts[0].id;
    if (!accountId) throw new Error('no account found');
    const { status, data } = await api('POST', `/accounts/${accountId}/env?site_id=${siteId}`, [{
      key,
      values: [{ context: 'production', value }]
    }]);
    const alreadyExists = status === 422 && /already exists/i.test(JSON.stringify(data || ''));
    if (status >= 300 && !alreadyExists) {
      console.warn(`⚠ Could not set ${key} env var (HTTP ${status})`);
      return false;
    }
    console.log(`✔ ${key} env var present.`);
    return true;
  } catch (err) {
    console.warn(`⚠ Could not set ${key} env var: ${err.message}`);
    return false;
  }
}

async function main() {
  const site = await findOrCreateSite();

  // Blob persistence for the API function (manual siteID+token, like BizzyBee).
  await setSiteEnvVar(site.id, 'NETLIFY_SITE_ID', site.id);
  await setSiteEnvVar(site.id, 'NETLIFY_AUTH_TOKEN', TOKEN);

  console.log('\nDeploying via netlify-cli…');
  const deployArgs = [
    '-y', 'netlify-cli', 'deploy',
    '--dir', 'public',
    '--functions', 'netlify/functions',
    '--prod',
    '--site', site.id,
    '--message', 'BeatThread deploy'
  ];
  execFileSync('npx', deployArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      NETLIFY_AUTH_TOKEN: TOKEN,
      npm_config_cache: path.join(os.tmpdir(), 'npm-cache-bt'),
      XDG_CONFIG_HOME: path.join(os.tmpdir(), 'xdg-config-bt')
    }
  });

  console.log('\n──────────────────────────────────────────────');
  console.log(`  Live:  ${site.ssl_url || site.url}/`);
  console.log('──────────────────────────────────────────────');
}

main().catch((err) => {
  console.error('Deploy failed:', err.message);
  process.exit(1);
});
