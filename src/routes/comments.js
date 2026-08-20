'use strict';

const express = require('express');
const { requireAuth } = require('../auth');

/**
 * Comments on versions.
 *
 *   GET    /api/comments?versionId=…   — public
 *   POST   /api/comments               — auth: { versionId, body }
 *   DELETE /api/comments/:id           — auth: own comment, or admin
 */

function publicComment(db, c) {
  const author = db.get('users', c.userId);
  return {
    ...c,
    authorName: author ? (author.name || author.email) : 'Unknown'
  };
}

function commentsRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const { versionId } = req.query;
    if (!versionId) return res.status(400).json({ error: 'versionId is required' });
    const list = db.all('comments')
      .filter((c) => c.versionId === versionId)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map((c) => publicComment(db, c));
    res.json(list);
  });

  router.post('/', requireAuth(db), (req, res) => {
    const { versionId, body } = req.body || {};
    if (!versionId || !db.get('versions', versionId)) {
      return res.status(400).json({ error: 'A valid versionId is required' });
    }
    const text = String(body || '').trim();
    if (!text) return res.status(400).json({ error: 'Comment text is required' });
    if (text.length > 500) return res.status(400).json({ error: 'Comments are limited to 500 characters' });
    const comment = db.insert('comments', { versionId, userId: req.userId, body: text });
    res.status(201).json(publicComment(db, comment));
  });

  router.delete('/:id', requireAuth(db), (req, res) => {
    const comment = db.get('comments', req.params.id);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.userId !== req.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You can only delete your own comments' });
    }
    db.remove('comments', comment.id);
    res.status(204).end();
  });

  return router;
}

module.exports = commentsRouter;
