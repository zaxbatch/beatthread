'use strict';

const path = require('path');
const express = require('express');
const { Db } = require('./db');
const { authRouter } = require('./auth');
const { getSettings, publicSettings } = require('./settings');
const beatsRouter = require('./routes/beats');
const adminRouter = require('./routes/admin');
const commentsRouter = require('./routes/comments');
const leaderboardRouter = require('./routes/leaderboard');
const superRouter = require('./routes/super');
const { THEMES } = require('./themes');

/**
 * Builds and configures the Express application.
 * The Db instance is created here and injected into every router,
 * which keeps the routes easy to test in isolation.
 */
function createApp(options = {}) {
  const db = options.db || new Db(options.dataFile);
  db.load();

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Simple request log (skip in tests unless requested)
  if (options.log !== false) {
    app.use((req, res, next) => {
      res.on('finish', () => {
        console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode}`);
      });
      next();
    });
  }

  // Public: auth + health + branding (never the Cloudinary secret).
  app.use('/api/auth', authRouter(db));
  app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
  app.get('/api/settings', (req, res) => res.json(publicSettings(getSettings(db))));

  app.use('/api/beats', beatsRouter(db));
  app.use('/api/admin', adminRouter(db));
  app.use('/api/comments', commentsRouter(db));
  app.use('/api/leaderboard', leaderboardRouter(db));
  app.use('/api/super', superRouter(db));

  // Public: built-in theme CSS (for the theme picker + embedders).
  app.get('/api/themes/:name.css', (req, res) => {
    const t = THEMES[req.params.name];
    if (!t) return res.status(404).json({ error: 'Theme not found' });
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.send(t.css);
  });

  // Static frontend
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // 404 for unknown API routes
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Central error handler
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp, Db };
