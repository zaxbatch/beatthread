'use strict';

const { createApp } = require('./src/app');
const { port } = require('./src/config');

const app = createApp();

app.listen(port, () => {
  console.log(`\n  🎧 BeatThread running at http://localhost:${port}`);
});
