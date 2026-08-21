'use strict';

/* ============================ Helpers ============================ */

const $ = (sel) => document.querySelector(sel);

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function toast(message, isError = false) {
  const t = $('#toast');
  t.textContent = message;
  t.className = `toast ${isError ? 'error' : ''}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 4000);
}

/* ============================ API ============================ */

let token = localStorage.getItem('bt_token') || '';
let currentUser = null;
let settings = { siteName: 'BeatThread', primaryColor: '#f59e0b' };

async function api(method, url, body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const MAX_TRIES = 3;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    let res;
    try {
      res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (err) {
      if (attempt < MAX_TRIES) { await new Promise((r) => setTimeout(r, 400 * attempt)); continue; }
      throw new Error('Can\u2019t reach the server — is it deployed and running?');
    }
    if (res.status === 401 && !url.startsWith('/api/auth/')) {
      if (attempt < MAX_TRIES) { await new Promise((r) => setTimeout(r, 500 * attempt)); continue; }
      clearSession();
      showAuthScreen('Your session has expired. Please log in again.');
      throw new Error('Session expired');
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.error || `${method} ${url} failed (${res.status})`;
      if (res.status >= 500 && attempt < MAX_TRIES) { await new Promise((r) => setTimeout(r, 400 * attempt)); continue; }
      throw new Error(msg);
    }
    return data;
  }
}

/* ============================ Branding ============================ */

function applyBranding() {
  const root = document.documentElement;
  root.style.setProperty('--primary', settings.primaryColor || '#f59e0b');
  $('#authBrandName').textContent = settings.siteName || 'BeatThread';
  $('#appBrandName').textContent = settings.siteName || 'BeatThread';
  document.title = settings.siteName || 'BeatThread';
  // Apply the active theme CSS (built-in or admin-uploaded custom).
  let st = document.getElementById('themeCss');
  if (!st) { st = document.createElement('style'); st.id = 'themeCss'; document.head.appendChild(st); }
  st.textContent = (settings.theme && settings.theme.css) || '';
  renderNav();
}

/** Build the top nav: admin-configured menu links + Feed + Admin. */
function renderNav() {
  const nav = document.querySelector('.topnav');
  if (!nav) return;
  nav.querySelectorAll('[data-menu]').forEach((a) => a.remove());
  const feedBtn = nav.querySelector('[data-view="feed"]');
  const adminBtn = nav.querySelector('[data-view="admin"]');
  (settings.menu || []).filter((m) => m.href && m.label).forEach((m) => {
    const a = document.createElement('a');
    a.className = 'nav-btn';
    a.href = m.href;
    a.target = m.target === '_blank' ? '_blank' : '_self';
    if (m.target === '_blank') a.rel = 'noopener';
    a.textContent = m.label;
    a.dataset.menu = '1';
    if (feedBtn) nav.insertBefore(a, feedBtn);
    else nav.appendChild(a);
  });
  if (adminBtn) {
    adminBtn.classList.toggle('hidden', !(currentUser && (currentUser.role === 'admin' || currentUser.role === 'super')));
  }
}

/** Save a text blob as a download (themes, exports). */
function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ============================ Auth ============================ */

let authMode = 'login';

function setAuthForm(html) {
  $('#authForm').innerHTML = html;
  $('#authForm').querySelectorAll('.pw-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = $('#authForm').querySelector(`[name="${btn.dataset.toggleFor}"]`);
      if (!input) return;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.textContent = showing ? '👁️' : '🙈';
    });
  });
}

function pwField(name, label) {
  return `
    <div>
      <label>${label}</label>
      <div class="pw-wrap">
        <input name="${name}" type="password" required minlength="8" autocomplete="new-password" />
        <button type="button" class="pw-toggle" data-toggle-for="${name}" title="Show password">👁️</button>
      </div>
    </div>`;
}

function authFormHtml(mode) {
  if (mode === 'login') return `
    <div><label>Email</label><input name="email" type="email" required autocomplete="username" /></div>
    ${pwField('password', 'Password')}
    <div class="form-actions">
      <button type="button" class="btn btn-ghost" id="forgotLink">Forgot password?</button>
      <button type="submit" class="btn btn-primary">Log in</button>
    </div>`;
  if (mode === 'register') return `
    <div><label>Name</label><input name="name" required autocomplete="name" /></div>
    <div><label>Email</label><input name="email" type="email" required autocomplete="username" /></div>
    ${pwField('password', 'Password (8+ characters)')}
    <div class="form-actions"><button type="submit" class="btn btn-primary">Create account</button></div>`;
  if (mode === 'forgot') return `
    <div><label>Account email</label><input name="email" type="email" required autocomplete="username" /></div>
    <div class="form-actions">
      <button type="button" class="btn btn-ghost" id="backToLogin">Back to log in</button>
      <button type="submit" class="btn btn-primary">Send reset token</button>
    </div>`;
  return `
    <div><label>Reset token</label><input name="token" required placeholder="Paste the reset token" /></div>
    ${pwField('password', 'New password (8+ characters)')}
    <div class="form-actions">
      <button type="button" class="btn btn-ghost" id="backToLogin">Back to log in</button>
      <button type="submit" class="btn btn-primary">Reset password</button>
    </div>`;
}

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('.auth-tab').forEach((t) => t.classList.toggle('active', t.dataset.authTab === mode));
  $('#authHint').classList.add('hidden');
  setAuthForm(authFormHtml(mode));
}

async function submitAuth(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const btn = e.target.querySelector('button[type="submit"]');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '…';
  try {
    if (authMode === 'login') {
      const data = await api('POST', '/api/auth/login', { email: fd.get('email'), password: fd.get('password') });
      enterApp(data);
    } else if (authMode === 'register') {
      try {
        const data = await api('POST', '/api/auth/register', { name: fd.get('name'), email: fd.get('email'), password: fd.get('password') });
        enterApp(data);
      } catch (err) {
        if (/already exists/i.test(err.message)) {
          const data = await api('POST', '/api/auth/login', { email: fd.get('email'), password: fd.get('password') });
          toast('Account already existed — logged you in.');
          enterApp(data);
          return;
        }
        throw err;
      }
    } else if (authMode === 'forgot') {
      const data = await api('POST', '/api/auth/forgot', { email: fd.get('email') });
      if (data.resetToken) {
        toast('Reset token generated (no mailer — admin resets via this token).');
        setAuthMode('reset');
      } else {
        toast(data.note || 'If an account exists, a reset token has been generated.');
      }
    } else if (authMode === 'reset') {
      await api('POST', '/api/auth/reset', { token: fd.get('token'), password: fd.get('password') });
      toast('Password reset. Log in with your new password.');
      setAuthMode('login');
    }
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function showAuthScreen(hint) {
  $('#appShell').classList.add('hidden');
  $('#authScreen').classList.remove('hidden');
  setAuthMode('login');
  if (hint) {
    const h = $('#authHint');
    h.textContent = hint;
    h.classList.remove('hidden');
  }
}

function showApp() {
  $('#authScreen').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
  $('#userName').textContent = currentUser.name || currentUser.email;
  $('#newBeatBtn').classList.toggle('hidden', settings.mode === 'solo' && currentUser.role === 'user');
  renderNav();
  navigate('feed');
}

function clearSession() {
  token = '';
  localStorage.removeItem('bt_token');
  currentUser = null;
}

function enterApp(data) {
  token = data.token;
  currentUser = data.user;
  localStorage.setItem('bt_token', token);
  toast(`Welcome, ${currentUser.name || currentUser.email}!`);
  showApp();
}

/* ============================ Navigation ============================ */

let currentView = 'feed';
let currentBeatId = null;
let feedSort = 'new';

function navigate(view) {
  currentView = view;
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  render();
}

async function render() {
  const el = $('#view');
  el.innerHTML = '<div class="empty">Loading…</div>';
  try {
    if (currentView === 'feed') await renderFeed(el);
    else if (currentView === 'thread') await renderThread(el);
    else if (currentView === 'admin') await renderAdmin(el);
  } catch (err) {
    el.innerHTML = `<div class="empty">⚠️ ${esc(err.message)}</div>`;
  }
}

/* ============================ Feed ============================ */

async function renderFeed(el) {
  const beats = await api('GET', `/api/beats?sort=${feedSort}`);
  let leaderboardHtml = '';
  if (settings.mode === 'community') {
    try {
      const lb = await api('GET', '/api/leaderboard');
      leaderboardHtml = `
        <div class="lb-grid">
          <div class="panel">
            <div class="panel-head"><h2>🏆 Top Producers</h2></div>
            <div style="padding:10px 16px">
              ${lb.producers.length ? lb.producers.map((p, i) => `
                <div class="lb-item"><span class="lb-rank">${i + 1}</span>
                  <span class="lb-name">${esc(p.name)}</span>
                  <span class="lb-stat">${p.netVotes} vote(s) · ${p.versions} beat(s)</span></div>`).join('')
                : '<div class="empty">No producers yet.</div>'}
            </div>
          </div>
          <div class="panel">
            <div class="panel-head"><h2>🔥 Top Contributors</h2></div>
            <div style="padding:10px 16px">
              ${lb.contributors.length ? lb.contributors.map((c, i) => `
                <div class="lb-item"><span class="lb-rank">${i + 1}</span>
                  <span class="lb-name">${esc(c.name)}</span>
                  <span class="lb-stat">${c.score} pt(s) · ${c.versions} version(s) · ${c.comments} comment(s)</span></div>`).join('')
                : '<div class="empty">No contributors yet.</div>'}
            </div>
          </div>
        </div>`;
    } catch { /* leaderboard is best-effort */ }
  }

  el.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>${esc(settings.siteName)} — feed</h2>
        <div class="feed-sort">
          <button class="sort-btn ${feedSort === 'new' ? 'active' : ''}" data-sort="new">New</button>
          <button class="sort-btn ${feedSort === 'top' ? 'active' : ''}" data-sort="top">Top</button>
        </div>
      </div>
      <div style="padding:14px 16px;">
        ${beats.length ? beats.map((b) => `
          <a class="beat-card" data-beat="${esc(b.id)}">
            <div class="beat-top">
              ${b.coverUrl ? `<img class="cover" src="${esc(b.coverUrl)}" alt="" />` : ''}
              <div class="beat-main">
                <h3>${esc(b.title)}</h3>
                <div class="tags">
                  ${b.genre ? `<span class="tag hot">${esc(b.genre)}</span>` : ''}
                  ${b.bpm ? `<span class="tag">${esc(b.bpm)} BPM</span>` : ''}
                  <span class="tag">${b.versionCount} version${b.versionCount === 1 ? '' : 's'}</span>
                  ${b.topVersion ? `<span class="tag">★ ${b.topVersion.netVotes} vote(s)</span>` : ''}
                </div>
              </div>
            </div>
            ${b.description ? `<div class="desc">${esc(b.description)}</div>` : ''}
            <div class="meta">by ${esc(b.producerName)} · ${fmtDate(b.createdAt)}</div>
          </a>`).join('') : '<div class="empty">No beats yet — be the first to post one!</div>'}
      </div>
    </div>
    ${leaderboardHtml}`;

  el.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => { feedSort = b.dataset.sort; renderFeed(el); }));
  el.querySelectorAll('[data-beat]').forEach((b) => b.addEventListener('click', () => { currentBeatId = b.dataset.beat; navigate('thread'); }));
}

