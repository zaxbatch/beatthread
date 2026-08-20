'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');

const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bt-test-')), 'db.json');
let server;
let base;
let adminToken;
let userToken;
let beatId;

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

test('health is public', async () => {
  const { status, json } = await api('GET', '/api/health');
  assert.strictEqual(status, 200);
  assert.strictEqual(json.status, 'ok');
});

test('first registered user becomes admin', async () => {
  const { status, json } = await api('POST', '/api/auth/register', { name: 'Pro', email: 'pro@example.com', password: 'producer123' });
  assert.strictEqual(status, 201);
  assert.strictEqual(json.user.role, 'admin');
  adminToken = json.token;
});

test('public settings expose branding but never the Cloudinary secret', async () => {
  const { status, json } = await api('GET', '/api/settings');
  assert.strictEqual(status, 200);
  assert.strictEqual(json.siteName, 'BeatThread');
  assert.strictEqual(json.cloudinaryConfigured, true);
  assert.strictEqual(json.apiSecret, undefined);
  assert.strictEqual(json.cloudinary, undefined);
});

test('second user registers as regular user', async () => {
  const { json } = await api('POST', '/api/auth/register', { name: 'Singer', email: 'singer@example.com', password: 'singer1234' });
  assert.strictEqual(json.user.role, 'user');
  userToken = json.token;
});

test('posting requires auth', async () => {
  const { status } = await api('POST', '/api/beats', { title: 'x', audioUrl: 'x.mp3' });
  assert.strictEqual(status, 401);
});

test('upload/sign returns valid Cloudinary params (signature checkable)', async () => {
  const { status, json } = await api('GET', '/api/beats/upload/sign', null, adminToken);
  assert.strictEqual(status, 200);
  assert.strictEqual(json.cloudName, 'r6natkse');
  assert.ok(json.apiKey && json.timestamp && json.signature);
  // Recompute the signature from the public params + known secret.
  // (resource_type is part of the upload URL and is NOT signed.)
  const params = { timestamp: json.timestamp, folder: json.folder };
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&') + 'UJh4kBlNk8OD3M34kAi9U216I6Y';
  assert.strictEqual(json.signature, crypto.createHash('sha1').update(toSign).digest('hex'));
});

test('create a beat with the original version', async () => {
  const { status, json } = await api('POST', '/api/beats', {
    title: 'Summer Vibe', description: 'chill boom bap', genre: 'Hip-Hop', bpm: '92',
    audioUrl: 'https://res.cloudinary.com/r6natkse/video/upload/v1/beatthread/test.mp3'
  }, adminToken);
  assert.strictEqual(status, 201);
  assert.strictEqual(json.beat.title, 'Summer Vibe');
  assert.strictEqual(json.beat.versionCount, 1);
  assert.strictEqual(json.beat.topVersion.isOriginal, true);
  assert.strictEqual(json.beat.producerName, 'Pro');
  beatId = json.beat.id;
});

test('a second user adds a cover version', async () => {
  const { status, json } = await api('POST', `/api/beats/${beatId}/versions`, {
    title: 'Full Song Cover', audioUrl: 'https://res.cloudinary.com/r6natkse/video/upload/v1/beatthread/cover.mp3'
  }, userToken);
  assert.strictEqual(status, 201);
  assert.strictEqual(json.isOriginal, false);
  assert.strictEqual(json.producerName, 'Singer');
});

