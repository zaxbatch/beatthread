'use strict';

const crypto = require('crypto');

/**
 * Cloudinary signed-upload support.
 *
 * The admin's Cloudinary credentials (cloud name, API key, secret) are stored
 * in the app settings (admin panel → Storage). The server signs uploads so the
 * BROWSER can upload files directly to Cloudinary without the secret ever
 * leaving the server — audio files are uploaded as resource_type "video"
 * (Cloudinary treats audio under video).
 */

/** Build signed upload params for a direct browser upload. */
function signUpload(settings, opts = {}) {
  const { cloudName, apiKey, apiSecret } = settings || {};
  if (!cloudName || !apiKey || !apiSecret) return null;

  const timestamp = Math.round(Date.now() / 1000);
  // resource_type lives in the upload URL (not signed); format is inferred
  // from the file extension, so only timestamp + folder are signed.
  const params = {
    timestamp,
    folder: opts.folder || 'beatthread'
  };

  // Cloudinary signature: SHA1 of sorted key=value pairs joined by &, + secret.
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&') + apiSecret;
  const signature = crypto.createHash('sha1').update(toSign).digest('hex');

  return {
    cloudName,
    apiKey,
    timestamp,
    signature,
    folder: params.folder,
    resource_type: opts.resourceType || 'video'
  };
}

module.exports = { signUpload };
