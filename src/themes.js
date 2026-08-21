'use strict';

/**
 * Built-in themes. Each theme is a CSS string that overrides the base
 * variables/components in styles.css. The default theme is 'beatthread'
 * (the base look — empty override). Admins can also upload custom CSS;
 * that CSS is stored on the settings document and takes precedence.
 */

const THEMES = {
  beatthread: {
    label: 'BeatThread (default)',
    description: 'Dark command-deck with amber accents — the base look.',
    css: '',
  },
  midnight: {
    label: 'Midnight',
    description: 'Deep indigo-blues with cyan accents.',
    css: `
:root {
  --bg: #070b18;
  --panel: #0e1530;
  --panel-2: #17214a;
  --border: #24305e;
  --text: #e7ecff;
  --muted: #8d99c7;
  --primary: #38bdf8;
  --primary-dark: #0ea5e9;
}
.auth-screen { background: radial-gradient(900px 500px at 75% -10%, #101a3d 0%, var(--bg) 60%); }
`,
  },
  neon: {
    label: 'Neon',
    description: 'Electric green/pink glow on near-black.',
    css: `
:root {
  --bg: #050708;
  --panel: #0c0f12;
  --panel-2: #141a20;
  --border: #232c33;
  --text: #eafff4;
  --muted: #7e8c99;
  --primary: #22ff88;
  --primary-dark: #00d96a;
  --up: #22ff88;
  --down: #ff2d78;
}
.btn-primary { color: #02200f; }
.btn-primary:hover { background: var(--primary-dark); }
.sort-btn.active { background: var(--primary); color: #02200f; }
.nav-btn.active { color: var(--primary); }
`,
  },
  sunset: {
    label: 'Sunset',
    description: 'Warm coral/amber palette for a friendlier feel.',
    css: `
:root {
  --bg: #140d0f;
  --panel: #1e1417;
  --panel-2: #2b1c20;
  --border: #3a262c;
  --text: #fff0ec;
  --muted: #c09aa3;
  --primary: #fb7185;
  --primary-dark: #f43f5e;
}
.auth-screen { background: radial-gradient(900px 500px at 75% -10%, #2b1520 0%, var(--bg) 60%); }
`,
  },
};

const THEME_NAMES = Object.keys(THEMES);
const DEFAULT_THEME = 'beatthread';

/** Resolve the CSS that should be applied for the settings' theme. */
function resolveThemeCss(theme) {
  if (!theme || typeof theme !== 'object') return '';
  if (theme.css && typeof theme.css === 'string') return theme.css;
  const t = THEMES[theme.name];
  return t ? t.css : '';
}

module.exports = { THEMES, THEME_NAMES, DEFAULT_THEME, resolveThemeCss };