/* ============================ Thread ============================ */

async function renderThread(el) {
  const beat = await api('GET', `/api/beats/${currentBeatId}`);
  const best = beat.versions[0]; // server sorts best-first

  el.innerHTML = `
    <button class="btn btn-ghost btn-sm" id="backBtn">← Back to feed</button>
    <div class="thread-head">
      ${beat.coverUrl ? `<img class="cover-lg" src="${esc(beat.coverUrl)}" alt="" />` : ''}
      <h2 style="margin:12px 0 4px">${esc(beat.title)}</h2>
      <div class="muted">by ${esc(beat.producerName)} · ${fmtDate(beat.createdAt)}
        ${beat.genre ? ` · ${esc(beat.genre)}` : ''}${beat.bpm ? ` · ${esc(beat.bpm)} BPM` : ''}</div>
      ${beat.description ? `<p class="muted" style="margin:8px 0 0">${esc(beat.description)}</p>` : ''}
    </div>
    <div style="margin-bottom:14px">
      <button class="btn btn-primary btn-sm" id="addVersionBtn">+ Add your version</button>
    </div>
    <div class="muted" style="margin-bottom:8px">Sorted by votes — the best version is on top ⭐</div>
    <div id="versionList">
      ${beat.versions.map((v) => versionHtml(v, v.id === (best && best.id))).join('') ||
        '<div class="empty">No versions yet.</div>'}
    </div>`;

  $('#backBtn').addEventListener('click', () => navigate('feed'));
  $('#addVersionBtn').addEventListener('click', () => uploadModal('version'));
  el.querySelectorAll('[data-vote]').forEach((b) => b.addEventListener('click', () => vote(b.dataset.vote, b.dataset.dir)));
  el.querySelectorAll('[data-del-version]').forEach((b) => b.addEventListener('click', () => adminDeleteVersion(b.dataset.delVersion)));
  // Load comments for every version.
  el.querySelectorAll('[data-comments-for]').forEach((box) => loadComments(box.dataset.commentsFor, box));
  el.querySelectorAll('[data-comment-add]').forEach((b) => b.addEventListener('click', () => addComment(b.dataset.commentAdd)));
  el.querySelectorAll('[data-comment-del]').forEach((b) => b.addEventListener('click', () => deleteComment(b.dataset.commentDel, b)));
  initPlayers(el);
}

