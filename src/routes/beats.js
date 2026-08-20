'use strict';

const express = require('express');
const { requireAuth } = require('../auth');
const { validateBeat, validateVersion } = require('../validators');
const { getSettings } = require('../settings');
const { signUpload } = require('../cloudinary');

/**
 * Beats, versions and votes.
 *
 *   GET  /api/beats?sort=new|top        — public feed
 *   GET  /api/beats/:id                 — thread with versions, best first
 *   GET  /api/beats/upload/sign         — auth: Cloudinary signed upload params
 *   POST /api/beats                     — auth: create beat + original version
 *   POST /api/beats/:id/versions        — auth: add a cover version
 *   POST /api/versions/:id/vote         — auth: { value: 1 | -1 } (same vote = remove)
 */

function netVotes(db, version) {
  return db.all('votes').filter((v) => v.versionId === version.id).reduce((s, v) => s + (v.value || 0), 0);
}

function producerName(db, userId) {
  const u = db.get('users', userId);
  return u ? (u.name || u.email) : 'Unknown';
}

function publicVersion(db, v, userId) {
  const myVote = userId ? db.all('votes').find((x) => x.versionId === v.id && x.userId === userId) : null;
  return {
    ...v,
    producerName: producerName(db, v.producerId),
    netVotes: netVotes(db, v),
    myVote: myVote ? myVote.value : 0
  };
}

function publicBeat(db, b, userId) {
  const versions = db.all('versions').filter((v) => v.beatId === b.id && v.status !== 'hidden');
  const sorted = versions.slice().sort((a, x) => netVotes(db, x) - netVotes(db, a));
  return {
    ...b,
    producerName: producerName(db, b.producerId),
    versionCount: versions.length,
    topVersion: sorted[0] ? publicVersion(db, sorted[0], userId) : null
  };
}

function beatsRouter(db) {
  const router = express.Router();

  // Public: feed, newest or best-version-first.
  router.get('/', (req, res) => {
    const sort = req.query.sort === 'top' ? 'top' : 'new';
    const list = db.all('beats')
      .filter((b) => b.status !== 'hidden')
      .map((b) => publicBeat(db, b, req.userId));
    if (sort === 'top') {
      list.sort((a, b) => (b.topVersion ? b.topVersion.netVotes : 0) - (a.topVersion ? a.topVersion.netVotes : 0));
    } else {
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    res.json(list);
  });

  // Auth: signed Cloudinary upload params (before POSTing audio/image).
  router.get('/upload/sign', requireAuth(db), (req, res) => {
    const type = req.query.type === 'image' ? 'image' : 'video';
    const params = signUpload(getSettings(db).cloudinary, { folder: type === 'image' ? 'beatthread/covers' : 'beatthread', resourceType: type });
    if (!params) {
      return res.status(400).json({ error: 'Cloudinary is not configured — an admin must add it in Settings → Storage' });
    }
    res.json(params);
  });

  // Auth: create a beat with the original version.
  router.post('/', requireAuth(db), (req, res) => {
    const settings = getSettings(db);
    if (settings.mode === 'solo' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'This site is in solo mode — only the owner posts beats' });
    }
    const errors = validateBeat(req.body || {});
    if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });
    const audioUrl = String((req.body || {}).audioUrl || '').trim();
    if (!audioUrl) return res.status(400).json({ error: 'audioUrl is required — upload your beat first' });

    const beat = db.insert('beats', {
      title: String(req.body.title).trim(),
      description: String(req.body.description || '').trim(),
      genre: String(req.body.genre || '').trim(),
      bpm: String(req.body.bpm || '').trim(),
      coverUrl: String(req.body.coverUrl || '').trim(),
      producerId: req.userId,
      status: 'active'
    });
    const version = db.insert('versions', {
      beatId: beat.id,
      title: 'Original',
      producerId: req.userId,
      audioUrl,
      isOriginal: true,
      status: 'active'
    });
    res.status(201).json({ beat: publicBeat(db, beat, req.userId), version: publicVersion(db, version, req.userId) });
  });

  // Public: thread with versions sorted best-first.
  router.get('/:id', (req, res) => {
    const b = db.get('beats', req.params.id);
    if (!b || b.status === 'hidden') return res.status(404).json({ error: 'Beat not found' });
    const versions = db.all('versions')
      .filter((v) => v.beatId === b.id && v.status !== 'hidden')
      .sort((a, x) => netVotes(db, x) - netVotes(db, a));
    res.json({ ...publicBeat(db, b, req.userId), versions: versions.map((v) => publicVersion(db, v, req.userId)) });
  });

  // Auth: add a cover version.
  router.post('/:id/versions', requireAuth(db), (req, res) => {
    const beat = db.get('beats', req.params.id);
    if (!beat || beat.status === 'hidden') return res.status(404).json({ error: 'Beat not found' });
    const settings = getSettings(db);
    if (settings.mode === 'solo' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'This site is in solo mode — only the owner posts' });
    }
    const errors = validateVersion(req.body || {});
    if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });
    const version = db.insert('versions', {
      beatId: beat.id,
      title: String(req.body.title).trim(),
      producerId: req.userId,
      audioUrl: String(req.body.audioUrl).trim(),
      coverUrl: String(req.body.coverUrl || '').trim(),
      isOriginal: false,
      status: 'active'
    });
    res.status(201).json(publicVersion(db, version, req.userId));
  });

  // Auth: vote on a version.
  router.post('/versions/:id/vote', requireAuth(db), (req, res) => {
    const version = db.get('versions', req.params.id);
    if (!version || version.status === 'hidden') return res.status(404).json({ error: 'Version not found' });
    const value = Number((req.body || {}).value || 0);
    if (value !== 1 && value !== -1) return res.status(400).json({ error: 'value must be 1 or -1' });

    const existing = db.all('votes').find((v) => v.versionId === version.id && v.userId === req.userId);
    let myVote;
    if (existing) {
      if (existing.value === value) { db.remove('votes', existing.id); myVote = 0; }
      else { db.update('votes', existing.id, { value }); myVote = value; }
    } else {
      db.insert('votes', { versionId: version.id, userId: req.userId, value });
      myVote = value;
    }
    res.json({ netVotes: netVotes(db, version), myVote });
  });

  return router;
}

module.exports = beatsRouter;
