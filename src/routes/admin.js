'use strict';

const express = require('express');
const { requireRole, isAdminLike } = require('../auth');
const { getSettings, cleanMenu } = require('../settings');
const { PLANS, PLAN_IDS, getPlan, limit } = require('../plans');
const { THEMES, THEME_NAMES, DEFAULT_THEME } = require('../themes');

/**
 * Admin panel API (admin + super roles).
 *
 *   GET  /api/admin/settings             — full settings (owner's config)
 *   PUT  /api/admin/settings             — branding/mode/menu/theme/storage
 *   GET  /api/admin/themes               — built-in theme list
 *   GET  /api/admin/plans                — pricing + limits (read-only)
 *   DELETE /api/admin/beats/:id          — moderate: delete a beat + versions
 *   DELETE /api/admin/versions/:id       — moderate: delete a version + votes
 *   GET  /api/admin/users                — user list
 *   GET  /api/admin/users/export.csv     — CSV for CRM import
 *
 * Plan + JWT secret changes are super-only (the owner controls billing/SSO).
 */

function csvEscape(value) {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function adminRouter(db) {
  const router = express.Router();

  router.use(requireRole(db, ['admin', 'super']));

  // ---- Settings / branding -------------------------------------------------

  router.get('/settings', (req, res) => {
    res.json(getSettings(db)); // full settings incl. cloudinary (owner's config)
  });

  router.put('/settings', (req, res) => {
    const s = getSettings(db);
    const body = req.body || {};
    const patch = {};
    const isSuper = req.user.role === 'super';

    if (body.siteName !== undefined) patch.siteName = String(body.siteName).trim().slice(0, 80) || s.siteName;
    if (body.tagline !== undefined) patch.tagline = String(body.tagline).trim().slice(0, 200);
    if (body.mode !== undefined) patch.mode = body.mode === 'solo' ? 'solo' : 'community';
    if (body.primaryColor !== undefined) patch.primaryColor = String(body.primaryColor).trim().slice(0, 20);
    if (body.logoUrl !== undefined) patch.logoUrl = String(body.logoUrl).trim().slice(0, 500);

    // Menu links — a Pro feature (owner can always set them).
    if (body.menu !== undefined) {
      const menu = cleanMenu(body.menu);
      if (menu === null) return res.status(400).json({ error: 'menu must be [{label, href, target}]' });
      const menuLimit = limit(s, 'menuItems');
      if (req.user.role !== 'super' && menu.length > menuLimit) {
        return res.status(403).json({
          error: `Your ${getPlan(s).name} plan allows ${menuLimit} menu item${menuLimit === 1 ? '' : 's'} — upgrade to add more`,
          code: 'PLAN_LIMIT',
        });
      }
      patch.menu = menu;
    }

    // Theme: built-in name (all plans) or custom CSS (a Pro feature).
    if (body.theme !== undefined) {
      const t = body.theme || {};
      const name = String(t.name || DEFAULT_THEME);
      if (!THEME_NAMES.includes(name) && name !== 'custom') {
        return res.status(400).json({ error: `Unknown theme "${name}"` });
      }
      let css = '';
      if (name === 'custom') {
        css = String(t.css || '').trim();
        if (css.length > 100000) return res.status(400).json({ error: 'Theme CSS is too large (max 100 KB)' });
        if (req.user.role !== 'super' && !limit(s, 'customThemes')) {
          return res.status(403).json({ error: 'Custom themes are a Pro feature — upgrade to upload CSS', code: 'PLAN_LIMIT' });
        }
      }
      patch.theme = { name, css };
    }

    // Cloudinary storage.
    if (body.cloudinary && typeof body.cloudinary === 'object') {
      const c = { ...(s.cloudinary || {}) };
      if (body.cloudinary.cloudName !== undefined) c.cloudName = String(body.cloudinary.cloudName).trim();
      if (body.cloudinary.apiKey !== undefined) c.apiKey = String(body.cloudinary.apiKey).trim();
      if (body.cloudinary.apiSecret !== undefined) c.apiSecret = String(body.cloudinary.apiSecret).trim();
      patch.cloudinary = c;
    }

    // Plan + JWT secret: super only.
    if (body.plan !== undefined) {
      if (!isSuper) return res.status(403).json({ error: 'Only the super user can change the plan' });
      if (!PLAN_IDS.includes(String(body.plan))) return res.status(400).json({ error: `Unknown plan "${body.plan}"` });
      patch.plan = String(body.plan);
    }
    if (body.jwtSecret !== undefined) {
      if (!isSuper) return res.status(403).json({ error: 'Only the super user can configure JWT login' });
      patch.jwtSecret = String(body.jwtSecret || '').trim();
    }

    db.update('settings', s.id, patch);
    res.json(getSettings(db));
  });

  // ---- Themes + plans (read-only info) --------------------------------------

  router.get('/themes', (req, res) => {
    res.json(THEME_NAMES.map((name) => ({ name, label: THEMES[name].label, description: THEMES[name].description })));
  });

  router.get('/plans', (req, res) => {
    res.json(Object.values(PLANS).map((p) => ({
      id: p.id, name: p.name, priceMonthly: p.priceMonthly, limits: p.limits,
    })));
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