test('voting: upvotes and downvotes, toggle off, best-first ordering', async () => {
  const thread = await api('GET', `/api/beats/${beatId}`);
  const orig = thread.json.versions.find((v) => v.isOriginal);
  const cover = thread.json.versions.find((v) => !v.isOriginal);

  // singer upvotes original; pro upvotes cover → both 1 → stable order
  await api('POST', `/api/beats/versions/${orig.id}/vote`, { value: 1 }, userToken);
  await api('POST', `/api/beats/versions/${cover.id}/vote`, { value: 1 }, adminToken);
  let t = await api('GET', `/api/beats/${beatId}`);
  assert.strictEqual(t.json.versions.find((v) => v.id === orig.id).netVotes, 1);
  assert.strictEqual(t.json.versions.find((v) => v.id === cover.id).netVotes, 1);

  // pro downvotes original → cover (2) beats original (0)
  await api('POST', `/api/beats/versions/${orig.id}/vote`, { value: -1 }, adminToken);
  t = await api('GET', `/api/beats/${beatId}`);
  assert.strictEqual(t.json.versions[0].id, cover.id);
  assert.strictEqual(t.json.versions[0].netVotes, 1);
  assert.strictEqual(t.json.versions[1].netVotes, 0);

  // toggle off: pro removes the downvote
  const after = await api('POST', `/api/beats/versions/${orig.id}/vote`, { value: -1 }, adminToken);
  assert.strictEqual(after.json.myVote, 0);

  // invalid value rejected
  const bad = await api('POST', `/api/beats/versions/${orig.id}/vote`, { value: 5 }, adminToken);
  assert.strictEqual(bad.status, 400);
});

test('voting requires auth', async () => {
  const thread = await api('GET', `/api/beats/${beatId}`);
  const v = thread.json.versions[0];
  const { status } = await api('POST', `/api/beats/versions/${v.id}/vote`, { value: 1 });
  assert.strictEqual(status, 401);
});

test('feed sorts by top version votes', async () => {
  const feed = await api('GET', '/api/beats?sort=top');
  assert.ok(feed.json.length >= 1);
  assert.strictEqual(feed.json[0].id, beatId);
});

test('admin updates branding; solo mode blocks non-admins from posting', async () => {
  const upd = await api('PUT', '/api/admin/settings', { siteName: 'My Beat Lab', mode: 'solo', primaryColor: '#22d3ee' }, adminToken);
  assert.strictEqual(upd.status, 200);
  assert.strictEqual(upd.json.siteName, 'My Beat Lab');
  assert.strictEqual(upd.json.mode, 'solo');

  const pub = await api('GET', '/api/settings');
  assert.strictEqual(pub.json.siteName, 'My Beat Lab');

  // non-admin cannot post in solo mode
  const blocked = await api('POST', '/api/beats', { title: 'Nope', audioUrl: 'x.mp3' }, userToken);
  assert.strictEqual(blocked.status, 403);
  // admin can
  const allowed = await api('POST', '/api/beats', { title: 'Owner Drop', audioUrl: 'y.mp3' }, adminToken);
  assert.strictEqual(allowed.status, 201);

  // back to community for the rest
  await api('PUT', '/api/admin/settings', { mode: 'community' }, adminToken);
});

test('non-admin cannot access the admin panel', async () => {
  const { status } = await api('GET', '/api/admin/settings', null, userToken);
  assert.strictEqual(status, 403);
  const csv = await api('GET', '/api/admin/users/export.csv', null, userToken);
  assert.strictEqual(csv.status, 403);
});

test('admin users list and CSV export (for CRM import)', async () => {
  const users = await api('GET', '/api/admin/users', null, adminToken);
  assert.strictEqual(users.status, 200);
  assert.strictEqual(users.json.length, 2);
  assert.ok(users.json.every((u) => u.email && u.name !== undefined));

  const res = await fetch(base + '/api/admin/users/export.csv', { headers: { Authorization: `Bearer ${adminToken}` } });
  const text = await res.text();
  assert.strictEqual(res.status, 200);
  assert.match(text, /^name,email,phone,role,createdAt/);
  assert.ok(text.includes('pro@example.com'));
  assert.ok(text.includes('singer@example.com'));
});

