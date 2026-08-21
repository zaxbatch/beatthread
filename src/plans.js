'use strict';

/**
 * BeatThread — 3-tier SaaS plans (per install).
 *
 *   Starter  (free)    — try it: community feed, basic player, branding,
 *                        3 beats, 5 versions per beat, built-in themes
 *   Pro      ($19/mo)  — unlimited beats, cool player (waveform/EQ/orbit),
 *                        custom menu links, custom theme upload, downloads
 *   Business ($49/mo)  — everything + JWT login, white-label, subscriber
 *                        management via the super user, priority
 *
 * The install's plan lives on the settings document. The owner (super/admin)
 * always bypasses limits; they apply to regular users.
 */

const PLANS = {
  starter: {
    id: 'starter',
    name: 'Starter',
    priceMonthly: 0,
    limits: {
      beats: 3,
      versionsPerBeat: 5,
      menuItems: 0,
      playerModes: ['waveform'],
      customThemes: false,
      download: false,
      jwt: true,
      whiteLabel: false,
    },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceMonthly: 19,
    limits: {
      beats: Infinity,
      versionsPerBeat: Infinity,
      menuItems: 10,
      playerModes: ['waveform', 'eq', 'orbit'],
      customThemes: true,
      download: true,
      jwt: true,
      whiteLabel: false,
    },
  },
  business: {
    id: 'business',
    name: 'Business',
    priceMonthly: 49,
    limits: {
      beats: Infinity,
      versionsPerBeat: Infinity,
      menuItems: Infinity,
      playerModes: ['waveform', 'eq', 'orbit'],
      customThemes: true,
      download: true,
      jwt: true,
      whiteLabel: true,
    },
  },
};

const PLAN_IDS = Object.keys(PLANS);

/** Plan id for the install, defaulting to Starter. */
function getPlanId(settings) {
  return settings && PLAN_IDS.includes(settings.plan) ? settings.plan : 'starter';
}

/** The full plan object for the install. */
function getPlan(settings) {
  return PLANS[getPlanId(settings)];
}

/** A single limit for the install's plan. */
function limit(settings, key) {
  return getPlan(settings).limits[key];
}

/** JSON-safe limits for the public settings payload. */
function publicPlan(settings) {
  const p = getPlan(settings);
  const toJson = (v) => (Number.isFinite(v) ? v : 'unlimited');
  return {
    id: p.id,
    name: p.name,
    priceMonthly: p.priceMonthly,
    limits: {
      beats: toJson(p.limits.beats),
      versionsPerBeat: toJson(p.limits.versionsPerBeat),
      menuItems: toJson(p.limits.menuItems),
      playerModes: p.limits.playerModes,
      customThemes: p.limits.customThemes,
      download: p.limits.download,
      jwt: p.limits.jwt,
      whiteLabel: p.limits.whiteLabel,
    },
  };
}

module.exports = { PLANS, PLAN_IDS, getPlanId, getPlan, limit, publicPlan };