/** Mount the cool player on every .bp-mount (waveform/EQ/orbit per plan). */
function initPlayers(el) {
  if (!window.BeatPlayer) return;
  const modes = (settings.plan && settings.plan.limits.playerModes) || ['waveform'];
  el.querySelectorAll('.bp-mount').forEach((m) => {
    window.BeatPlayer.mount(m, {
      url: m.dataset.audio,
      modes,
      onError: (msg) => toast(msg, true),
    });
  });
}

function versionHtml(v, isBest) {
  const canDownload = (settings.plan && settings.plan.limits.download)
    || (currentUser && (currentUser.role === 'admin' || currentUser.role === 'super'));
  return `
    <div class="version ${isBest ? 'best' : ''}">
      <div class="vote-col">
        <button class="vote-btn up ${v.myVote === 1 ? 'on' : ''}" data-vote="${esc(v.id)}" data-dir="1" title="Upvote">▲</button>
        <div class="vote-score">${v.netVotes}</div>
        <button class="vote-btn down ${v.myVote === -1 ? 'on' : ''}" data-vote="${esc(v.id)}" data-dir="-1" title="Downvote">▼</button>
      </div>
      <div class="version-main">
        ${v.coverUrl ? `<img class="cover cover-md" src="${esc(v.coverUrl)}" alt="" />` : ''}
        <h4>${esc(v.title)} ${isBest ? '<span class="badge-best">★ best</span>' : ''} ${v.isOriginal ? '<span class="tag">original</span>' : ''}</h4>
        <div class="byline">by ${esc(v.producerName)} · ${fmtDate(v.createdAt)}</div>
        <div class="bp-mount" data-audio="${esc(v.audioUrl)}"></div>
        <div class="version-actions">
          ${canDownload ? `<a class="dl" href="/api/beats/versions/${esc(v.id)}/download" download>⬇ Download</a>` : ''}
          ${currentUser && (currentUser.role === 'admin' || currentUser.role === 'super') ? `<button class="btn btn-danger btn-sm" data-del-version="${esc(v.id)}">Delete</button>` : ''}
        </div>
        <div class="comments" data-comments-for="${esc(v.id)}">
          <div class="comments-list"><div class="muted">Loading comments…</div></div>
          ${currentUser
            ? `<div class="comment-add"><input data-comment-input="${esc(v.id)}" placeholder="Add a comment…" maxlength="500" />
                 <button class="btn btn-primary btn-sm" data-comment-add="${esc(v.id)}">Post</button></div>`
            : '<div class="muted">Log in to comment.</div>'}
        </div>
      </div>
    </div>`;
}

