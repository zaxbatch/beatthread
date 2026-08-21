'use strict';

const { getPlanId, publicPlan } = require('./plans');
const { DEFAULT_THEME, resolveThemeCss } = require('./themes');

/**
 * App settings: branding, mode, plan, menu, theme, JWT secret and Cloudinary
 * storage. A single settings document is created on first use with neutral
 * defaults — NO hardcoded credentials or owner-specific info. The owner
 * configures branding + Cloudinary at setup (admin panel), which keeps the
 * app fully personalizable and deployable by anyone.
 */

const MAX_MENU_ITEMS = 20;

function seedSettings() {
  return {
    siteName: 'BeatThread',
    tagline: 'Post your beats. Cover them. Vote on the best.',
    mode: 'community', // community | solo
    primaryColor: '#f59e0b',
    logoUrl: '',
    plan: 'starter',
    menu: [],
    theme: { name: DEFAULT_THEME, css: '' },
    jwtSecret: '',
    cloudinary: { cloudName: '', apiKey: '', apiSecret: '' },
  };
}

function getSettings(db) {
  let s = db.all('settings')[0];
  if (!s) {
    return db.insert('settings', seedSettings());
  }
  // Migrate older settings docs to the current shape.
  const want = seedSettings();
  const patch = {};
  for (const key of Object.keys(want)) {
    if (s[key] === undefined) patch[key] = want[key];
  }
  if (s.cloudinary && typeof s.cloudinary === 'object') {
    for (const k of ['cloudName', 'apiKey', 'apiSecret']) {
      if (s.cloudinary[k] === undefined) {
        if (!patch.cloudinary) patch.cloudinary = { ...s.cloudinary };
        patch.cloudinary[k] = '';
      }
    }
  }
  if (Object.keys(patch).length) {
    db.update('settings', s.id, patch);
    s = db.get('settings', s.id);
  }
  return s;
}

/**
 * Validate a menu array: [{ label, href, target }]. Returns the cleaned array,
 * or null when invalid.
 */
function cleanMenu(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const item of value.slice(0, MAX_MENU_ITEMS)) {
    if (!item || typeof item !== 'object') return null;
    const label = String(item.label || '').trim().slice(0, 40);
    const href = String(item.href || '').trim().slice(0, 300);
    if (!label || !href) return null;
    out.push({ label, href, target: item.target === '_blank' ? '_blank' : '_self' });
  }
  return out;
}

/** Branding/status only — never the Cloudinary secret or JWT secret. */
function publicSettings(s) {
  const plan = publicPlan(s);
  return {
    siteName: s.siteName,
    tagline: s.tagline,
    mode: s.mode,
    primaryColor: s.primaryColor,
    logoUrl: s.logoUrl || '',
    plan,
    menu: Array.isArray(s.menu) ? s.menu : [],
    theme: {
      name: (s.theme && s.theme.name) || DEFAULT_THEME,
      css: resolveThemeCss(s.theme),
    },
    whiteLabel: plan.limits.whiteLabel,
    cloudinaryConfigured: Boolean(s.cloudinary && s.cloudinary.cloudName && s.cloudinary.apiKey && s.cloudinary.apiSecret),
  };
}

module.exports = { getSettings, publicSettings, cleanMenu, seedSettings };
