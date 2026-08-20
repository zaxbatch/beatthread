'use strict';

/**
 * App settings: branding + mode + Cloudinary storage config.
 * A single settings document is created on first use, seeded with defaults
 * and the owner's Cloudinary credentials (admin-editable in the panel).
 */

const DEFAULT_CLOUDINARY = {
  cloudName: 'r6natkse',
  apiKey: '662123844412483',
  apiSecret: 'UJh4kBlNk8OD3M34kAi9U216I6Y'
};

function getSettings(db) {
  const existing = db.all('settings')[0];
  if (existing) return existing;
  return db.insert('settings', {
    siteName: 'BeatThread',
    tagline: 'Post your beats. Cover them. Vote on the best.',
    mode: 'community', // community | solo
    primaryColor: '#f59e0b',
    logoUrl: '',
    cloudinary: { ...DEFAULT_CLOUDINARY }
  });
}

/** Branding/status only — never the Cloudinary secret. */
function publicSettings(s) {
  return {
    siteName: s.siteName,
    tagline: s.tagline,
    mode: s.mode,
    primaryColor: s.primaryColor,
    logoUrl: s.logoUrl || '',
    cloudinaryConfigured: Boolean(s.cloudinary && s.cloudinary.cloudName && s.cloudinary.apiKey && s.cloudinary.apiSecret)
  };
}

module.exports = { getSettings, publicSettings, DEFAULT_CLOUDINARY };