async function loadComments(versionId, box) {
  try {
    const list = await api('GET', `/api/comments?versionId=${versionId}`);
    const boxList = box.querySelector('.comments-list');
    boxList.innerHTML = list.length ? list.map((c) => `
      <div class="comment">
        <span class="comment-author">${esc(c.authorName)}</span>
        <span class="comment-body">${esc(c.body)}</span>
        <span class="comment-date">${fmtDate(c.createdAt)}</span>
        ${currentUser && (currentUser.id === c.userId || currentUser.role === 'admin')
          ? `<button class="comment-del" data-comment-del="${esc(c.id)}">✕</button>` : ''}
      </div>`).join('') : '<div class="muted">No comments yet.</div>';
    box.querySelectorAll('[data-comment-del]').forEach((b) => b.addEventListener('click', () => deleteComment(b.dataset.commentDel, b)));
  } catch (err) {
    box.querySelector('.comments-list').innerHTML = `<div class="muted">⚠️ ${esc(err.message)}</div>`;
  }
}

async function addComment(versionId) {
  if (!currentUser) { showAuthScreen(); toast('Log in to comment', true); return; }
  const input = document.querySelector(`[data-comment-input="${versionId}"]`);
  const body = (input.value || '').trim();
  if (!body) { toast('Write a comment first', true); return; }
  try {
    await api('POST', '/api/comments', { versionId, body });
    input.value = '';
    render();
  } catch (err) { toast(err.message, true); }
}

async function deleteComment(id, btn) {
  if (!confirm('Delete this comment?')) return;
  try {
    await api('DELETE', `/api/comments/${id}`);
    btn.closest('.comment').remove();
    toast('Comment deleted');
  } catch (err) { toast(err.message, true); }
}

async function vote(versionId, dir) {
  if (!currentUser) { showAuthScreen(); toast('Log in to vote', true); return; }
  try {
    const data = await api('POST', `/api/beats/versions/${versionId}/vote`, { value: Number(dir) });
    toast(data.myVote === 0 ? 'Vote removed' : data.myVote === 1 ? 'Upvoted ▲' : 'Downvoted ▼');
    render();
  } catch (err) { toast(err.message, true); }
}

/* ============================ Upload (Cloudinary) ============================ */

