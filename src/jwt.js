'use strict';

/**
 * Tiny JWT (HS256) verification with no dependencies.
 *
 * The admin configures a shared secret (Settings → Login). When a visitor
 * presents a JWT signed with that secret (e.g. issued by the producer's own
 * site), POST /api/auth/jwt logs them in as the user whose email is in the
 * token's `sub` claim — a consistent login across an embedded BeatThread.
 */

const crypto = require('crypto');

function _b64url(data) {
  return Buffer.from(data).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function _b64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

/**
 * Verify a JWT against the shared secret. Returns the payload object, or null
 * when the token is malformed, expired, or the signature does not match.
 */
function verifyJwt(token, secret) {
  if (!token || !secret) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  try {
    const expected = crypto.createHmac('sha256', String(secret)).update(`${header}.${payload}`).digest();
    const actual = _b64urlDecode(signature);
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;

    const data = JSON.parse(_b64urlDecode(payload).toString('utf8'));
    if (data.exp && Date.now() >= Number(data.exp) * 1000) return null;
    if (!data.sub) return null;
    return data;
  } catch {
    return null;
  }
}

/** Build a JWT (used by tests + docs). */
function signJwt(claims, secret, expiresInSeconds = 3600) {
  const header = _b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = _b64url(JSON.stringify({
    sub: claims.sub,
    name: claims.name || '',
    exp: Math.round(Date.now() / 1000) + expiresInSeconds,
  }));
  const signature = _b64url(crypto.createHmac('sha256', String(secret)).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${signature}`;
}

module.exports = { verifyJwt, signJwt };
