'use strict';

const express = require('express');

/**
 * Leaderboard.
 *
 *   GET /api/leaderboard
 *
 *   producers   — users ranked by total net votes their versions received
 *                 (the "top producer" in community mode).
 *   contributors— users ranked by contribution score:
 *                 version posted = 5 pts, comment posted = 1 pt.
 *
 * Solo mode: the concept doesn't apply — returns empty lists (the UI hides
 * the leaderboard entirely in solo mode).
 */

function netVotes(db, versionId) {
  return db.all('votes').filter((v) => v.versionId === versionId).reduce((s, v) => s + (v.value || 0), 0);
}

function leaderboardRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const users = db.all('users');
    const name = (u) => u.name || u.email;

    // Producers: versions they posted, ranked by net votes received.
    const producers = users.map((u) => {
      const versions = db.all('versions').filter((v) => v.producerId === u.id && v.status !== 'hidden');
      return {
        userId: u.id,
        name: name(u),
        versions: versions.length,
        netVotes: versions.reduce((s, v) => s + netVotes(db, v.id), 0)
      };
    }).filter((p) => p.versions > 0)
      .sort((a, b) => b.netVotes - a.netVotes)
      .slice(0, 10);

    // Contributors: versions + comments, ranked by score.
    const contributors = users.map((u) => {
      const versions = db.all('versions').filter((v) => v.producerId === u.id && v.status !== 'hidden').length;
      const comments = db.all('comments').filter((c) => c.userId === u.id).length;
      return {
        userId: u.id,
        name: name(u),
        versions,
        comments,
        score: versions * 5 + comments
      };
    }).filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    res.json({ producers, contributors });
  });

  return router;
}

module.exports = leaderboardRouter;