async function uploadToCloudinary(file, type = 'video') {
  const params = await api('GET', `/api/beats/upload/sign?type=${type}`);
  const fd = new FormData();
  fd.append('file', file);
  fd.append('api_key', params.apiKey);
  fd.append('timestamp', params.timestamp);
  fd.append('signature', params.signature);
  fd.append('folder', params.folder);
  fd.append('resource_type', params.resource_type);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${params.cloudName}/${params.resource_type}/upload`, { method: 'POST', body: fd });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(data?.error?.message || 'Cloudinary upload failed');
  return data.secure_url || data.url;
}

function uploadField(fieldKey, kindLabel, accept = 'audio/*') {
  return `
    <div class="full">
      <label>${kindLabel}</label>
      <div class="upload-zone" data-zone="${fieldKey}">Click to choose${kindLabel.includes('Cover') ? ' a cover image' : ' your audio file'}…</div>
      <input type="file" data-file="${fieldKey}" accept="${accept}" class="hidden" />
      <div class="muted" data-status="${fieldKey}" style="margin-top:6px"></div>
    </div>`;
}

function uploadModal(kind) {
  const isBeat = kind === 'beat';
  openModal(isBeat ? 'Post a beat' : 'Add your version', `
    <div class="form-grid">
      ${isBeat ? `
        <div><label>Title *</label><input name="title" required maxlength="120" placeholder="e.g. Summer Vibe" /></div>
        <div><label>BPM</label><input name="bpm" placeholder="e.g. 92" /></div>
        <div class="full"><label>Genre</label><input name="genre" maxlength="40" placeholder="e.g. Hip-Hop, Trap, Lo-Fi" /></div>
        <div class="full"><label>Description</label><textarea name="description" rows="2" maxlength="2000" placeholder="Tell producers what you made…"></textarea></div>
      ` : `
        <div class="full"><label>Title *</label><input name="title" required maxlength="120" placeholder="e.g. My full song over this beat" /></div>
      `}
      ${uploadField('audio', 'Audio file (mp3/wav) *')}
      ${uploadField('cover', 'Cover art (optional)', 'image/*')}
    </div>`);
  const submitBtn = $('#modalForm').querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = isBeat ? 'Post beat' : 'Add version';
  submitBtn.disabled = true;

  const uploaded = { audio: '', cover: '' };

  $('#modalForm').querySelectorAll('.upload-zone').forEach((zone) => {
    const field = zone.dataset.zone;
    const input = $('#modalForm').querySelector(`[data-file="${field}"]`);
    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      zone.textContent = `Uploading ${file.name}…`;
      try {
        uploaded[field] = await uploadToCloudinary(file, field === 'cover' ? 'image' : 'video');
        zone.textContent = `✅ ${file.name} uploaded`;
      } catch (err) {
        zone.textContent = '⚠️ Upload failed';
        toast(err.message, true);
      } finally {
        submitBtn.disabled = !uploaded.audio;
      }
    });
  });

  $('#modalForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!uploaded.audio) { toast('Upload an audio file first', true); return; }
    const fd = new FormData(e.target);
    try {
      if (isBeat) {
        await api('POST', '/api/beats', {
          title: fd.get('title'), description: fd.get('description'),
          genre: fd.get('genre'), bpm: fd.get('bpm'),
          audioUrl: uploaded.audio, coverUrl: uploaded.cover
        });
        toast('Beat posted!');
      } else {
        await api('POST', `/api/beats/${currentBeatId}/versions`, { title: fd.get('title'), audioUrl: uploaded.audio, coverUrl: uploaded.cover });
        toast('Version added!');
      }
      closeModal();
      render();
    } catch (err) { toast(err.message, true); }
  });
}

/* ============================ Admin ============================ */

let adminTab = 'branding';

const ADMIN_TABS = [
  ['branding', 'Branding'], ['menu', 'Menu'], ['themes', 'Themes'], ['storage', 'Storage'],
  ['login', 'Login (JWT)'], ['plans', 'Plans'], ['moderation', 'Moderation'], ['users', 'Users'], ['embed', 'Embed'],
];

async function renderAdmin(el) {
  const adminData = await api('GET', '/api/admin/settings');
  const isSuper = currentUser.role === 'super';
  const plan = adminData.plan || { id: 'starter', name: 'Starter' };
  const setup = [
    { label: 'Branding', done: Boolean((adminData.siteName && adminData.siteName !== 'BeatThread') || adminData.logoUrl || (adminData.primaryColor && adminData.primaryColor !== '#f59e0b')), tab: 'branding' },
    { label: 'Storage (Cloudinary)', done: Boolean(adminData.cloudinary && adminData.cloudinary.cloudName && adminData.cloudinary.apiKey && adminData.cloudinary.apiSecret), tab: 'storage' },
    { label: 'JWT login', done: Boolean(adminData.jwtSecret), tab: 'login' },
    { label: 'Plan', done: ((adminData.plan && adminData.plan.id) || 'starter') !== 'starter', tab: 'plans' },
  ];
  el.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Admin panel</h2></div>
      <div style="padding:16px 18px">
        <div class="setup-strip" title="Your setup checklist — click a step to open it">
          ${setup.map((s) => `<button class="setup-chip ${s.done ? 'done' : 'todo'}" data-setup-tab="${s.tab}">${s.done ? '✓' : '○'} ${s.label}</button>`).join('')}
        </div>
        <div class="tabs">
          ${ADMIN_TABS.map(([id, label]) => `<button class="tab-btn ${adminTab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}
        </div>
        <div id="adminBody"></div>
      </div>
    </div>`;

  el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { adminTab = b.dataset.tab; renderAdmin(el); }));
  el.querySelectorAll('[data-setup-tab]').forEach((b) => b.addEventListener('click', () => { adminTab = b.dataset.setupTab; renderAdmin(el); }));
  const body = $('#adminBody');

  const save = async (patch) => {
    await api('PUT', '/api/admin/settings', patch);
    toast('Saved');
    await loadSettings();
    applyBranding();
    renderAdmin(el);
  };

  if (adminTab === 'branding') {
    body.innerHTML = `
      <div class="form-grid">
        <div class="full"><label>Site name *</label><input id="aSiteName" value="${esc(adminData.siteName)}" maxlength="80" /></div>
        <div class="full"><label>Tagline</label><input id="aTagline" value="${esc(adminData.tagline || '')}" maxlength="200" /></div>
        <div><label>Mode</label>
          <select id="aMode">
            <option value="community" ${adminData.mode !== 'solo' ? 'selected' : ''}>Community — multiple producers</option>
            <option value="solo" ${adminData.mode === 'solo' ? 'selected' : ''}>Solo — only you post beats</option>
          </select></div>
        <div><label>Accent color</label><input id="aColor" type="color" value="${esc(adminData.primaryColor || '#f59e0b')}" /></div>
        <div class="full"><label>Logo URL (optional)</label><input id="aLogo" value="${esc(adminData.logoUrl || '')}" placeholder="https://…" /></div>
      </div>
      <div class="form-actions"><button class="btn btn-primary" id="saveBranding">Save branding</button></div>`;
    $('#saveBranding').addEventListener('click', () => save({
      siteName: $('#aSiteName').value, tagline: $('#aTagline').value,
      mode: $('#aMode').value, primaryColor: $('#aColor').value, logoUrl: $('#aLogo').value,
    }));
  } else if (adminTab === 'menu') {
    const menuLimit = (plan.limits && plan.limits.menuItems) || 0;
    body.innerHTML = `
      <p class="muted">Add links so the app matches your website/brand.${menuLimit === 'unlimited' ? '' : ` Your plan allows <b>${menuLimit}</b> menu item(s).`}</p>
      <div id="menuRows"></div>
      <div class="form-actions">
        <button class="btn btn-ghost" id="menuAdd">+ Add item</button>
        <button class="btn btn-primary" id="menuSave">Save menu</button>
      </div>`;
    const menu = (adminData.menu || []).slice();
    const rows = $('#menuRows');
    const renderRows = () => {
      rows.innerHTML = menu.map((m, i) => `
        <div class="menu-row">
          <input data-mi-label="${i}" placeholder="Label (e.g. Store)" value="${esc(m.label)}" />
          <input data-mi-href="${i}" placeholder="https://… or /page" value="${esc(m.href)}" />
          <select class="m-target" data-mi-target="${i}">
            <option value="_self" ${m.target !== '_blank' ? 'selected' : ''}>Same tab</option>
            <option value="_blank" ${m.target === '_blank' ? 'selected' : ''}>New tab</option>
          </select>
          <button class="btn btn-danger btn-sm" data-mi-del="${i}">✕</button>
        </div>`).join('') || '<div class="muted">No menu items yet — add your first link.</div>';
      rows.querySelectorAll('[data-mi-del]').forEach((b) => b.addEventListener('click', () => { menu.splice(Number(b.dataset.miDel), 1); renderRows(); }));
    };
    renderRows();
    $('#menuAdd').addEventListener('click', () => { menu.push({ label: '', href: '', target: '_self' }); renderRows(); });
    $('#menuSave').addEventListener('click', async () => {
      const cleaned = menu.map((_, i) => ({
        label: rows.querySelector(`[data-mi-label="${i}"]`).value.trim(),
        href: rows.querySelector(`[data-mi-href="${i}"]`).value.trim(),
        target: rows.querySelector(`[data-mi-target="${i}"]`).value,
      })).filter((m) => m.label && m.href);
      await save({ menu: cleaned });
    });
  } else if (adminTab === 'themes') {
    const themes = await api('GET', '/api/admin/themes');
    const current = (adminData.theme && adminData.theme.name) || 'beatthread';
    const customAllowed = Boolean(plan.limits && plan.limits.customThemes);
    body.innerHTML = `
      <p class="muted">Pick a built-in theme, or upload your own CSS${customAllowed ? '' : ' — custom themes are a <b>Pro</b> feature (upgrade in Plans).'}</p>
      <div id="themeList"></div>
      <div class="form-grid">
        <div class="full"><label>Custom CSS <span class="opt">(choose a .css file or paste)</span></label>
          <textarea id="themeCssInput" rows="6" placeholder=":root { --primary: #ff0000; } …" ${customAllowed ? '' : 'disabled'}></textarea></div>
        <div class="full">
          <input type="file" id="themeCssFile" accept=".css,text/css" class="hidden" />
          <button class="btn btn-ghost" id="themePickFile" ${customAllowed ? '' : 'disabled'}>📁 Choose .css file</button>
          <button class="btn btn-primary" id="themeApplyCustom" ${customAllowed ? '' : 'disabled'}>Apply custom CSS</button>
          <button class="btn btn-ghost" id="themeReset">↺ Reset to default</button>
        </div>
        <div class="full">
          <button class="btn btn-ghost" id="themeDownloadCurrent">⬇ Download current theme CSS</button>
          <button class="btn btn-ghost" id="themeDownloadDefault">⬇ Download default CSS</button>
        </div>
      </div>`;
    const list = $('#themeList');
    list.innerHTML = themes.map((t) => `
      <label class="theme-option ${current === t.name ? 'active' : ''}">
        <input type="radio" name="theme" value="${esc(t.name)}" ${current === t.name ? 'checked' : ''} />
        <span><b>${esc(t.label)}</b><p>${esc(t.description)}</p></span>
      </label>`).join('');
    list.querySelectorAll('input[name=theme]').forEach((r) => r.addEventListener('change', () => save({ theme: { name: r.value, css: '' } })));
    $('#themePickFile').addEventListener('click', () => $('#themeCssFile').click());
    $('#themeCssFile').addEventListener('change', async () => {
      const f = $('#themeCssFile').files && $('#themeCssFile').files[0];
      if (!f) return;
      $('#themeCssInput').value = await f.text();
      toast('CSS loaded — click “Apply custom CSS”');
    });
    $('#themeApplyCustom').addEventListener('click', async () => {
      const css = $('#themeCssInput').value.trim();
      if (!css) { toast('Paste or choose a CSS file first', true); return; }
      await save({ theme: { name: 'custom', css } });
    });
    $('#themeReset').addEventListener('click', () => save({ theme: { name: 'beatthread', css: '' } }));
    $('#themeDownloadCurrent').addEventListener('click', async () => {
      const css = (settings.theme && settings.theme.css) || await (await fetch('/styles.css')).text();
      downloadText(css, 'beatthread-current-theme.css');
    });
    $('#themeDownloadDefault').addEventListener('click', async () => {
      const css = await (await fetch('/styles.css')).text();
      downloadText(css, 'beatthread-default.css');
    });
  } else if (adminTab === 'storage') {
    const c = adminData.cloudinary || {};
    const configured = Boolean(c.cloudName && c.apiKey && c.apiSecret);
    body.innerHTML = `
      <p class="muted">Audio uploads go straight to <b>your</b> Cloudinary account (Dashboard → API Keys). Configured at setup — saved secrets are never shown or re-displayed.</p>
      <div class="form-grid">
        <div><label>Cloud name</label><input id="cCloud" placeholder="${c.cloudName ? '•••••••• (saved — leave blank to keep)' : 'e.g. mycloud'}" autocomplete="off" /></div>
        <div><label>API key</label><input id="cKey" placeholder="${c.apiKey ? '•••••••• (saved — leave blank to keep)' : 'Your API key'}" autocomplete="off" /></div>
        <div class="full"><label>API secret</label><input id="cSecret" type="password" placeholder="${c.apiSecret ? '•••••••• (saved — leave blank to keep)' : 'Your API secret'}" autocomplete="new-password" /></div>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" id="saveStorage">Save storage settings</button>
        ${configured ? '<button class="btn btn-danger" id="clearStorage">Clear credentials</button>' : ''}
      </div>`;
    $('#saveStorage').addEventListener('click', async () => {
      const payload = { cloudinary: {} };
      const v = (id) => $(id).value.trim();
      if (v('#cCloud')) payload.cloudinary.cloudName = v('#cCloud');
      if (v('#cKey')) payload.cloudinary.apiKey = v('#cKey');
      if (v('#cSecret')) payload.cloudinary.apiSecret = v('#cSecret');
      if (!Object.keys(payload.cloudinary).length) { toast('Type a value to change it — blanks keep the saved credentials', true); return; }
      await api('PUT', '/api/admin/settings', payload);
      toast('Storage settings saved');
      renderAdmin(el);
    });
    const clearStorage = $('#clearStorage');
    if (clearStorage) clearStorage.addEventListener('click', async () => {
      if (!confirm('Clear Cloudinary credentials? Uploads will stop until you reconfigure.')) return;
      await api('PUT', '/api/admin/settings', { cloudinary: { clear: true } });
      toast('Credentials cleared');
      renderAdmin(el);
    });
  } else if (adminTab === 'login') {
    body.innerHTML = `
      <p class="muted">This is <b>your own auth</b> for embedded logins. Set a shared secret, then visitors to your website present a JWT (HS256, <code>sub</code> = the user's email) to log in consistently:</p>
      <div class="embed-code">POST /api/auth/jwt&#10;{"token":"&lt;your HS256 JWT&gt;"}</div>
      <div class="form-grid">
        <div class="full"><label>JWT secret</label><input id="jwtSecret" type="password" placeholder="${adminData.jwtSecret ? '•••••••• (saved — leave blank to keep)' : 'A long random string'}" autocomplete="new-password" /></div>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" id="saveJwt">Save secret</button>
        ${adminData.jwtSecret ? '<button class="btn btn-danger" id="clearJwt">Remove (disable JWT)</button>' : ''}
      </div>`;
    $('#saveJwt').addEventListener('click', async () => {
      const v = $('#jwtSecret').value.trim();
      if (!v) { toast('Type a new secret to change it — blank keeps the saved one', true); return; }
      await api('PUT', '/api/admin/settings', { jwtSecret: v });
      toast('JWT secret saved');
      renderAdmin(el);
    });
    const clearJwt = $('#clearJwt');
    if (clearJwt) clearJwt.addEventListener('click', async () => {
      if (!confirm('Disable JWT login?')) return;
      await api('PUT', '/api/admin/settings', { jwtSecret: '' });
      toast('JWT login disabled');
      renderAdmin(el);
    });
  } else if (adminTab === 'plans') {
    const plans = await api('GET', '/api/admin/plans');
    const currentPlan = plan.id || 'starter';
    body.innerHTML = `
      <p class="muted">${isSuper ? 'Choose the plan for this install — it gates end-user features (you always bypass limits).' : 'Your current plan:'} <b>${esc(plan.name || 'Starter')}</b></p>
      <div class="plan-cards">
        ${plans.map((p) => `
          <div class="plan-card ${p.id === currentPlan ? 'active' : ''}">
            <h4>${esc(p.name)}</h4>
            <div class="price">${p.priceMonthly === 0 ? 'Free' : '$' + p.priceMonthly + '/mo'}</div>
            <ul>
              ${Object.entries(p.limits).map(([k, v]) => `<li>${esc(k)}: ${esc(v === true ? 'yes' : v === false ? 'no' : v)}</li>`).join('')}
            </ul>
            ${isSuper ? `<div style="margin-top:10px"><button class="btn btn-primary btn-sm" data-set-plan="${p.id}" ${p.id === currentPlan ? 'disabled' : ''}>${p.id === currentPlan ? 'Current' : 'Set plan'}</button></div>` : ''}
          </div>`).join('')}
      </div>`;
    body.querySelectorAll('[data-set-plan]').forEach((b) => b.addEventListener('click', async () => {
      await api('PUT', '/api/super/plan', { plan: b.dataset.setPlan });
      toast('Plan set');
      await loadSettings();
      renderAdmin(el);
    }));
  } else if (adminTab === 'moderation') {
    const beats = await api('GET', '/api/beats');
    body.innerHTML = `
      <p class="muted">Delete a beat (removes all versions) or a single version.</p>
      <div class="mod-list">
        ${beats.map((b) => `
          <div class="mod-item">
            <div class="info"><b>${esc(b.title)}</b> · ${b.versionCount} version(s) · by ${esc(b.producerName)}</div>
            <button class="btn btn-danger btn-sm" data-del-beat="${esc(b.id)}">Delete beat</button>
          </div>`).join('') || '<div class="empty">No beats.</div>'}
      </div>`;
    body.querySelectorAll('[data-del-beat]').forEach((b) => b.addEventListener('click', () => adminDeleteBeat(b.dataset.delBeat)));
  } else if (adminTab === 'users') {
    const users = await api('GET', '/api/admin/users');
    if (isSuper) {
      body.innerHTML = `
        <p class="muted">Manage subscribers and staff. Role hierarchy: <b>super</b> &gt; <b>admin</b> &gt; <b>user</b>. You are the owner.</p>
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th></th></tr></thead>
          <tbody>
            ${users.map((u) => `
              <tr>
                <td>${esc(u.name)}</td>
                <td>${esc(u.email)}</td>
                <td>
                  <select data-role-for="${esc(u.id)}" ${u.id === currentUser.id ? 'disabled' : ''}>
                    ${['super', 'admin', 'user'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
                  </select>
                </td>
                <td>${fmtDate(u.createdAt)}</td>
                <td class="row-actions">
                  ${u.id !== currentUser.id ? `<button class="btn btn-danger btn-sm" data-super-del="${esc(u.id)}">Delete</button>` : ''}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>`;
      body.querySelectorAll('[data-role-for]').forEach((sel) => sel.addEventListener('change', async () => {
        try {
          await api('PUT', `/api/super/users/${sel.dataset.roleFor}/role`, { role: sel.value });
          toast('Role updated');
        } catch (err) { toast(err.message, true); renderAdmin(el); }
      }));
      body.querySelectorAll('[data-super-del]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('Delete this subscriber? Their beats, versions, votes and comments are removed.')) return;
        try { await api('DELETE', `/api/super/users/${b.dataset.superDel}`); toast('Subscriber deleted'); renderAdmin(el); }
        catch (err) { toast(err.message, true); }
      }));
    } else {
      body.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <span class="muted">${users.length} user(s) · subscriber management is for the super user</span>
          <a class="btn btn-primary btn-sm" href="/api/admin/users/export.csv" id="exportUsers" download>⬇ Export CSV (for your CRM)</a>
        </div>
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Joined</th></tr></thead>
          <tbody>
            ${users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.phone || '')}</td><td>${esc(u.role)}</td><td>${fmtDate(u.createdAt)}</td></tr>`).join('')}
          </tbody>
        </table>`;
      const exp = $('#exportUsers');
      exp.removeAttribute('href');
      exp.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          const res = await fetch('/api/admin/users/export.csv', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
          if (!res.ok) throw new Error('Export failed');
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'beatthread-users.csv';
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          toast('Users exported');
        } catch (err) { toast(err.message, true); }
      });
    }
  } else if (adminTab === 'embed') {
    const host = location.origin;
    const code = `<iframe src="${esc(host)}/embed.html?version=REPLACE_WITH_VERSION_ID" style="width:100%;height:280px;border:0;border-radius:12px" loading="lazy"></iframe>`;
    body.innerHTML = `
      <p class="muted">Drop BeatThread into any existing page — it inherits your branding, theme and menu. Replace <b>REPLACE_WITH_VERSION_ID</b> with a version id (found in a thread URL), then paste this into your site:</p>
      <div class="embed-code" id="embedCode"></div>
      <div class="form-actions"><button class="btn btn-primary" id="copyEmbed">Copy snippet</button></div>
      <p class="muted" style="margin-top:12px">Standalone player page: <a href="/embed.html?version=">${esc(host)}/embed.html?version=…</a></p>`;
    $('#embedCode').textContent = code;
    $('#copyEmbed').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(code); toast('Copied'); }
      catch { toast('Copy manually', true); }
    });
  }
}

