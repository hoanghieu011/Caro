(() => {
  'use strict';

  const N = 50;
  const NN = N * N;
  const TAU = Math.PI * 2;
  const LEVEL_LABELS = { normal: 'Vừa', hard: 'Khó', super: 'Siêu khó' };
  const BOT_TIME_LIMIT = 30000;       // Giới hạn hiển thị và watchdog: 30 giây.
  const BOT_ENGINE_LIMIT = 29500;     // Engine tự dừng trước mốc 30 giây.

  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const isBotMode = () => state.mode === 'bot';
  const isBotControlled = (player) => isBotMode() || player === state.ai;
  const playerName = (player) => {
    if (isBotMode()) return player === 1 ? 'Bot Đen' : 'Bot Trắng';
    return player === state.human ? 'Bạn' : 'Máy';
  };

  const els = {
    canvas: $('board'),
    boardFrame: $('boardFrame'),
    humanCard: $('humanCard'),
    aiCard: $('aiCard'),
    humanPlayerLabel: $('humanPlayerLabel'),
    humanPlayerName: $('humanPlayerName'),
    aiPlayerLabel: $('aiPlayerLabel'),
    aiLevelLabel: $('aiLevelLabel'),
    difficultyBadge: $('difficultyBadge'),
    thinkingText: $('thinkingText'),
    turnStone: $('turnStone'),
    turnTitle: $('turnTitle'),
    turnSubtitle: $('turnSubtitle'),
    moveCounter: $('moveCounter'),
    thinkMeta: $('thinkMeta'),
    thinkingPill: $('thinkingPill'),
    hoverInfo: $('hoverInfo'),
    coordReadout: $('coordReadout'),
    resultOverlay: $('resultOverlay'),
    resultCard: $('resultCard'),
    resultKicker: $('resultKicker'),
    resultTitle: $('resultTitle'),
    resultText: $('resultText'),
    playAgainBtn: $('playAgainBtn'),
    reviewBtn: $('reviewBtn'),
    newGameBtn: $('newGameBtn'),
    undoBtn: $('undoBtn'),
    hintBtn: $('hintBtn'),
    pauseBtn: $('pauseBtn'),
    pauseIcon: $('pauseIcon'),
    pauseLabel: $('pauseLabel'),
    modeGroup: $('modeGroup'),
    difficultyField: $('difficultyField'),
    difficultyGroup: $('difficultyGroup'),
    botConfig: $('botConfig'),
    firstLabel: $('firstLabel'),
    firstGroup: $('firstGroup'),
    firstHumanBtn: $('firstHumanBtn'),
    firstAiBtn: $('firstAiBtn'),
    settingsNote: $('settingsNote'),
    thinkLimitBox: $('thinkLimitBox'),
    thinkLimitText: $('thinkLimitText'),
    thinkLimitRemain: $('thinkLimitRemain'),
    thinkProgress: $('thinkProgress'),
    historyList: $('historyList'),
    historyCount: $('historyCount'),
    soundBtn: $('soundBtn'),
    soundOnIcon: $('soundOnIcon'),
    soundOffIcon: $('soundOffIcon'),
    rulesBtn: $('rulesBtn'),
    rulesModal: $('rulesModal'),
    rulesCloseBtn: $('rulesCloseBtn'),
    rulesPlayBtn: $('rulesPlayBtn'),
    zoomInBtn: $('zoomInBtn'),
    zoomOutBtn: $('zoomOutBtn'),
    zoomFitBtn: $('zoomFitBtn'),
    toast: $('toast')
  };

  const state = {
    board: new Uint8Array(NN),
    human: 1,
    ai: 2,
    turn: 1,
    first: 'human',
    level: 'super',
    mode: 'pve',
    paused: false,
    thinkLimit: 0,
    history: [],
    gameOver: false,
    winner: 0,
    winLine: [],
    thinking: false,
    hintLoading: false,
    hint: -1,
    hintUntil: 0,
    hover: -1,
    lastMove: -1,
    lastPlacedAt: 0,
    winAnimUntil: 0,
    lastAiStats: null,
    pending: null,
    requestSeq: 0,
    sound: true,
    clockTimer: null,
    clockStarted: 0,
    aiDelayTimer: null,
    watchdogTimer: null,
    hintClearTimer: null,
    toastTimer: null,
    resultDismissed: false
  };

  const view = { zoom: 1, panX: 0, panY: 0, initialized: false };
  let W = 0;
  let H = 0;
  let DPR = 1;
  let baseCell = 0;
  let pad = 0;
  let cell = 0;
  let originX = 0;
  let originY = 0;
  let gridSpan = 0;
  let bgCanvas = null;
  let rafId = 0;
  let resizeRaf = 0;
  let worker = null;
  let workerUrl = null;
  let audioCtx = null;
  let blackSprite = null;
  let whiteSprite = null;
  let rulesOpener = null;

  const pointers = new Map();
  let drag = null;
  let pinch = null;

  // -------------------------------------------------------------------
  // Khởi tạo
  // -------------------------------------------------------------------
  function init() {
    loadSettings();
    blackSprite = makeStoneSprite(1);
    whiteSprite = makeStoneSprite(2);
    bindEvents();
    resizeCanvas();
    syncSoundUI();
    syncSegments();
    resetGame();
    maybeShowMobileTip();
  }

  function maybeShowMobileTip() {
    if (!window.matchMedia('(max-width: 620px)').matches) return;
    try {
      if (localStorage.getItem('caro50-tip-seen')) return;
      localStorage.setItem('caro50-tip-seen', '1');
    } catch (_) { /* bỏ qua */ }
    setTimeout(() => {
      showToast('Chạm để đánh · kéo để di chuyển · chụm hai ngón để thu phóng.');
    }, 1300);
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem('caro50-settings');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && LEVEL_LABELS[data.level]) state.level = data.level;
      if (data && (data.first === 'human' || data.first === 'ai')) state.first = data.first;
      if (data && (data.mode === 'pve' || data.mode === 'bot')) state.mode = data.mode;
      if (data && typeof data.sound === 'boolean') state.sound = data.sound;
    } catch (_) { /* bỏ qua */ }
  }

  function saveSettings() {
    try {
      localStorage.setItem('caro50-settings', JSON.stringify({
        level: state.level,
        first: state.first,
        mode: state.mode,
        sound: state.sound
      }));
    } catch (_) { /* bỏ qua */ }
  }

  // -------------------------------------------------------------------
  // Canvas & giao diện bàn cờ
  // -------------------------------------------------------------------
  function scheduleResize() {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      resizeCanvas();
    });
  }

  function resizeCanvas() {
    const rect = els.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    W = rect.width;
    H = rect.height;
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    const pw = Math.max(1, Math.round(W * DPR));
    const ph = Math.max(1, Math.round(H * DPR));
    if (els.canvas.width !== pw || els.canvas.height !== ph) {
      els.canvas.width = pw;
      els.canvas.height = ph;
    }
    pad = Math.max(16, Math.min(W, H) * 0.043);
    baseCell = (Math.min(W, H) - pad * 2) / (N - 1);
    if (!view.initialized) {
      view.initialized = true;
      setDefaultView(false);
    }
    clampPan();
    buildBackground();
    syncZoomButtons();
    requestDraw();
  }

  function setDefaultView(update) {
    if (!baseCell) return;
    view.zoom = W < 560 ? clamp(12 / baseCell, 1.4, 1.8) : 1;
    view.panX = 0;
    view.panY = 0;
    if (update) requestDraw();
  }

  function updateMetrics() {
    cell = baseCell * view.zoom;
    gridSpan = cell * (N - 1);
    originX = (W - gridSpan) / 2 + view.panX;
    originY = (H - gridSpan) / 2 + view.panY;
  }

  function clampPan() {
    if (!baseCell) return;
    const span = baseCell * view.zoom * (N - 1);
    if (span <= W + 1) view.panX = 0;
    else {
      const limit = (span - W) / 2 + W * 0.08;
      view.panX = clamp(view.panX, -limit, limit);
    }
    if (span <= H + 1) view.panY = 0;
    else {
      const limit = (span - H) / 2 + H * 0.08;
      view.panY = clamp(view.panY, -limit, limit);
    }
  }

  function buildBackground() {
    if (!W || !H) return;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W * DPR));
    c.height = Math.max(1, Math.round(H * DPR));
    const g = c.getContext('2d');
    g.scale(DPR, DPR);

    const base = g.createLinearGradient(0, 0, W, H);
    base.addColorStop(0, '#ecd5ae');
    base.addColorStop(0.38, '#e2c495');
    base.addColorStop(0.72, '#d9b784');
    base.addColorStop(1, '#cfa974');
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);

    const light = g.createRadialGradient(W * 0.33, H * 0.23, 0, W * 0.38, H * 0.3, Math.max(W, H) * 0.78);
    light.addColorStop(0, 'rgba(255, 248, 226, 0.48)');
    light.addColorStop(0.55, 'rgba(255, 244, 218, 0.12)');
    light.addColorStop(1, 'rgba(255, 244, 218, 0)');
    g.fillStyle = light;
    g.fillRect(0, 0, W, H);

    // Vân gỗ rất nhẹ, ổn định theo kích thước.
    let seed = 0x50c0ffee;
    const rand = () => {
      seed |= 0;
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < 95; i++) {
      const y0 = rand() * H;
      const amp = 1 + rand() * 5;
      const phase = rand() * TAU;
      g.beginPath();
      for (let x = -8; x <= W + 8; x += Math.max(10, W / 9)) {
        const y = y0 + Math.sin(x / (W * 0.045) + phase) * amp + Math.sin(x / (W * 0.013) + phase * 1.7) * 0.9;
        if (x < 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = `rgba(102, 68, 32, ${0.018 + rand() * 0.033})`;
      g.lineWidth = 0.55 + rand() * 0.9;
      g.stroke();
    }
    for (let i = 0; i < Math.min(1400, W * H / 290); i++) {
      const x = rand() * W;
      const y = rand() * H;
      g.fillStyle = `rgba(91, 60, 27, ${0.018 + rand() * 0.032})`;
      g.fillRect(x, y, 0.8 + rand() * 1.1, 0.6 + rand() * 0.8);
    }

    const sheen = g.createLinearGradient(0, 0, W, H);
    sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
    sheen.addColorStop(0.26, 'rgba(255,255,255,0.02)');
    sheen.addColorStop(0.62, 'rgba(255,255,255,0)');
    sheen.addColorStop(1, 'rgba(64,35,11,0.09)');
    g.fillStyle = sheen;
    g.fillRect(0, 0, W, H);

    const vignette = g.createRadialGradient(W * 0.5, H * 0.46, Math.min(W, H) * 0.18, W * 0.5, H * 0.5, Math.max(W, H) * 0.8);
    vignette.addColorStop(0, 'rgba(60,32,10,0)');
    vignette.addColorStop(0.72, 'rgba(76,45,18,0.025)');
    vignette.addColorStop(1, 'rgba(48,27,10,0.22)');
    g.fillStyle = vignette;
    g.fillRect(0, 0, W, H);

    const edge = g.createLinearGradient(0, 0, 0, H);
    edge.addColorStop(0, 'rgba(255,246,225,0.13)');
    edge.addColorStop(0.04, 'rgba(255,246,225,0)');
    edge.addColorStop(0.94, 'rgba(56,31,10,0)');
    edge.addColorStop(1, 'rgba(50,28,10,0.18)');
    g.fillStyle = edge;
    g.fillRect(0, 0, W, H);

    bgCanvas = c;
  }

  function makeStoneSprite(player) {
    const size = 180;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;
    const r = 61;

    g.save();
    g.shadowColor = 'rgba(43, 24, 8, 0.55)';
    g.shadowBlur = 11;
    g.shadowOffsetY = 7;
    g.beginPath();
    g.arc(cx, cy + 2, r, 0, TAU);
    g.fillStyle = '#1a0f06';
    g.fill();
    g.restore();

    g.beginPath();
    g.arc(cx, cy, r, 0, TAU);
    if (player === 1) {
      const grd = g.createRadialGradient(cx - r * 0.36, cy - r * 0.43, r * 0.03, cx + r * 0.08, cy + r * 0.1, r * 1.08);
      grd.addColorStop(0, '#78858e');
      grd.addColorStop(0.12, '#4b555f');
      grd.addColorStop(0.42, '#242b32');
      grd.addColorStop(0.75, '#0d1115');
      grd.addColorStop(1, '#020304');
      g.fillStyle = grd;
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.16)';
      g.lineWidth = 1.6;
      g.stroke();

      const shine = g.createRadialGradient(cx - r * 0.4, cy - r * 0.45, 0, cx - r * 0.4, cy - r * 0.45, r * 0.72);
      shine.addColorStop(0, 'rgba(255,255,255,0.19)');
      shine.addColorStop(0.45, 'rgba(255,255,255,0.045)');
      shine.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = shine;
      g.beginPath();
      g.arc(cx, cy, r, 0, TAU);
      g.fill();
    } else {
      const grd = g.createRadialGradient(cx - r * 0.36, cy - r * 0.44, r * 0.03, cx + r * 0.08, cy + r * 0.1, r * 1.1);
      grd.addColorStop(0, '#ffffff');
      grd.addColorStop(0.22, '#fffaf1');
      grd.addColorStop(0.58, '#f1e7d8');
      grd.addColorStop(0.86, '#d4c5b0');
      grd.addColorStop(1, '#b6a58e');
      g.fillStyle = grd;
      g.fill();
      g.strokeStyle = 'rgba(96, 72, 43, 0.34)';
      g.lineWidth = 1.4;
      g.stroke();

      const shade = g.createRadialGradient(cx + r * 0.28, cy + r * 0.35, r * 0.08, cx + r * 0.3, cy + r * 0.4, r * 1.02);
      shade.addColorStop(0, 'rgba(132, 106, 72, 0)');
      shade.addColorStop(0.72, 'rgba(132, 106, 72, 0.035)');
      shade.addColorStop(1, 'rgba(99, 74, 42, 0.2)');
      g.fillStyle = shade;
      g.beginPath();
      g.arc(cx, cy, r, 0, TAU);
      g.fill();

      const shine = g.createRadialGradient(cx - r * 0.35, cy - r * 0.42, 0, cx - r * 0.35, cy - r * 0.42, r * 0.58);
      shine.addColorStop(0, 'rgba(255,255,255,0.9)');
      shine.addColorStop(0.32, 'rgba(255,255,255,0.2)');
      shine.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = shine;
      g.beginPath();
      g.arc(cx, cy, r, 0, TAU);
      g.fill();
    }

    return c;
  }

  function requestDraw() {
    if (rafId) return;
    rafId = requestAnimationFrame((t) => {
      rafId = 0;
      draw(t);
      if (isAnimating(t)) requestDraw();
    });
  }

  function isAnimating(t) {
    return (state.winLine.length > 0 && t < state.winAnimUntil) ||
      (state.hint >= 0 && t < state.hintUntil) ||
      (t - state.lastPlacedAt < 240);
  }

  function draw(t) {
    if (!W || !H) return;
    const now = t || performance.now();
    updateMetrics();
    const ctx = els.canvas.getContext('2d');
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0, W, H);
    drawGrid(ctx);
    drawWinGlow(ctx, now);
    drawStones(ctx, now);
    drawWinRings(ctx, now);
    drawHover(ctx);
    drawHint(ctx, now);
  }

  function drawGrid(ctx) {
    const major = 'rgba(76, 52, 27, 0.52)';
    const minor = 'rgba(90, 63, 34, 0.31)';
    ctx.save();
    for (let c = 0; c < N; c++) {
      const x = originX + c * cell;
      if (x < -1 || x > W + 1) continue;
      ctx.beginPath();
      ctx.moveTo(x, originY);
      ctx.lineTo(x, originY + gridSpan);
      ctx.strokeStyle = c % 5 === 0 ? major : minor;
      ctx.lineWidth = c % 5 === 0 ? 1.05 : 0.7;
      ctx.stroke();
    }
    for (let r = 0; r < N; r++) {
      const y = originY + r * cell;
      if (y < -1 || y > H + 1) continue;
      ctx.beginPath();
      ctx.moveTo(originX, y);
      ctx.lineTo(originX + gridSpan, y);
      ctx.strokeStyle = r % 5 === 0 ? major : minor;
      ctx.lineWidth = r % 5 === 0 ? 1.05 : 0.7;
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(81, 52, 22, 0.42)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(originX, originY, gridSpan, gridSpan);

    // Điểm sao mờ ở các mốc 10.
    ctx.fillStyle = 'rgba(74, 48, 22, 0.34)';
    for (let r = 10; r < N; r += 10) {
      for (let c = 10; c < N; c += 10) {
        const x = originX + c * cell;
        const y = originY + r * cell;
        if (x < -4 || x > W + 4 || y < -4 || y > H + 4) continue;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.4, cell * 0.075), 0, TAU);
        ctx.fill();
      }
    }

    // Nhãn toạ độ. Khi phóng to sẽ hiện dày hơn.
    const step = view.zoom >= 3 ? 1 : view.zoom >= 1.8 ? 2 : 5;
    const fontSize = clamp(cell * 0.48, 7, 10);
    ctx.font = `600 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(71, 48, 23, 0.58)';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    const edgeTop = originY - cell * 0.62;
    const edgeBottom = originY + gridSpan + cell * 0.72;
    const topY = edgeTop > 6 ? edgeTop : 11;
    const bottomY = edgeBottom < H - 4 ? edgeBottom : H - 11;
    for (let c = 0; c < N; c += step) {
      const x = originX + c * cell;
      if (x >= 8 && x <= W - 8) {
        ctx.fillText(colName(c), x, topY);
        ctx.fillText(colName(c), x, bottomY);
      }
    }

    const edgeLeft = originX - cell * 0.62;
    const edgeRight = originX + gridSpan + cell * 0.72;
    const leftFixed = edgeLeft <= 10;
    const rightFixed = edgeRight >= W - 4;
    const leftX = leftFixed ? 12 : edgeLeft;
    const rightX = rightFixed ? W - 12 : edgeRight;
    ctx.textAlign = leftFixed ? 'left' : 'right';
    for (let r = 0; r < N; r += step) {
      const y = originY + r * cell;
      if (y >= 8 && y <= H - 8) {
        ctx.fillText(String(r + 1), leftX, y);
      }
    }
    ctx.textAlign = rightFixed ? 'right' : 'left';
    for (let r = 0; r < N; r += step) {
      const y = originY + r * cell;
      if (y >= 8 && y <= H - 8) {
        ctx.fillText(String(r + 1), rightX, y);
      }
    }
    ctx.restore();
  }

  function stoneScale(radius) {
    return radius * (180 / 61);
  }

  function drawStones(ctx, now) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (let i = 0; i < NN; i++) {
      const p = state.board[i];
      if (!p) continue;
      const r = (i / N) | 0;
      const c = i % N;
      const x = originX + c * cell;
      const y = originY + r * cell;
      if (x < -cell * 2 || x > W + cell * 2 || y < -cell * 2 || y > H + cell * 2) continue;

      let radius = Math.max(1.9, cell * 0.48);
      let scale = 1;
      if (i === state.lastMove) {
        const age = now - state.lastPlacedAt;
        if (age < 230) {
          const k = clamp(age / 230, 0, 1);
          scale = 0.62 + 0.38 * (1 - Math.pow(1 - k, 3));
        }
      }
      radius *= scale;
      const d = stoneScale(radius);
      ctx.drawImage(p === 1 ? blackSprite : whiteSprite, x - d / 2, y - d / 2, d, d);

      if (i === state.lastMove) {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.5, radius * 0.68), 0, TAU);
        ctx.strokeStyle = 'rgba(231, 171, 83, 0.92)';
        ctx.lineWidth = Math.max(1, radius * 0.12);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.9, radius * 0.16), 0, TAU);
        ctx.fillStyle = 'rgba(255, 214, 138, 0.96)';
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawWinGlow(ctx, now) {
    if (!state.winLine.length) return;
    const a = state.winLine[0];
    const b = state.winLine[state.winLine.length - 1];
    const x1 = originX + (a % N) * cell;
    const y1 = originY + ((a / N) | 0) * cell;
    const x2 = originX + (b % N) * cell;
    const y2 = originY + ((b / N) | 0) * cell;
    const pulse = 0.5 + 0.5 * Math.sin(now / 230);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = `rgba(246, 193, 105, ${0.24 + pulse * 0.14})`;
    ctx.lineWidth = Math.max(4, cell * 0.32);
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(255, 197, 98, 0.8)';
    ctx.shadowBlur = Math.max(12, cell * 1.05);
    ctx.stroke();
    ctx.restore();
  }

  function drawWinRings(ctx, now) {
    if (!state.winLine.length) return;
    const pulse = 0.5 + 0.5 * Math.sin(now / 230);
    ctx.save();
    for (let i = 0; i < state.winLine.length; i++) {
      const idx = state.winLine[i];
      const x = originX + (idx % N) * cell;
      const y = originY + ((idx / N) | 0) * cell;
      const r = Math.max(3.5, cell * 0.58);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.strokeStyle = `rgba(255, 220, 152, ${0.76 + pulse * 0.22})`;
      ctx.lineWidth = Math.max(1.4, cell * 0.09);
      ctx.shadowColor = 'rgba(255, 205, 112, 0.9)';
      ctx.shadowBlur = Math.max(7, cell * 0.7);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawHover(ctx) {
    if (isBotMode() || state.hint >= 0) return;
    if (state.gameOver || state.thinking || state.turn !== state.human) return;
    const idx = state.hover;
    if (idx < 0 || state.board[idx] !== 0) return;
    const x = originX + (idx % N) * cell;
    const y = originY + ((idx / N) | 0) * cell;
    const radius = Math.max(1.9, cell * 0.48);
    const d = stoneScale(radius);
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.drawImage(state.turn === 1 ? blackSprite : whiteSprite, x - d / 2, y - d / 2, d, d);
    ctx.globalAlpha = 1;
    ctx.setLineDash([Math.max(2, cell * 0.13), Math.max(2, cell * 0.13)]);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(3, cell * 0.57), 0, TAU);
    ctx.strokeStyle = 'rgba(84, 55, 25, 0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function drawHint(ctx, now) {
    if (state.hint < 0 || state.hint >= NN || state.board[state.hint] !== 0) return;
    if (now > state.hintUntil) return;
    const x = originX + (state.hint % N) * cell;
    const y = originY + ((state.hint / N) | 0) * cell;
    const pulse = 0.5 + 0.5 * Math.sin(now / 260);
    ctx.save();
    ctx.strokeStyle = `rgba(232, 184, 106, ${0.55 + pulse * 0.4})`;
    ctx.lineWidth = Math.max(1.2, cell * 0.075);
    ctx.setLineDash([Math.max(2, cell * 0.14), Math.max(2, cell * 0.12)]);
    ctx.lineDashOffset = -now / 42;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(4, cell * 0.53), 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1.2, cell * 0.11), 0, TAU);
    ctx.fillStyle = 'rgba(232, 184, 106, 0.92)';
    ctx.fill();
    ctx.restore();
  }

  function screenToCell(clientX, clientY) {
    if (!cell) return -1;
    const rect = els.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const col = Math.round((x - originX) / cell);
    const row = Math.round((y - originY) / cell);
    if (col < 0 || col >= N || row < 0 || row >= N) return -1;
    const cx = originX + col * cell;
    const cy = originY + row * cell;
    const tolerance = Math.max(cell * 0.74, 6);
    if (Math.abs(x - cx) > tolerance || Math.abs(y - cy) > tolerance) return -1;
    return row * N + col;
  }

  function colName(c) {
    let n = c + 1;
    let s = '';
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function coordName(idx) {
    return colName(idx % N) + (((idx / N) | 0) + 1);
  }

  // -------------------------------------------------------------------
  // Tương tác bàn cờ
  // -------------------------------------------------------------------
  function zoomAt(clientX, clientY, nextZoom) {
    if (!baseCell) return;
    const oldZoom = view.zoom;
    const z = clamp(nextZoom, 1, 5);
    if (Math.abs(z - oldZoom) < 0.001) return;
    const rect = els.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const oldSpan = baseCell * oldZoom * (N - 1);
    const oldOriginX = (W - oldSpan) / 2 + view.panX;
    const oldOriginY = (H - oldSpan) / 2 + view.panY;
    const u = (px - oldOriginX) / (baseCell * oldZoom);
    const v = (py - oldOriginY) / (baseCell * oldZoom);
    const newSpan = baseCell * z * (N - 1);
    const newOriginX = px - u * baseCell * z;
    const newOriginY = py - v * baseCell * z;
    view.zoom = z;
    view.panX = newOriginX - (W - newSpan) / 2;
    view.panY = newOriginY - (H - newSpan) / 2;
    if (z === 1) {
      view.panX = 0;
      view.panY = 0;
    }
    clampPan();
    syncZoomButtons();
    requestDraw();
  }

  function zoomBy(factor) {
    const rect = els.canvas.getBoundingClientRect();
    zoomAt(rect.left + W / 2, rect.top + H / 2, view.zoom * factor);
  }

  function fitView() {
    view.zoom = 1;
    view.panX = 0;
    view.panY = 0;
    syncZoomButtons();
    requestDraw();
  }

  function syncZoomButtons() {
    els.zoomInBtn.disabled = view.zoom >= 4.999;
    els.zoomOutBtn.disabled = view.zoom <= 1.001;
  }

  function updateHoverFromPoint(clientX, clientY) {
    const idx = screenToCell(clientX, clientY);
    if (idx === state.hover) return;
    state.hover = idx;
    updateHoverUI();
    requestDraw();
  }

  function updateHoverUI() {
    if (state.hover < 0) {
      els.hoverInfo.classList.remove('visible');
      els.coordReadout.textContent = 'Ô — · trống';
      return;
    }
    const v = state.board[state.hover];
    const label = v === 0 ? 'trống' : v === 1 ? 'Đen' : 'Trắng';
    els.coordReadout.textContent = `Ô ${coordName(state.hover)} · ${label}`;
    if (!state.gameOver) {
      els.hoverInfo.textContent = `${coordName(state.hover)} · ${label}`;
      els.hoverInfo.classList.add('visible');
    } else {
      els.hoverInfo.classList.remove('visible');
    }
  }

  function clearHover() {
    if (state.hover === -1) return;
    state.hover = -1;
    updateHoverUI();
    requestDraw();
  }

  function handleBoardClick(clientX, clientY) {
    if (isBotMode()) {
      showToast(state.paused
        ? 'Đang tạm dừng. Bấm “Tiếp tục” để hai bot đánh tiếp.'
        : 'Chế độ Máy vs Máy đang tự chơi. Bấm “Tạm dừng” nếu muốn xem lại.');
      return;
    }
    if (state.gameOver) {
      showToast('Ván đấu đã kết thúc. Bấm “Ván mới” để chơi tiếp.');
      return;
    }
    if (state.hintLoading) {
      showToast('Đang tìm nước gợi ý, chờ một chút nhé.');
      return;
    }
    if (state.thinking || state.pending) {
      showToast('Máy đang suy nghĩ. Chờ máy đi xong nhé.');
      return;
    }
    if (state.turn !== state.human) {
      showToast('Đang đến lượt máy đi.');
      return;
    }
    const idx = screenToCell(clientX, clientY);
    if (idx < 0) return;
    if (state.board[idx] !== 0) {
      showToast('Giao điểm này đã có quân.');
      return;
    }
    clearHover();
    placeHuman(idx);
  }

  function bindCanvasEvents() {
    const canvas = els.canvas;

    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* bỏ qua */ }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        drag = {
          id: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          startPanX: view.panX,
          startPanY: view.panY,
          moved: false,
          started: performance.now()
        };
        pinch = null;
      } else if (pointers.size === 2) {
        drag = null;
        const pts = Array.from(pointers.values());
        pinch = {
          distance: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
          zoom: view.zoom
        };
        canvas.classList.remove('grabbing');
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) {
        const p = pointers.get(e.pointerId);
        p.x = e.clientX;
        p.y = e.clientY;
      }

      if (pinch && pointers.size >= 2) {
        const pts = Array.from(pointers.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (pinch.distance > 4) {
          const midX = (pts[0].x + pts[1].x) / 2;
          const midY = (pts[0].y + pts[1].y) / 2;
          zoomAt(midX, midY, pinch.zoom * (dist / pinch.distance));
        }
        return;
      }

      if (drag && drag.id === e.pointerId && pointers.size === 1) {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (Math.hypot(dx, dy) > 5) drag.moved = true;
        if (view.zoom > 1) {
          canvas.classList.add('grabbing');
          view.panX = drag.startPanX + dx;
          view.panY = drag.startPanY + dy;
          clampPan();
          requestDraw();
        }
      }

      if (e.pointerType === 'mouse' || pointers.size === 0) {
        updateHoverFromPoint(e.clientX, e.clientY);
      }
    });

    const endPointer = (e) => {
      const hadPinch = !!pinch;
      pointers.delete(e.pointerId);
      if (hadPinch) {
        if (pointers.size < 2) {
          pinch = null;
          if (pointers.size === 1) {
            const remaining = Array.from(pointers.entries())[0];
            drag = {
              id: remaining[0],
              startX: remaining[1].x,
              startY: remaining[1].y,
              startPanX: view.panX,
              startPanY: view.panY,
              moved: true,
              started: performance.now()
            };
          }
        }
        canvas.classList.remove('grabbing');
        return;
      }
      if (drag && drag.id === e.pointerId) {
        const moved = drag.moved;
        const quick = performance.now() - drag.started < 750;
        drag = null;
        canvas.classList.remove('grabbing');
        if (!moved && quick) {
          handleBoardClick(e.clientX, e.clientY);
          if (e.pointerType !== 'mouse') clearHover();
        }
      }
      if (pointers.size === 0) canvas.classList.remove('grabbing');
    };

    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', (e) => {
      pointers.delete(e.pointerId);
      drag = null;
      pinch = null;
      canvas.classList.remove('grabbing');
    });
    canvas.addEventListener('pointerleave', () => {
      if (pointers.size === 0) clearHover();
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.00135);
      zoomAt(e.clientX, e.clientY, view.zoom * factor);
    }, { passive: false });
  }

  // -------------------------------------------------------------------
  // Web Worker AI
  // -------------------------------------------------------------------
  function createWorker() {
    destroyWorker();
    try {
      const source = $('aiWorkerSource').textContent;
      const blob = new Blob([source], { type: 'text/javascript' });
      workerUrl = URL.createObjectURL(blob);
      worker = new Worker(workerUrl);
      worker.onmessage = handleWorkerMessage;
      worker.onerror = handleWorkerError;
    } catch (err) {
      console.error('Không khởi tạo được Web Worker:', err);
      worker = null;
      showToast('Không khởi tạo được bộ máy AI. Hãy tải lại trang.');
    }
  }

  function destroyWorker() {
    if (worker) {
      try { worker.terminate(); } catch (_) { /* bỏ qua */ }
      worker = null;
    }
    if (workerUrl) {
      try { URL.revokeObjectURL(workerUrl); } catch (_) { /* bỏ qua */ }
      workerUrl = null;
    }
  }

  function clearWatchdog() {
    if (state.watchdogTimer) {
      clearTimeout(state.watchdogTimer);
      state.watchdogTimer = null;
    }
  }

  function abortThinking() {
    if (state.aiDelayTimer) {
      clearTimeout(state.aiDelayTimer);
      state.aiDelayTimer = null;
    }
    clearWatchdog();
    stopClock();
    state.pending = null;
    state.thinking = false;
    state.hintLoading = false;
    state.requestSeq++;
    destroyWorker();
    createWorker();
  }

  function scheduleAI(delay) {
    if (state.aiDelayTimer) clearTimeout(state.aiDelayTimer);
    state.aiDelayTimer = setTimeout(() => {
      state.aiDelayTimer = null;
      if (!state.gameOver && !state.paused && isBotControlled(state.turn) && !state.pending && !state.thinking) {
        requestAI();
      }
    }, typeof delay === 'number' ? delay : 260);
  }

  function requestAI() {
    if (state.gameOver || state.paused || !isBotControlled(state.turn) || state.pending) return;
    if (!worker) createWorker();
    if (!worker) {
      fallbackMove();
      return;
    }
    const player = state.turn;
    const botMode = isBotMode();
    state.thinking = true;
    state.hint = -1;
    state.thinkLimit = botMode ? BOT_TIME_LIMIT : 0;
    const id = ++state.requestSeq;
    state.pending = { id, purpose: 'ai', player };
    startClock();
    updateUI();
    try {
      worker.postMessage({
        type: 'move',
        requestId: id,
        board: Array.from(state.board),
        player,
        level: botMode ? 'super' : state.level,
        timeLimit: botMode ? BOT_ENGINE_LIMIT : undefined
      });
      if (botMode) {
        clearWatchdog();
        state.watchdogTimer = setTimeout(() => {
          state.watchdogTimer = null;
          handleBotTimeout(id);
        }, BOT_TIME_LIMIT);
      }
    } catch (err) {
      console.error(err);
      clearWatchdog();
      state.pending = null;
      state.thinking = false;
      stopClock();
      showToast('Không gửi được nước đi cho máy. Đang chọn nước dự phòng.');
      fallbackMove();
    }
  }

  function handleBotTimeout(id) {
    if (!state.pending || state.pending.id !== id) return;
    if (state.gameOver || state.paused) return;
    console.warn('Bot vượt quá giới hạn 30 giây, dùng nước dự phòng.');
    abortThinking();
    updateUI();
    showToast('Bot đã chạm giới hạn 30 giây. Chọn nước dự phòng để tiếp tục.');
    fallbackMove();
  }

  function requestHint() {
    if (isBotMode() || state.gameOver || state.thinking || state.hintLoading || state.turn !== state.human || state.pending) return;
    if (!worker) createWorker();
    if (!worker) return;
    state.hintLoading = true;
    const id = ++state.requestSeq;
    state.pending = { id, purpose: 'hint' };
    updateUI();
    showToast('Đang tìm nước gợi ý mạnh nhất cho bạn…');
    try {
      worker.postMessage({
        type: 'hint',
        requestId: id,
        board: Array.from(state.board),
        player: state.human,
        level: 'super',
        timeLimit: 1600
      });
    } catch (err) {
      console.error(err);
      state.pending = null;
      state.hintLoading = false;
      updateUI();
      showToast('Không tạo được gợi ý lúc này.');
    }
  }

  function handleWorkerMessage(event) {
    const msg = event.data || {};
    if (!state.pending || msg.requestId !== state.pending.id) return;
    const pending = state.pending;

    if (msg.type === 'error') {
      console.error('AI error:', msg.message);
      state.pending = null;
      if (pending.purpose === 'hint') {
        state.hintLoading = false;
        updateUI();
        showToast('Không tạo được gợi ý lúc này.');
        return;
      }
      state.thinking = false;
      stopClock();
      updateUI();
      showToast('Bộ máy AI gặp sự cố. Đang chọn nước dự phòng.');
      fallbackMove();
      return;
    }

    if (msg.type !== 'result') return;

    if (pending.purpose === 'hint') {
      clearWatchdog();
      state.pending = null;
      state.hintLoading = false;
      if (msg.result && Number.isInteger(msg.result.idx) && msg.result.idx >= 0 && msg.result.idx < NN &&
          state.board[msg.result.idx] === 0 && !state.gameOver) {
        showHint(msg.result.idx);
      } else {
        showToast('Chưa tìm được gợi ý phù hợp.');
      }
      updateUI();
      return;
    }

    if (pending.purpose === 'ai') {
      clearWatchdog();
      state.pending = null;
      state.thinking = false;
      stopClock();
      if (state.gameOver || state.paused || state.turn !== pending.player) {
        updateUI();
        return;
      }
      const result = msg.result;
      if (result && Number.isInteger(result.idx) && result.idx >= 0 && result.idx < NN && state.board[result.idx] === 0) {
        state.lastAiStats = result.stats || null;
        applyMove(result.idx, pending.player, result.stats || null);
      } else {
        showToast('Máy trả về nước đi không hợp lệ. Đang chọn nước dự phòng.');
        fallbackMove();
      }
    }
  }

  function handleWorkerError(event) {
    console.error('Worker error:', event);
    if (!state.pending) return;
    const purpose = state.pending.purpose;
    clearWatchdog();
    state.pending = null;
    state.thinking = false;
    state.hintLoading = false;
    stopClock();
    updateUI();
    showToast('Bộ máy AI gặp sự cố. Đang chọn nước dự phòng.');
    if (purpose === 'ai') fallbackMove();
  }

  function fallbackMove() {
    if (state.gameOver || !isBotControlled(state.turn)) return;
    const player = state.turn;
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < NN; i++) {
      if (state.board[i] !== 0) continue;
      const r = (i / N) | 0;
      const c = i % N;
      let near = 0;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          if (!dr && !dc) continue;
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < N && cc >= 0 && cc < N && state.board[rr * N + cc]) near++;
        }
      }
      const center = 30 - Math.max(Math.abs(r - 25), Math.abs(c - 25));
      const score = near * 10 + center;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) best = 25 * N + 25;
    state.thinking = false;
    state.lastAiStats = { source: 'fallback', elapsed: 0, depth: 0, nodes: 0 };
    applyMove(best, player, state.lastAiStats);
  }

  function startClock() {
    if (state.clockTimer) clearInterval(state.clockTimer);
    state.clockStarted = performance.now();
    updateClockText();
    state.clockTimer = setInterval(updateClockText, 100);
  }

  function stopClock(clearStart) {
    if (state.clockTimer) {
      clearInterval(state.clockTimer);
      state.clockTimer = null;
    }
    if (clearStart !== false) state.clockStarted = 0;
    state.thinkLimit = 0;
    updateThinkLimitUI();
  }

  function updateClockText() {
    if (!state.thinking || !state.clockStarted) return;
    const elapsed = performance.now() - state.clockStarted;
    if (state.thinkLimit > 0) {
      const remain = Math.max(0, state.thinkLimit - elapsed);
      els.thinkMeta.textContent = `Đang tính · còn ${(remain / 1000).toFixed(1).replace('.', ',')} giây`;
    } else {
      els.thinkMeta.textContent = `Đang tính · ${(elapsed / 1000).toFixed(1).replace('.', ',')} giây`;
    }
    updateThinkLimitUI();
  }

  function updateThinkLimitUI() {
    if (!els.thinkLimitBox) return;
    if (!isBotMode()) {
      els.thinkLimitBox.hidden = true;
      return;
    }
    els.thinkLimitBox.hidden = false;
    const limit = BOT_TIME_LIMIT;
    if (state.gameOver) {
      els.thinkLimitText.textContent = 'Ván đấu đã kết thúc';
      els.thinkLimitRemain.textContent = '—';
      els.thinkProgress.style.width = '0%';
      return;
    }
    if (state.paused) {
      els.thinkLimitText.textContent = 'Đã tạm dừng';
      els.thinkLimitRemain.textContent = 'chờ tiếp tục';
      els.thinkProgress.style.width = '0%';
      return;
    }
    els.thinkLimitText.textContent = `Giới hạn mỗi nước: ${limit / 1000} giây`;
    if (state.thinking && state.clockStarted) {
      const elapsed = Math.max(0, performance.now() - state.clockStarted);
      const remain = Math.max(0, limit - elapsed);
      els.thinkLimitRemain.textContent = `còn ${(remain / 1000).toFixed(1).replace('.', ',')} giây`;
      els.thinkProgress.style.width = `${clamp((elapsed / limit) * 100, 0, 100)}%`;
    } else {
      els.thinkLimitRemain.textContent = 'sẵn sàng';
      els.thinkProgress.style.width = '0%';
    }
  }

  function formatSeconds(ms) {
    if (!ms || ms < 100) return '< 0,1 giây';
    return `${(ms / 1000).toFixed(1).replace('.', ',')} giây`;
  }

  // -------------------------------------------------------------------
  // Luồng ván cờ
  // -------------------------------------------------------------------
  function resetGame() {
    abortThinking();
    state.paused = false;
    state.board.fill(0);
    state.history = [];
    state.gameOver = false;
    state.winner = 0;
    state.winLine = [];
    state.hint = -1;
    state.hintUntil = 0;
    state.hover = -1;
    state.lastMove = -1;
    state.lastPlacedAt = 0;
    state.winAnimUntil = 0;
    state.lastAiStats = null;
    state.thinkLimit = 0;
    state.resultDismissed = false;
    state.turn = state.first === 'ai' ? state.ai : state.human;
    if (state.hintClearTimer) {
      clearTimeout(state.hintClearTimer);
      state.hintClearTimer = null;
    }
    els.resultOverlay.hidden = true;
    els.resultCard.classList.remove('lose', 'draw');
    setDefaultView(false);
    updateHoverUI();
    updateUI();
    renderHistory();
    requestDraw();
    if (isBotControlled(state.turn)) scheduleAI(460);
  }

  function placeHuman(idx) {
    if (isBotMode() || state.gameOver || state.turn !== state.human) return;
    applyMove(idx, state.human, null);
  }

  function applyMove(idx, player, stats) {
    if (state.gameOver || idx < 0 || idx >= NN || state.board[idx] !== 0) return false;
    if (player !== state.turn) return false;

    state.board[idx] = player;
    state.lastMove = idx;
    state.lastPlacedAt = performance.now();
    state.hint = -1;
    if (state.hintClearTimer) {
      clearTimeout(state.hintClearTimer);
      state.hintClearTimer = null;
    }
    const move = {
      idx,
      player,
      no: state.history.length + 1,
      coord: coordName(idx),
      stats: stats || null
    };
    state.history.push(move);
    playPlaceSound(player);

    const line = findWinningLine(idx, player);
    if (line) {
      state.gameOver = true;
      state.winner = player;
      state.winLine = line;
      state.turn = 0;
      state.thinking = false;
      state.winAnimUntil = performance.now() + 5200;
      stopClock();
      clearWatchdog();
      if (state.aiDelayTimer) {
        clearTimeout(state.aiDelayTimer);
        state.aiDelayTimer = null;
      }
      updateUI();
      renderHistory();
      showResult();
      requestDraw();
      playEndSound(isBotMode() ? true : player === state.human);
      return true;
    }

    if (state.history.length >= NN) {
      state.gameOver = true;
      state.winner = 0;
      state.winLine = [];
      state.turn = 0;
      state.thinking = false;
      stopClock();
      clearWatchdog();
      updateUI();
      renderHistory();
      showResult();
      requestDraw();
      return true;
    }

    state.turn = 3 - player;
    state.thinking = false;
    updateUI();
    renderHistory();
    requestDraw();
    if (isBotControlled(state.turn) && !state.paused) scheduleAI(280);
    return true;
  }

  function findWinningLine(idx, player) {
    const r = (idx / N) | 0;
    const c = idx % N;
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (let d = 0; d < 4; d++) {
      const dr = dirs[d][0];
      const dc = dirs[d][1];
      const cells = [idx];
      let rr = r + dr;
      let cc = c + dc;
      while (rr >= 0 && rr < N && cc >= 0 && cc < N && state.board[rr * N + cc] === player) {
        cells.push(rr * N + cc);
        rr += dr;
        cc += dc;
      }
      rr = r - dr;
      cc = c - dc;
      while (rr >= 0 && rr < N && cc >= 0 && cc < N && state.board[rr * N + cc] === player) {
        cells.unshift(rr * N + cc);
        rr -= dr;
        cc -= dc;
      }
      if (cells.length >= 5) return cells;
    }
    return null;
  }

  function undoMove() {
    if (isBotMode()) {
      showToast('Chế độ Máy vs Máy không hỗ trợ đi lại. Bấm Tạm dừng để xem bàn cờ.');
      return;
    }
    const hasHuman = state.history.some((m) => m.player === state.human);
    if (!hasHuman) {
      showToast('Chưa có nước đi nào của bạn để lùi.');
      return;
    }
    abortThinking();
    let removed = false;
    while (state.history.length && state.history[state.history.length - 1].player === state.ai) {
      state.history.pop();
    }
    if (state.history.length && state.history[state.history.length - 1].player === state.human) {
      state.history.pop();
      removed = true;
    }
    rebuildBoard();
    state.gameOver = false;
    state.winner = 0;
    state.winLine = [];
    state.turn = state.human;
    state.thinking = false;
    state.hintLoading = false;
    state.lastAiStats = null;
    state.hint = -1;
    state.winAnimUntil = 0;
    state.resultDismissed = false;
    state.lastMove = state.history.length ? state.history[state.history.length - 1].idx : -1;
    state.lastPlacedAt = 0;
    if (state.hintClearTimer) {
      clearTimeout(state.hintClearTimer);
      state.hintClearTimer = null;
    }
    els.resultOverlay.hidden = true;
    els.resultCard.classList.remove('lose', 'draw');
    updateUI();
    renderHistory();
    requestDraw();
    if (removed) showToast('Đã lùi lại nước đi của bạn.');
  }

  function rebuildBoard() {
    state.board.fill(0);
    for (let i = 0; i < state.history.length; i++) {
      const m = state.history[i];
      state.board[m.idx] = m.player;
    }
  }

  function showHint(idx) {
    state.hint = idx;
    state.hintUntil = performance.now() + 5200;
    if (state.hintClearTimer) clearTimeout(state.hintClearTimer);
    state.hintClearTimer = setTimeout(() => {
      if (state.hint === idx) {
        state.hint = -1;
        state.hintUntil = 0;
        requestDraw();
      }
    }, 5300);
    requestDraw();
    showToast(`Gợi ý: ${coordName(idx)} — đó là nước máy đánh giá mạnh nhất cho bạn.`);
  }

  function togglePause() {
    if (!isBotMode() || state.gameOver) return;
    if (!state.paused) {
      state.paused = true;
      abortThinking();
      updateUI();
      showToast('Đã tạm dừng trận đấu. Bấm “Tiếp tục” để hai bot đánh tiếp.');
    } else {
      state.paused = false;
      updateUI();
      showToast('Tiếp tục trận đấu Máy vs Máy.');
      if (isBotControlled(state.turn)) scheduleAI(180);
    }
  }

  function updateUI() {
    const botMode = isBotMode();
    const humanTurn = !botMode && !state.gameOver && state.turn === state.human;
    const aiTurn = !botMode && !state.gameOver && state.turn === state.ai;
    const botTurn = !state.gameOver && (botMode ? (state.turn === 1 || state.turn === 2) : aiTurn);
    const showActive = !state.paused && !state.gameOver;

    els.humanCard.classList.toggle('active', showActive && (botMode ? state.turn === 1 : humanTurn));
    els.aiCard.classList.toggle('active', showActive && (botMode ? state.turn === 2 : aiTurn));
    els.thinkingPill.classList.toggle('show', state.thinking);
    els.thinkingText.textContent = botMode ? `${playerName(state.turn)} đang suy nghĩ` : 'Máy đang suy nghĩ';
    els.canvas.classList.toggle('thinking', state.thinking || (botTurn && !state.paused));
    els.canvas.classList.toggle('game-over', state.gameOver);
    els.canvas.classList.toggle('bot-mode', botMode);

    els.humanPlayerLabel.textContent = botMode ? 'BOT ĐEN' : 'Bạn';
    els.humanPlayerName.textContent = botMode ? 'Siêu khó' : 'Quân đen';
    els.aiPlayerLabel.textContent = botMode ? 'BOT TRẮNG' : 'Máy';
    els.aiLevelLabel.textContent = botMode ? 'Siêu khó' : (LEVEL_LABELS[state.level] || 'Siêu khó');

    let stoneClass = 'big-stone ';
    let title = 'Lượt của bạn';
    let subtitle = 'Đặt quân vào một giao điểm bất kỳ';
    let meta = 'Bạn đi trước';

    if (state.gameOver) {
      if (state.winner === 0) {
        stoneClass += 'white';
        title = 'Hòa';
        subtitle = 'Bàn cờ đã kín mà chưa có ai nối được 5 quân.';
      } else if (botMode) {
        stoneClass += state.winner === 1 ? 'black' : 'white';
        title = `${playerName(state.winner)} thắng`;
        subtitle = 'Chuỗi 5 quân đã được nối thành công.';
      } else if (state.winner === state.human) {
        stoneClass += 'black';
        title = 'Bạn đã thắng!';
        subtitle = 'Chuỗi 5 quân đã được nối thành công.';
      } else {
        stoneClass += 'white';
        title = 'Máy đã thắng';
        subtitle = 'Thử chặn các mối đe dọa sớm hơn ở ván sau.';
      }
      meta = 'Ván đấu đã kết thúc';
    } else if (botMode && state.paused) {
      stoneClass += state.turn === 1 ? 'black' : 'white';
      title = 'Đã tạm dừng';
      subtitle = 'Hai bot đang chờ. Bấm “Tiếp tục” để đánh tiếp.';
      meta = 'Tối đa 30 giây / nước';
    } else if (state.hintLoading) {
      stoneClass += 'black';
      title = 'Đang tìm gợi ý';
      subtitle = 'Máy đang cân nhắc nước mạnh nhất cho bạn…';
      meta = 'Đang phân tích';
    } else if (state.thinking) {
      stoneClass += state.turn === 1 ? 'black' : 'white ai-turn';
      if (botMode) {
        title = `${playerName(state.turn)} đang suy nghĩ`;
        subtitle = 'Đang tính nước tối ưu, tối đa 30 giây…';
      } else {
        title = 'Máy đang suy nghĩ';
        subtitle = 'Đang tính toán nước đi tối ưu…';
      }
      const elapsed = Math.max(0, performance.now() - state.clockStarted);
      if (state.thinkLimit > 0) {
        const remain = Math.max(0, state.thinkLimit - elapsed);
        meta = `Đang tính · còn ${(remain / 1000).toFixed(1).replace('.', ',')} giây`;
      } else {
        meta = `Đang tính · ${(elapsed / 1000).toFixed(1).replace('.', ',')} giây`;
      }
    } else if (botMode) {
      stoneClass += state.turn === 1 ? 'black' : 'white';
      title = `Lượt ${playerName(state.turn)}`;
      subtitle = 'Bot chuẩn bị đặt quân…';
      meta = 'Tối đa 30 giây / nước';
    } else if (aiTurn) {
      stoneClass += 'white';
      title = 'Lượt của máy';
      subtitle = 'Máy chuẩn bị đặt quân…';
      meta = 'Máy chuẩn bị đi';
    } else if (humanTurn) {
      stoneClass += 'black';
      title = 'Lượt của bạn';
      subtitle = 'Đặt quân vào một giao điểm bất kỳ';
      if (state.lastAiStats) {
        meta = state.lastAiStats.source === 'opening'
          ? 'Máy đã đi · khai cuộc'
          : `Máy đã đi · ${formatSeconds(state.lastAiStats.elapsed)}`;
      } else if (state.history.length > 0) {
        meta = 'Lượt của bạn';
      } else {
        meta = state.first === 'ai' ? 'Máy đi trước' : 'Bạn đi trước';
      }
    }

    els.turnStone.className = stoneClass;
    els.turnTitle.textContent = title;
    els.turnSubtitle.textContent = subtitle;
    els.thinkMeta.textContent = meta;
    els.moveCounter.textContent = String(state.gameOver ? state.history.length : Math.min(state.history.length + 1, NN));

    els.hintBtn.hidden = botMode;
    els.pauseBtn.hidden = !botMode;
    els.pauseBtn.disabled = !botMode || state.gameOver;
    els.pauseBtn.classList.toggle('is-paused', botMode && state.paused);
    els.pauseIcon.textContent = state.paused ? '▶' : '⏸';
    els.pauseLabel.textContent = state.paused ? 'Tiếp tục' : 'Tạm dừng';
    els.hintBtn.disabled = botMode || !humanTurn || state.thinking || state.hintLoading || state.gameOver;
    els.undoBtn.disabled = botMode || !state.history.some((m) => m.player === state.human);
    syncZoomButtons();

    els.difficultyField.hidden = botMode;
    els.botConfig.hidden = !botMode;
    els.difficultyBadge.textContent = botMode ? 'SIÊU KHÓ ×2' : (LEVEL_LABELS[state.level] || 'Siêu khó').toUpperCase();
    els.settingsNote.textContent = botMode
      ? 'Hai bot đều ở mức Siêu khó. Mỗi nước suy nghĩ tối đa 30 giây.'
      : 'Thay đổi thiết lập sẽ bắt đầu một ván mới.';
    updateThinkLimitUI();
    syncSegments();
    syncSoundUI();
  }

  function renderHistory() {
    const list = els.historyList;
    list.replaceChildren();
    if (!state.history.length) {
      const p = document.createElement('p');
      p.className = 'empty-note';
      p.textContent = 'Các nước đi sẽ xuất hiện ở đây.';
      list.appendChild(p);
      els.historyCount.textContent = '0 nước';
      return;
    }

    const visible = state.history.slice(-80);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < visible.length; i++) {
      const m = visible[i];
      const item = document.createElement('div');
      item.className = 'history-item' + (i === visible.length - 1 ? ' latest' : '');
      const no = document.createElement('span');
      no.className = 'move-no';
      no.textContent = String(m.no);
      const stone = document.createElement('span');
      stone.className = 'mini-stone ' + (m.player === 1 ? 'black' : 'white');
      const coord = document.createElement('span');
      coord.className = 'move-coord';
      coord.textContent = m.coord;
      const who = document.createElement('span');
      who.className = 'move-who';
      who.textContent = playerName(m.player);
      item.append(no, stone, coord, who);

      if (isBotControlled(m.player) && m.stats) {
        let tagText = '';
        if (m.stats.source === 'vcf') tagText = 'VCF';
        else if (m.stats.source === 'block') tagText = 'CHẶN';
        else if (m.stats.source === 'win') tagText = 'THẮNG';
        if (tagText) {
          const tag = document.createElement('span');
          tag.className = 'move-tag';
          tag.textContent = tagText;
          item.appendChild(tag);
        }
        item.title = `${playerName(m.player)}: ${m.stats.source || 'search'} · ${m.stats.nodes || 0} nút · ${m.stats.elapsed || 0} ms`;
      }
      frag.appendChild(item);
    }
    list.appendChild(frag);
    els.historyCount.textContent = `${state.history.length} nước`;
    requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
  }

  function showResult() {
    const botMode = isBotMode();
    const won = !botMode && state.winner === state.human;
    const lost = !botMode && state.winner === state.ai;
    els.resultCard.classList.toggle('lose', lost);
    els.resultCard.classList.toggle('draw', state.winner === 0);
    if (state.winner === 0) {
      els.resultKicker.textContent = 'HÒA CỜ';
      els.resultTitle.textContent = 'Bàn cờ đã kín';
      els.resultText.textContent = 'Không bên nào nối được 5 quân. Một ván đấu cân bằng đến nước cuối cùng.';
    } else if (botMode) {
      els.resultKicker.textContent = `${playerName(state.winner).toUpperCase()} THẮNG`;
      els.resultTitle.textContent = `${playerName(state.winner)} thắng`;
      els.resultText.textContent = `${playerName(state.winner)} đã nối được 5 quân sau ${state.history.length} nước. Cả hai bot đều ở mức Siêu khó, tối đa 30 giây mỗi nước.`;
    } else if (won) {
      els.resultKicker.textContent = 'CHIẾN THẮNG';
      els.resultTitle.textContent = 'Bạn đã thắng!';
      els.resultText.textContent = `Bạn đã nối được 5 quân sau ${state.history.length} nước trước máy ở độ khó ${LEVEL_LABELS[state.level]}. Một kết quả rất đáng nể.`;
    } else if (lost) {
      els.resultKicker.textContent = 'VÁN ĐẤU KẾT THÚC';
      els.resultTitle.textContent = 'Máy đã thắng';
      els.resultText.textContent = 'Máy đã nối được 5 quân trước bạn. Hãy thử chặn các mối đe dọa sớm hơn và tận dụng lợi thế đi trước.';
    }
    els.resultOverlay.hidden = false;
    state.resultDismissed = false;
  }

  function syncSegments() {
    const modeButtons = els.modeGroup.querySelectorAll('button[data-mode]');
    modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
    const levelButtons = els.difficultyGroup.querySelectorAll('button[data-level]');
    levelButtons.forEach((b) => b.classList.toggle('active', b.dataset.level === state.level));
    const firstButtons = els.firstGroup.querySelectorAll('button[data-first]');
    firstButtons.forEach((b) => b.classList.toggle('active', b.dataset.first === state.first));
    const botMode = isBotMode();
    els.firstLabel.textContent = botMode ? 'Bot nào đi trước?' : 'Ai đi trước?';
    els.firstHumanBtn.textContent = botMode ? 'Bot Đen' : 'Bạn (Đen)';
    els.firstAiBtn.textContent = botMode ? 'Bot Trắng' : 'Máy (Trắng)';
  }

  function syncSoundUI() {
    els.soundOnIcon.hidden = !state.sound;
    els.soundOffIcon.hidden = state.sound;
    els.soundBtn.classList.toggle('sound-off', !state.sound);
    els.soundBtn.title = state.sound ? 'Tắt âm thanh' : 'Bật âm thanh';
    els.soundBtn.setAttribute('aria-label', state.sound ? 'Tắt âm thanh' : 'Bật âm thanh');
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      els.toast.classList.remove('show');
      state.toastTimer = null;
    }, 2800);
  }

  // -------------------------------------------------------------------
  // Âm thanh
  // -------------------------------------------------------------------
  function ensureAudio() {
    if (!state.sound) return null;
    try {
      if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        audioCtx = new Ctx();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
      return audioCtx;
    } catch (_) {
      return null;
    }
  }

  function playTone(freq, dur, type, gain, offset, endFreq) {
    if (!state.sound) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    try {
      const t = ctx.currentTime + (offset || 0);
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), t + dur);
      vol.gain.setValueAtTime(0.0001, t);
      vol.gain.exponentialRampToValueAtTime(gain || 0.03, t + 0.01);
      vol.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(vol);
      vol.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch (_) { /* bỏ qua */ }
  }

  function playPlaceSound(player) {
    if (!state.sound) return;
    const base = player === 1 ? 180 : 252;
    playTone(base, 0.075, 'triangle', 0.028, 0, base * 0.72);
    playTone(base * 2.02, 0.032, 'sine', 0.012, 0.008, base * 1.4);
  }

  function playEndSound(humanWon) {
    if (!state.sound) return;
    if (humanWon) {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => playTone(f, 0.32, 'sine', 0.032, i * 0.09));
    } else {
      const notes = [329.63, 293.66, 246.94, 196];
      notes.forEach((f, i) => playTone(f, 0.34, 'triangle', 0.024, i * 0.12));
    }
  }

  // -------------------------------------------------------------------
  // Modal & sự kiện
  // -------------------------------------------------------------------
  function openRules() {
    rulesOpener = document.activeElement;
    els.rulesModal.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => els.rulesCloseBtn.focus(), 30);
  }

  function closeRules() {
    els.rulesModal.hidden = true;
    document.body.style.overflow = '';
    if (rulesOpener && typeof rulesOpener.focus === 'function') rulesOpener.focus();
    rulesOpener = null;
  }

  function bindEvents() {
    bindCanvasEvents();

    els.newGameBtn.addEventListener('click', () => {
      ensureAudio();
      resetGame();
    });
    els.playAgainBtn.addEventListener('click', () => {
      ensureAudio();
      resetGame();
    });
    els.reviewBtn.addEventListener('click', () => {
      els.resultOverlay.hidden = true;
      state.resultDismissed = true;
      showToast('Đang xem lại bàn cờ. Bấm “Ván mới” khi bạn sẵn sàng.');
      requestDraw();
    });
    els.undoBtn.addEventListener('click', () => {
      ensureAudio();
      undoMove();
    });
    els.hintBtn.addEventListener('click', requestHint);
    els.pauseBtn.addEventListener('click', () => {
      ensureAudio();
      togglePause();
    });

    els.modeGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-mode]');
      if (!btn || (btn.dataset.mode !== 'pve' && btn.dataset.mode !== 'bot') || state.mode === btn.dataset.mode) return;
      state.mode = btn.dataset.mode;
      saveSettings();
      ensureAudio();
      resetGame();
      if (isBotMode()) {
        showToast('Máy vs Máy: hai bot Siêu khó tự đấu, tối đa 30 giây mỗi nước.');
      }
    });

    els.difficultyGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-level]');
      if (!btn || !LEVEL_LABELS[btn.dataset.level] || state.level === btn.dataset.level) return;
      state.level = btn.dataset.level;
      saveSettings();
      ensureAudio();
      resetGame();
    });

    els.firstGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-first]');
      if (!btn || state.first === btn.dataset.first) return;
      state.first = btn.dataset.first;
      saveSettings();
      ensureAudio();
      resetGame();
    });

    els.soundBtn.addEventListener('click', () => {
      state.sound = !state.sound;
      saveSettings();
      syncSoundUI();
      if (state.sound) {
        ensureAudio();
        playTone(440, 0.09, 'sine', 0.025);
      }
    });

    els.zoomInBtn.addEventListener('click', () => zoomBy(1.28));
    els.zoomOutBtn.addEventListener('click', () => zoomBy(1 / 1.28));
    els.zoomFitBtn.addEventListener('click', fitView);

    els.rulesBtn.addEventListener('click', openRules);
    els.rulesCloseBtn.addEventListener('click', closeRules);
    els.rulesPlayBtn.addEventListener('click', closeRules);
    els.rulesModal.addEventListener('click', (e) => {
      if (e.target === els.rulesModal) closeRules();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!els.rulesModal.hidden) {
          closeRules();
          return;
        }
        if (!els.resultOverlay.hidden) {
          els.resultOverlay.hidden = true;
          state.resultDismissed = true;
          requestDraw();
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undoMove();
      }
    });

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(scheduleResize);
      ro.observe(els.canvas);
    } else {
      window.addEventListener('resize', scheduleResize);
    }
    window.addEventListener('orientationchange', () => setTimeout(scheduleResize, 250));
  }

  init();
})();

