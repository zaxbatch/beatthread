'use strict';

/*
 * BeatPlayer — the cool audio player for BeatThread.
 * Three visualizer modes (cycle with the 🎚 button):
 *   waveform — static track bars with progress fill
 *   eq       — live frequency bars (Web Audio analyser, with a pseudo fallback)
 *   orbit    — animated rings + orbiting dots
 * Degrades gracefully: if the audio host blocks CORS, the visualizers fall
 * back to deterministic pseudo-animations so the player always looks alive.
 */
(function () {
  const MODE_NAMES = { waveform: 'Waveform', eq: 'EQ', orbit: 'Orbit' };
  const ALL_MODES = ['waveform', 'eq', 'orbit'];
  const waveCache = new Map(); // url -> bars

  let activeAudio = null;

  function mount(host, opts) {
    opts = opts || {};
    const url = opts.url;
    const modes = (opts.modes || ['waveform']).filter((m) => ALL_MODES.includes(m));
    if (!modes.length) modes.push('waveform');
    let mode = modes[0];
    const onError = typeof opts.onError === 'function' ? opts.onError : function () {};

    host.innerHTML = `
      <div class="bp">
        <canvas class="bp-canvas" width="640" height="120"></canvas>
        <div class="bp-controls">
          <button class="bp-play" type="button" title="Play / pause">▶</button>
          <span class="bp-time">0:00 / 0:00</span>
          <input class="bp-seek" type="range" min="0" max="1000" value="0" title="Seek" />
          <button class="bp-mode" type="button" title="Switch visualizer">🎚</button>
          <span class="bp-mode-name">${MODE_NAMES[mode]}</span>
        </div>
      </div>`;

    const root = host.firstElementChild;
    const canvas = root.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const playBtn = root.querySelector('.bp-play');
    const timeEl = root.querySelector('.bp-time');
    const seek = root.querySelector('.bp-seek');
    const modeBtn = root.querySelector('.bp-mode');
    const modeName = root.querySelector('.bp-mode-name');

    const audio = new Audio(url);
    audio.crossOrigin = 'anonymous';
    audio.preload = 'metadata';

    let analyser = null;
    let freqData = null;
    let audioCtx = null;
    let raf = 0;
    let bars = null;
    let playing = false;
    let seeking = false;
    let audioBroken = false;

    // ---- waveform data (best effort) ----
    function loadWaveform() {
      if (bars || audioBroken) return;
      const cached = waveCache.get(url);
      if (cached) { bars = cached; return; }
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((buf) => {
          const AC = window.AudioContext || window.webkitAudioContext;
          const ac = new AC();
          return ac.decodeAudioData(buf).then((decoded) => {
            const data = decoded.getChannelData(0);
            const N = 96;
            const out = new Array(N).fill(0);
            const step = Math.max(1, Math.floor(data.length / N));
            for (let i = 0; i < N; i++) {
              let sum = 0;
              for (let j = 0; j < step; j++) sum += Math.abs(data[i * step + j] || 0);
              out[i] = Math.min(1, (sum / step) * 3.2);
            }
            bars = out;
            waveCache.set(url, out);
            ac.close();
          });
        })
        .catch(() => { /* CORS or decode blocked — fall back to pseudo bars */ });
    }

    // ---- live analyser (best effort) ----
    function ensureAnalyser() {
      if (analyser || audioBroken) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AC();
        const source = audioCtx.createMediaElementSource(audio);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 128;
        freqData = new Uint8Array(analyser.frequencyBinCount);
        source.connect(analyser);
        analyser.connect(audioCtx.destination);
      } catch { /* fall back to pseudo visuals */ }
    }

    function pseudoBars(t) {
      const out = new Array(48);
      for (let i = 0; i < 48; i++) {
        out[i] = 0.1 + 0.28 * Math.abs(Math.sin(t * 2 + i * 0.55)) + 0.22 * Math.abs(Math.sin(t * 3.1 + i * 0.9));
      }
      return out;
    }

    function drawWaveform(progress) {
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const N = bars ? bars.length : 96;
      const gap = 2;
      const bw = (w - gap * (N - 1)) / N;
      const mid = h / 2;
      for (let i = 0; i < N; i++) {
        const v = bars ? bars[i] : 0.3 + 0.2 * Math.abs(Math.sin(i * 0.4));
        const bh = Math.max(2, v * (h - 10));
        const x = i * (bw + gap);
        ctx.fillStyle = (progress * N >= i) ? '#f59e0b' : 'rgba(255,255,255,0.14)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, mid - bh / 2, bw, bh, 2);
        else ctx.rect(x, mid - bh / 2, bw, bh);
        ctx.fill();
      }
    }

    function drawEq() {
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      let data;
      if (analyser && freqData) { analyser.getByteFrequencyData(freqData); data = freqData; }
      else data = pseudoBars(performance.now() / 1000);
      const N = 48;
      const gap = 2;
      const bw = (w - gap * (N - 1)) / N;
      for (let i = 0; i < N; i++) {
        const raw = (data[i] || 0) / 255;
        const v = Math.max(0.02, raw);
        const bh = v * (h - 6);
        const x = i * (bw + gap);
        ctx.fillStyle = 'hsl(' + (195 - v * 195) + ' 90% ' + (46 + v * 18) + '%)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, h - bh, bw, bh, 2);
        else ctx.rect(x, h - bh, bw, bh);
        ctx.fill();
      }
    }

    function drawOrbit() {
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      const t = playing ? performance.now() / 1000 : 0;
      for (let i = 0; i < 3; i++) {
        const r = 20 + i * 17 + (playing ? Math.sin(t * 2 + i) * 3 : 0);
        ctx.strokeStyle = 'hsla(' + (195 - i * 60) + ', 90%, 60%, ' + (0.9 - i * 0.25) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        const ang = t * (1.4 + i * 0.5) + i * 2;
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = playing ? 'rgba(245,158,11,0.9)' : 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    function progress01() {
      return audio.duration ? audio.currentTime / audio.duration : 0;
    }

    function render() {
      if (mode === 'waveform') drawWaveform(progress01());
      else if (mode === 'eq') drawEq();
      else drawOrbit();
      raf = requestAnimationFrame(render);
    }

    function fmt(t) {
      if (!isFinite(t)) return '0:00';
      const m = Math.floor(t / 60), s = Math.floor(t % 60);
      return m + ':' + String(s).padStart(2, '0');
    }

    function setPlaying(p) {
      playing = p;
      playBtn.textContent = p ? '⏸' : '▶';
      if (p && activeAudio && activeAudio !== audio) activeAudio.pause();
      activeAudio = p ? audio : (activeAudio === audio ? null : activeAudio);
    }

    playBtn.addEventListener('click', () => {
      if (audio.paused) {
        ensureAnalyser();
        loadWaveform();
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
        audio.play().catch(() => {
          audioBroken = true;
          onError('Could not play this audio (the host may block cross-origin playback)');
        });
      } else {
        audio.pause();
        setPlaying(false);
      }
    });

    audio.addEventListener('play', () => setPlaying(true));
    audio.addEventListener('pause', () => setPlaying(false));
    audio.addEventListener('ended', () => setPlaying(false));
    audio.addEventListener('timeupdate', () => {
      timeEl.textContent = fmt(audio.currentTime) + ' / ' + fmt(audio.duration);
      if (!seeking) seek.value = Math.round(progress01() * 1000);
    });
    audio.addEventListener('loadedmetadata', () => {
      timeEl.textContent = '0:00 / ' + fmt(audio.duration);
    });

    seek.addEventListener('input', () => { seeking = true; });
    seek.addEventListener('change', () => {
      if (audio.duration) audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
      seeking = false;
    });

    modeBtn.addEventListener('click', () => {
      const idx = modes.indexOf(mode);
      mode = modes[(idx + 1) % modes.length];
      modeName.textContent = MODE_NAMES[mode];
    });

    loadWaveform();
    render();
  }

  window.BeatPlayer = { mount, MODE_NAMES };
})();