async function adminDeleteBeat(id) {
  if (!confirm('Delete this beat and all its versions?')) return;
  try { await api('DELETE', `/api/admin/beats/${id}`); toast('Beat deleted'); render(); }
  catch (err) { toast(err.message, true); }
}

async function adminDeleteVersion(id) {
  if (!confirm('Delete this version?')) return;
  try { await api('DELETE', `/api/admin/versions/${id}`); toast('Version deleted'); render(); }
  catch (err) { toast(err.message, true); }
}

/* ============================ Modal ============================ */

function openModal(title, formHtml) {
  $('#modalTitle').textContent = title;
  $('#modalForm').innerHTML = `${formHtml}<div class="form-actions">
    <button type="button" class="btn btn-ghost" id="modalCancel">Cancel</button>
    <button type="submit" class="btn btn-primary">Save</button>
  </div>`;
  $('#modal').classList.remove('hidden');
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalForm').querySelector('input:not([type=file]), select, textarea')?.focus();
}

function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modalForm').innerHTML = '';
}

/* ============================ Init ============================ */

async function loadSettings() {
  settings = await api('GET', '/api/settings');
  applyBranding();
}

async function init() {
  await loadSettings();
  document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.view)));
  $('#newBeatBtn').addEventListener('click', () => uploadModal('beat'));
  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('POST', '/api/auth/logout'); } catch { /* ignore */ }
    clearSession();
    toast('Logged out');
    showAuthScreen();
  });
  document.querySelectorAll('.auth-tab').forEach((t) => t.addEventListener('click', () => setAuthMode(t.dataset.authTab)));
  $('#authForm').addEventListener('submit', submitAuth);
  $('#authForm').addEventListener('click', (e) => {
    if (e.target.id === 'forgotLink') setAuthMode('forgot');
    if (e.target.id === 'backToLogin') setAuthMode('login');
  });
  $('#modalClose').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  if (token) {
    try {
      const { user } = await api('GET', '/api/auth/me');
      currentUser = user;
      showApp();
      return;
    } catch { /* fall through */ }
  }
  clearSession();
  showAuthScreen();
}

init();