test('admin can moderate: delete a version, then a beat', async () => {
  const thread = await api('GET', `/api/beats/${beatId}`);
  const cover = thread.json.versions.find((v) => !v.isOriginal);

  const delV = await api('DELETE', `/api/admin/versions/${cover.id}`, null, adminToken);
  assert.strictEqual(delV.status, 204);
  let t = await api('GET', `/api/beats/${beatId}`);
  assert.strictEqual(t.json.versionCount, 1);

  const delB = await api('DELETE', `/api/admin/beats/${beatId}`, null, adminToken);
  assert.strictEqual(delB.status, 204);
  const gone = await api('GET', `/api/beats/${beatId}`);
  assert.strictEqual(gone.status, 404);
});

// ---- Comments, covers, leaderboard -----------------------------------------

test('beat with cover art and an image upload sign', async () => {
  const sign = await api('GET', '/api/beats/upload/sign?type=image', null, adminToken);
  assert.strictEqual(sign.status, 200);
  assert.strictEqual(sign.json.resource_type, 'image');

  const created = await api('POST', '/api/beats', {
    title: 'Cover Drop', audioUrl: 'https://x.example/a.mp3',
    coverUrl: 'https://res.cloudinary.com/r6natkse/image/upload/v1/beatthread/covers/c.png'
  }, adminToken);
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.json.beat.coverUrl, 'https://res.cloudinary.com/r6natkse/image/upload/v1/beatthread/covers/c.png');
  beatId = created.json.beat.id; // reuse for comment tests
});

test('comments: add, list, require auth, delete own, delete by admin', async () => {
  const thread = await api('GET', `/api/beats/${beatId}`);
  const v = thread.json.versions[0];

  // unauth post rejected
  const unauth = await api('POST', '/api/comments', { versionId: v.id, body: 'hi' });
  assert.strictEqual(unauth.status, 401);

  const c1 = await api('POST', '/api/comments', { versionId: v.id, body: 'Fire beat!' }, userToken);
  assert.strictEqual(c1.status, 201);
  assert.strictEqual(c1.json.authorName, 'Singer');
  const c2 = await api('POST', '/api/comments', { versionId: v.id, body: 'Thanks 🔥' }, adminToken);

  const list = await api('GET', `/api/comments?versionId=${v.id}`);
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.json.length, 2);
  assert.strictEqual(list.json[0].body, 'Fire beat!');

  // user cannot delete admin's comment
  const forbidden = await api('DELETE', `/api/comments/${c2.json.id}`, null, userToken);
  assert.strictEqual(forbidden.status, 403);
  // user can delete own
  const own = await api('DELETE', `/api/comments/${c1.json.id}`, null, userToken);
  assert.strictEqual(own.status, 204);
  // admin can delete any
  const adm = await api('DELETE', `/api/comments/${c2.json.id}`, null, adminToken);
  assert.strictEqual(adm.status, 204);
});

test('leaderboard ranks producers by votes and contributors by activity', async () => {
  // Give the producer (admin) a beat with votes: create one and vote it up.
  const created = await api('POST', '/api/beats', { title: 'Ranked Beat', audioUrl: 'https://x.example/r.mp3' }, adminToken);
  const thread = await api('GET', `/api/beats/${created.json.beat.id}`);
  const v = thread.json.versions[0];
  await api('POST', `/api/beats/versions/${v.id}/vote`, { value: 1 }, userToken);
  await api('POST', `/api/beats/versions/${v.id}/vote`, { value: 1 }, adminToken);
  // a comment for contributor score
  await api('POST', '/api/comments', { versionId: v.id, body: 'vibe' }, userToken);

  const lb = await api('GET', '/api/leaderboard');
  assert.strictEqual(lb.status, 200);
  assert.ok(lb.json.producers.some((p) => p.name === 'Pro' && p.netVotes >= 2));
  assert.ok(lb.json.contributors.some((c) => c.name === 'Singer' && c.comments >= 1));
  // producers sorted by net votes desc
  const votes = lb.json.producers.map((p) => p.netVotes);
  assert.deepStrictEqual(votes, [...votes].sort((a, b) => b - a));
});
