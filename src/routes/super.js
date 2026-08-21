'use strict';

const express = require('express');
const { requireRole } = require('../auth');
const { getSettings } = require('../settings');
const { PLANS, PLAN_IDS } = require('../plans');

/**
 * Super-user API — the owner above all admins. Manages subscribers, roles
 * and the install's plan.
 *
 *   GET  /api/super/users              — all subscribers with content stats
 *   PUT  /api/super/users/:id/role     — set role: super | admin | user
 *   DELETE /api/super/users/:id        — remove a subscriber + their content
 *   PUT  /api/super/plan               — set the install's plan
 *   GET  /api/super/plans              — pricing (for the UI)
 */

function contentStats(db, userId) {
  return {
    beats: db.all('beats').filter((b) => b.producerId === userId).length,
    versions: db.all('versions').filter((v) => v.producerId === userId).length,
    comments: db.all('comments').filter((c) => c.userId === userId).length,
  };
}

function superRouter(db) {
  const router = express.Router();
  router.use(requireRole(db, ['super']));

  // GET /api/super/users — all accounts (subscribers) with stats.
  router.get('/users', (req, res) => {
    res.json(db.all('users').map((u) => ({
      id: u.id, name: u.name || '', email: u.email, phone: u.phone || '',
      role: u.role || 'user', createdAt: u.createdAt, stats: contentStats(db, u.id),
    })));
  });

  // PUT /api/super/users/:id/role — promote/demote (with guardrails).
  router.put('/users/:id/role', (req, res) => {
    const target = db.get('users', req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const role = String((req.body || {}).role || '');
    if (!['super', 'admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'role must be super, admin or user' });
    }
    if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot change your own role' });
    if (target.role === 'super' && role !== 'super') {
      const supers = db.all('users').filter((u) => u.role === 'super');
      if (supers.length <= 1) return res.status(400).json({ error: 'Cannot demote the last super user' });
    }
    db.update('users', target.id, { role });
    res.json({ id: target.id, email: target.email, role });
  });

  // DELETE /api/super/users/:id — remove a subscriber + their content.
  router.delete('/users/:id', (req, res) => {
    const target = db.get('users', req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
    if (target.role === 'super') {
      const supers = db.all('users').filter((u) => u.role === 'super');
      if (supers.length <= 1) return res.status(400).json({ error: 'Cannot delete the last super user' });
    }
    // Remove their sessions, comments, beats, versions and votes.
    db.all('sessions').filter((s) => s.userId === target.id).forEach((s) => db.remove('sessions', s.id));
    db.all('comments').filter((c) => c.userId === target.id).forEach((c) => db.remove('comments', c.id));
    const beatIds = db.all('beats').filter((b) => b.producerId === target.id).map((b) => b.id);
    const versionIds = db.all('versions').filter((v) => v.producerId === target.id || beatIds.includes(v.beatId)).map((v) => v.id);
    db.all('votes').filter((x) => versionIds.includes(x.versionId)).forEach((x) => db.remove('votes', x.id));
    versionIds.forEach((id) => db.remove('versions', id));
    beatIds.forEach((id) => db.remove('beats', id));
    db.remove('users', target.id);
    res.status(204).end();
  });

  // PUT /api/super/plan — set the install's plan.
  router.put('/plan', (req, res) => {
    const plan = String((req.body || {}).plan || '');
    if (!PLAN_IDS.includes(plan)) return res.status(400).json({ error: `Unknown plan "${plan}"` });
    const s = getSettings(db);
    db.update('settings', s.id, { plan });
    res.json({ plan });
  });

  // GET /api/super/plans — pricing for the UI.
  router.get('/plans', (req, res) => {
    res.json(Object.values(PLANS).map((p) => ({
      id: p.id, name: p.name, priceMonthly: p.priceMonthly,
      limits: Object.fromEntries(Object.entries(p.limits).map(([k, v]) => [k, Number.isFinite(v) ? v : 'unlimited'])),
    })));
  });

  return router;
}

module.exports = superRouter;
