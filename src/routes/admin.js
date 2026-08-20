'use strict';

const express = require('express');
const { requireAuth } = require('../auth');
const { getSettings } = require('../settings');

/**
 * Admin panel API (admin role only).
 *
 *   GET  /api/admin/settings              — branding + mode + cloudinary (full)
 *   PUT  /api/admin/settings              — update branding/mode/cloudinary
 *   DELETE /api/admin/beats/:id           — moderate: delete a beat + versions
 *   DELETE /api/admin/versions/:id        — moderate: delete a version + votes
 *   GET  /api/admin/users                 — user list
 *   GET  /api/admin/users/export.csv      — CSV for CRM import
 */

function csvEscape(value) {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function adminRouter(db) {
  const router = express.Router();

  router.use(requireAuth(db), (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });

  // ---- Settings / branding ------------------------------------------------

  router.get('/settings', (req, res) => {
    const s = getSettings(db);
    res.json(s); // full settings incl. cloudinary (admin's own config)
  });

  router.put('/settings', (req, res) => {
    const s = getSettings(db);
    const body = req.body || {};
    const patch = {};
    if (body.siteName !== undefined) patch.siteName = String(body.siteName).trim().slice(0, 80) || s.siteName;
    if (body.tagline !== undefined) patch.tagline = String(body.tagline).trim().slice(0, 200);
    if (body.mode !== undefined) patch.mode = body.mode === 'solo' ? 'solo' : 'community';
    if (body.primaryColor !== undefined) patch.primaryColor = String(body.primaryColor).trim().slice(0, 20);
    if (body.logoUrl !== undefined) patch.logoUrl = String(body.logoUrl).trim().slice(0, 500);
    if (body.cloudinary && typeof body.cloudinary === 'object') {
      const c = { ...(s.cloudinary || {}) };
      if (body.cloudinary.cloudName !== undefined) c.cloudName = String(body.cloudinary.cloudName).trim();
      if (body.cloudinary.apiKey !== undefined) c.apiKey = String(body.cloudinary.apiKey).trim();
      if (body.cloudinary.apiSecret !== undefined) c.apiSecret = String(body.cloudinary.apiSecret).trim();
      patch.cloudinary = c;
    }
    db.update('settings', s.id, patch);
    res.json(getSettings(db));
  });

  // ---- Moderation ----------------------------------------------------------

  router.delete('/beats/:id', (req, res) => {
    const beat = db.get('beats', req.params.id);
    if (!beat) return res.status(404).json({ error: 'Beat not found' });
    db.all('versions').filter((v) => v.beatId === beat.id).forEach((v) => {
      db.all('votes').filter((x) => x.versionId === v.id).forEach((x) => db.remove('votes', x.id));
      db.remove('versions', v.id);
    });
    db.remove('beats', beat.id);
    res.status(204).end();
  });

  router.delete('/versions/:id', (req, res) => {
    const version = db.get('versions', req.params.id);
    if (!version) return res.status(404).json({ error: 'Version not found' });
    db.all('votes').filter((x) => x.versionId === version.id).forEach((x) => db.remove('votes', x.id));
    db.remove('versions', version.id);
    res.status(204).end();
  });

  // ---- Users + CSV export --------------------------------------------------

  router.get('/users', (req, res) => {
    res.json(db.all('users').map((u) => ({
      id: u.id, name: u.name || '', email: u.email, phone: u.phone || '',
      role: u.role || 'user', createdAt: u.createdAt
    })));
  });

  router.get('/users/export.csv', (req, res) => {
    const headers = ['name', 'email', 'phone', 'role', 'createdAt'];
    const lines = [headers.map(csvEscape).join(',')];
    for (const u of db.all('users')) {
      lines.push(headers.map((h) => csvEscape(u[h] || '')).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="beatthread-users.csv"');
    res.send('\uFEFF' + lines.join('\r\n') + '\r\n');
  });

  return router;
}

module.exports = adminRouter;
