'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');
const { signJwt } = require('../src/jwt');

const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bt-feat-')), 'db.json');
let server;
let base;
let superToken;
let userToken;
let adminStaffToken = null;

before(async () => {
  const app = createApp({ dataFile: tmpFile, log: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  try { fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true }); } catch {}
});

async function api(method, url, body, tok) {
  const headers = body ? { 'Content-Type': 'application/json' } : {};
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

test('bootstrap: super user + a regular user + beats', async () => {
  const sup = await api('POST', '/api/auth/register', { name: 'Owner', email: 'owner@x.dev', password: 'ownerpass123' });
  assert.strictEqual(sup.json.user.role, 'super');
  superToken = sup.json.token;
  const usr = await api('POST', '/api/auth/register', { name: 'Fan', email: 'fan@x.dev', password: 'fanpass1234' });
  assert.strictEqual(usr.json.user.role, 'user');
  userToken = usr.json.token;

  await api('PUT', '/api/admin/settings', { cloudinary: { cloudName: 'c', apiKey: 'k', apiSecret: 's' } }, superToken);
  const beat = await api('POST', '/api/beats', { title: 'Plan Beat', audioUrl: 'https://x.example/a.mp3' }, superToken);
  assert.strictEqual(beat.status, 201);
});

test('Starter plan limits regular users but not the owner', async () => {
  // Owner (super) always bypasses limits.
  for (let i = 0; i < 4; i++) {
    const b = await api('POST', '/api/beats', { title: 'Owner Beat ' + i, audioUrl: 'https://x.example/o' + i + '.mp3' }, superToken);
    assert.strictEqual(b.status, 201, 'owner bypasses the Starter beat limit');
  }
  // Regular user hits the Starter beat limit (3 beats total).
  const blocked = await api('POST', '/api/beats', { title: 'Fan Beat', audioUrl: 'https://x.example/f.mp3' }, userToken);
  assert.strictEqual(blocked.status, 403);
  assert.strictEqual(blocked.json.code, 'PLAN_LIMIT');

  // Super switches to Pro → user can post.
  await api('PUT', '/api/super/plan', { plan: 'pro' }, superToken);
  const ok = await api('POST', '/api/beats', { title: 'Fan Beat Pro', audioUrl: 'https://x.example/fp.mp3' }, userToken);
  assert.strictEqual(ok.status, 201);
  await api('PUT', '/api/super/plan', { plan: 'starter' }, superToken);
});

test('downloads are plan-gated but owner bypasses', async () => {
  const thread = await api('GET', '/api/beats?sort=new');
  const beat = await api('GET', `/api/beats/${thread.json[0].id}`);
  const version = beat.json.versions[0];

  // Starter: download blocked for everyone except owner.
  const blocked = await api('GET', `/api/beats/versions/${version.id}/download`);
  assert.strictEqual(blocked.status, 403);
  // Owner can always download (the proxy will 502 on the fake host, not 403).
  const ownerDl = await fetch(base + `/api/beats/versions/${version.id}/download`, { headers: { Authorization: `Bearer ${superToken}` } });
  assert.notStrictEqual(ownerDl.status, 403);

  // Pro: public download allowed (will attempt the host).
  await api('PUT', '/api/super/plan', { plan: 'pro' }, superToken);
  const pubDl = await fetch(base + `/api/beats/versions/${version.id}/download`);
  assert.notStrictEqual(pubDl.status, 403);
  await api('PUT', '/api/super/plan', { plan: 'starter' }, superToken);
});

test('menu links are a Pro feature; owner can set them', async () => {
  const menu = [{ label: 'Store', href: 'https://example.com/store', target: '_blank' }];
  // Owner (super) bypasses the Starter menu limit (0).
  const set = await api('PUT', '/api/admin/settings', { menu }, superToken);
  assert.strictEqual(set.status, 200);
  const pub = await api('GET', '/api/settings');
  assert.deepStrictEqual(pub.json.menu, menu);

  // Admin (non-super) on Starter cannot exceed the menu limit.
  const admin = await api('POST', '/api/auth/register', { name: 'Admin2', email: 'admin2@x.dev', password: 'adminpass123' });
  await api('PUT', `/api/super/users/${admin.json.user.id}/role`, { role: 'admin' }, superToken);
  const adminTok = (await api('POST', '/api/auth/login', { email: 'admin2@x.dev', password: 'adminpass123' })).json.token;
  adminStaffToken = adminTok;
  const blocked = await api('PUT', '/api/admin/settings', { menu: [{ label: 'A', href: '/a' }, { label: 'B', href: '/b' }] }, adminTok);
  assert.strictEqual(blocked.status, 403);
  assert.strictEqual(blocked.json.code, 'PLAN_LIMIT');
  await api('PUT', '/api/admin/settings', { menu: [] }, superToken);
});

test('themes: built-ins always available; custom CSS is Pro-only', async () => {
  const themes = await api('GET', '/api/admin/themes', null, superToken);
  assert.ok(themes.json.some((t) => t.name === 'midnight') && themes.json.some((t) => t.name === 'neon'));

  // Starter: custom CSS blocked for staff (the super user bypasses).
  const blocked = await api('PUT', '/api/admin/settings', { theme: { name: 'custom', css: ':root{--primary:#f00}' } }, adminStaffToken);
  assert.strictEqual(blocked.status, 403);
  assert.strictEqual(blocked.json.code, 'PLAN_LIMIT');

  // Built-in themes are free.
  const setTheme = await api('PUT', '/api/admin/settings', { theme: { name: 'midnight', css: '' } }, superToken);
  assert.strictEqual(setTheme.status, 200);
  const pub = await api('GET', '/api/settings');
  assert.strictEqual(pub.json.theme.name, 'midnight');
  assert.ok(pub.json.theme.css.includes('--primary'));

  // Pro: custom CSS allowed + applied.
  await api('PUT', '/api/super/plan', { plan: 'pro' }, superToken);
  const custom = await api('PUT', '/api/admin/settings', { theme: { name: 'custom', css: ':root{--primary:#ff0000}' } }, superToken);
  assert.strictEqual(custom.status, 200);
  const pub2 = await api('GET', '/api/settings');
  assert.strictEqual(pub2.json.theme.css, ':root{--primary:#ff0000}');
  await api('PUT', '/api/admin/settings', { theme: { name: 'beatthread', css: '' } }, superToken);
  await api('PUT', '/api/super/plan', { plan: 'starter' }, superToken);
});

test('JWT login: configured by super, verifies HS256, maps to account email', async () => {
  const secret = 'shh-secret';
  const cfg = await api('PUT', '/api/admin/settings', { jwtSecret: secret }, superToken);
  assert.strictEqual(cfg.status, 200);

  // Valid token for the fan account.
  const good = signJwt({ sub: 'fan@x.dev', name: 'Fan' }, secret);
  const login = await api('POST', '/api/auth/jwt', { token: good });
  assert.strictEqual(login.status, 200);
  assert.strictEqual(login.json.user.email, 'fan@x.dev');
  assert.ok(login.json.token);

  // Tampered token rejected.
  const bad = await api('POST', '/api/auth/jwt', { token: good.slice(0, -1) + (good.endsWith('a') ? 'b' : 'a') });
  assert.strictEqual(bad.status, 401);

  // Unknown account rejected.
  const ghost = await api('POST', '/api/auth/jwt', { token: signJwt({ sub: 'ghost@x.dev' }, secret) });
  assert.strictEqual(ghost.status, 401);

  // Not configured → 400.
  await api('PUT', '/api/admin/settings', { jwtSecret: '' }, superToken);
  const unset = await api('POST', '/api/auth/jwt', { token: good });
  assert.strictEqual(unset.status, 400);
});

test('super manages subscribers: promote admin, delete user, guardrails', async () => {
  // Regular user cannot touch super routes.
  const denied = await api('GET', '/api/super/users', null, userToken);
  assert.strictEqual(denied.status, 403);

  // Super lists users with stats.
  const users = await api('GET', '/api/super/users', null, superToken);
  assert.strictEqual(users.status, 200);
  assert.ok(users.json.some((u) => u.email === 'fan@x.dev' && typeof u.stats === 'object'));

  // Promote fan → admin.
  const fan = users.json.find((u) => u.email === 'fan@x.dev');
  const promoted = await api('PUT', `/api/super/users/${fan.id}/role`, { role: 'admin' }, superToken);
  assert.strictEqual(promoted.status, 200);
  assert.strictEqual(promoted.json.role, 'admin');

  // Super cannot change their own role.
  const self = await api('PUT', `/api/super/users/${users.json.find((u) => u.role === 'super').id}/role`, { role: 'user' }, superToken);
  assert.strictEqual(self.status, 400);

  // Delete a subscriber (admin2).
  const admin2 = users.json.find((u) => u.email === 'admin2@x.dev');
  const del = await api('DELETE', `/api/super/users/${admin2.id}`, null, superToken);
  assert.strictEqual(del.status, 204);
  const after = await api('GET', '/api/super/users', null, superToken);
  assert.ok(!after.json.some((u) => u.email === 'admin2@x.dev'));
});

test('embed endpoint returns a public single version', async () => {
  const feed = await api('GET', '/api/beats');
  const thread = await api('GET', `/api/beats/${feed.json[0].id}`);
  const v = thread.json.versions[0];
  const got = await api('GET', `/api/beats/versions/${v.id}`);
  assert.strictEqual(got.status, 200);
  assert.strictEqual(got.json.id, v.id);
  assert.ok(got.json.audioUrl);
  assert.strictEqual(got.json.beatTitle, thread.json.title);
});
