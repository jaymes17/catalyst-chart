/* ================================================================
   CatalystChart - Stock Catalyst Chart Generator
   v3 - Clickable catalysts, no-overlap layout, clean design
   ================================================================ */

// ========================
// CONFIGURATION
// ========================
const COLORS = {
  background: '#0b1018',
  gridLine: 'rgba(30, 41, 59, 0.5)',
  bullish: '#10b981',
  bearish: '#ef4444',
  bullishArea: '16, 185, 129',
  bearishArea: '239, 68, 68',
  positive: '#10b981',
  negative: '#ef4444',
  textPrimary: '#e2e8f0',
  textSecondary: '#94a3b8',
  textMuted: '#475569',
  athLine: 'rgba(245, 158, 11, 0.4)',
};

const MA_PERIOD = 10;
const MAX_CATALYSTS = 5;

const PROXY_URLS = [
  (url) => `/api/proxy?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

// ========================
// STATE
// ========================
let state = {
  ticker: '',
  range: '5Y',
  data: [],
  meta: null,
  events: null,
  catalysts: [],
  metrics: null,
  ma: [],
  chart: null,
  loading: false,
  catalystsVisible: true,
};

// ========================
// DOM ELEMENTS
// ========================
const $ = (sel) => document.querySelector(sel);
const tickerInput = () => $('#ticker-input');
const searchBtn = () => $('#search-btn');
const chartCanvas = () => $('#chart-canvas');
const companyName = () => $('#company-name');
const chartSubtitle = () => $('#chart-subtitle');
const metricsPanel = () => $('#metrics-panel');
const loadingOverlay = () => $('#loading');
const errorToast = () => $('#error-toast');
const errorMessage = () => $('#error-message');
const generatedDate = () => $('#generated-date');
const catalystContainer = () => $('#catalyst-overlays');
const resetZoomBtn = () => $('#reset-zoom-btn');
const catalystTimeline = () => $('#catalyst-timeline');
const timelineList = () => $('#timeline-list');

// ========================
// UTILITY FUNCTIONS
// ========================
function formatPrice(price) {
  if (price == null) return '--';
  if (price >= 1000) return '$' + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return '$' + price.toFixed(2);
  return '$' + price.toFixed(4);
}

function formatPercent(pct) {
  if (pct == null) return '--';
  return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
}

function formatLargeNumber(num) {
  if (num == null) return '--';
  if (num >= 1e12) return '$' + (num / 1e12).toFixed(2) + 'T';
  if (num >= 1e9) return '$' + (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return '$' + (num / 1e6).toFixed(2) + 'M';
  return '$' + num.toLocaleString();
}

function formatVolume(num) {
  if (num == null) return '--';
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toString();
}

function formatDateShort(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function getQuarter(date) {
  return Math.ceil((date.getMonth() + 1) / 3);
}

function getFiscalQuarterLabel(date) {
  return `Q${getQuarter(date)} FY${date.getFullYear()}`;
}

// ========================
// MOVING AVERAGE
// ========================
function calculateMA(data, period) {
  const ma = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      ma.push(data[i].close);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += data[j].close;
      ma.push(sum / period);
    }
  }
  return ma;
}

// ========================
// DATA FETCHING
// ========================
async function fetchWithProxy(url) {
  for (const makeProxy of PROXY_URLS) {
    try {
      const proxyUrl = makeProxy(url);
      const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
      if (!resp.ok) continue;
      return await resp.json();
    } catch (e) { continue; }
  }
  throw new Error('Unable to fetch data. All proxies failed.');
}

async function fetchTextWithProxy(url) {
  for (const makeProxy of PROXY_URLS) {
    try {
      const proxyUrl = makeProxy(url);
      const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) continue;
      return await resp.text();
    } catch (e) { continue; }
  }
  return null;
}

async function fetchStockData(ticker, range) {
  const rangeMap = { '1Y': '1y', '2Y': '2y', '5Y': '5y', 'MAX': 'max' };
  const intervalMap = { '1Y': '1d', '2Y': '1d', '5Y': '1wk', 'MAX': '1wk' };
  const yahooRange = rangeMap[range] || '5y';
  const interval = intervalMap[range] || '1wk';

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${yahooRange}&interval=${interval}&includePrePost=false&events=div%7Csplit%7Cearn`;
  const json = await fetchWithProxy(url);

  if (!json.chart?.result?.length) {
    throw new Error(`No data found for "${ticker}". Check the symbol and try again.`);
  }

  const result = json.chart.result[0];
  const timestamps = result.timestamp;
  const quotes = result.indicators.quote[0];

  if (!timestamps?.length) throw new Error(`No price history for "${ticker}".`);

  const data = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (quotes.close[i] != null) {
      data.push({
        date: new Date(timestamps[i] * 1000),
        timestamp: timestamps[i],
        open: quotes.open[i], high: quotes.high[i],
        low: quotes.low[i], close: quotes.close[i],
        volume: quotes.volume[i],
      });
    }
  }

  return { data, meta: result.meta, events: result.events || {} };
}

// ========================
// NEWS FETCHING
// ========================
async function fetchNewsHeadline(ticker, date) {
  try {
    const month = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(ticker + ' stock ' + month)}&hl=en-US&gl=US&ceid=US:en`;
    const text = await fetchTextWithProxy(url);
    if (!text) return null;
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    const items = doc.querySelectorAll('item');
    const companyFirst = state.metrics?.companyName?.split(' ')[0]?.toUpperCase();

    for (const item of items) {
      const title = item.querySelector('title')?.textContent || '';
      if (title.toUpperCase().includes(ticker.toUpperCase()) ||
          (companyFirst && title.toUpperCase().includes(companyFirst))) {
        const cleaned = title.replace(/\s*[-–]\s*[^-–]+$/, '').trim();
        return cleaned.length > 80 ? cleaned.substring(0, 77) + '...' : cleaned;
      }
    }
    if (items.length > 0) {
      const t = items[0].querySelector('title')?.textContent || '';
      const c = t.replace(/\s*[-–]\s*[^-–]+$/, '').trim();
      return c.length > 80 ? c.substring(0, 77) + '...' : c;
    }
  } catch (e) { /* best-effort */ }
  return null;
}

// ========================
// CATALYST DETECTION + ENRICHMENT
// ========================
function findNearestEvent(eventMap, targetDate, maxDays) {
  if (!eventMap) return null;
  const t = targetDate.getTime();
  for (const [ts, ev] of Object.entries(eventMap)) {
    if (Math.abs(t - Number(ts) * 1000) / 864e5 <= maxDays) return { ...ev, date: new Date(Number(ts) * 1000) };
  }
  return null;
}

function detectCatalysts(data) {
  if (data.length < 10) return [];

  const withReturns = data.map((d, i) => {
    // 2-session combined return: from close before catalyst through close after next session
    const prev = i > 0 ? data[i - 1].close : d.close;
    const next = i < data.length - 1 ? data[i + 1].close : d.close;
    return {
      ...d, idx: i,
      pctChange: i === 0 ? 0 : ((next - prev) / prev) * 100,
    };
  });

  const sorted = [...withReturns]
    .filter(d => Math.abs(d.pctChange) > 2)
    .sort((a, b) => Math.abs(b.pctChange) - Math.abs(a.pctChange));

  const minSpacing = Math.max(4, Math.floor(data.length / 25));
  const selected = [];

  for (const item of sorted) {
    if (selected.length >= MAX_CATALYSTS) break;
    if (!selected.some(s => Math.abs(s.idx - item.idx) < minSpacing)) {
      selected.push(item);
    }
  }

  return selected.sort((a, b) => a.idx - b.idx);
}

async function enrichCatalysts(catalysts, events, data) {
  const enriched = [];
  const newsPromises = [];

  for (const c of catalysts) {
    const daysTol = (state.range === '1Y' || state.range === '2Y') ? 5 : 10;

    // Earnings
    const earning = findNearestEvent(events.earnings, c.date, daysTol);
    if (earning) {
      const beat = earning.epsActual > earning.epsEstimate;
      const hasEps = earning.epsActual != null && earning.epsEstimate != null;
      enriched.push({
        idx: c.idx, date: c.date, close: c.close, pctChange: c.pctChange,
        title: `${getFiscalQuarterLabel(c.date)} Earnings ${beat ? 'Beat' : 'Miss'}`,
        description: hasEps ? `EPS: $${earning.epsActual.toFixed(2)} vs $${earning.epsEstimate.toFixed(2)} est.` : '',
        url: `https://www.google.com/search?q=${encodeURIComponent(state.ticker + ' earnings ' + getFiscalQuarterLabel(c.date))}`,
      });
      continue;
    }

    // Splits
    const split = findNearestEvent(events.splits, c.date, daysTol);
    if (split) {
      enriched.push({
        idx: c.idx, date: c.date, close: c.close, pctChange: c.pctChange,
        title: `${split.numerator}:${split.denominator} Stock Split`,
        description: formatDateShort(c.date),
        url: `https://www.google.com/search?q=${encodeURIComponent(state.ticker + ' stock split ' + c.date.getFullYear())}`,
      });
      continue;
    }

    // Dividends
    const div = findNearestEvent(events.dividends, c.date, daysTol);
    if (div) {
      enriched.push({
        idx: c.idx, date: c.date, close: c.close, pctChange: c.pctChange,
        title: `Dividend: $${div.amount.toFixed(2)}/share`,
        description: c.pctChange > 0 ? 'Ex-dividend rally' : 'Ex-dividend adjustment',
        url: `https://www.google.com/search?q=${encodeURIComponent(state.ticker + ' dividend ' + c.date.getFullYear())}`,
      });
      continue;
    }

    // Queue news lookup for non-event catalysts
    const idx = enriched.length;
    enriched.push({
      idx: c.idx, date: c.date, close: c.close, pctChange: c.pctChange,
      title: '', description: '', url: '',
    });

    newsPromises.push(
      fetchNewsHeadline(state.ticker, c.date).then(headline => {
        if (headline) {
          enriched[idx].title = headline;
          enriched[idx].description = formatDateShort(c.date);
          enriched[idx].url = `https://www.google.com/search?q=${encodeURIComponent(headline + ' ' + state.ticker)}`;
        } else {
          Object.assign(enriched[idx], buildSmartLabel(enriched[idx], data));
        }
      }).catch(() => {
        Object.assign(enriched[idx], buildSmartLabel(enriched[idx], data));
      })
    );
  }

  await Promise.allSettled(newsPromises);

  // Fallback for any still-empty
  for (let i = 0; i < enriched.length; i++) {
    if (!enriched[i].title) Object.assign(enriched[i], buildSmartLabel(enriched[i], data));
  }

  return enriched;
}

function buildSmartLabel(c, data) {
  const prices = data.map(d => d.close);
  const maxP = Math.max(...prices), minP = Math.min(...prices);
  const pct = c.pctChange;
  const dateStr = c.date.getFullYear();
  const baseUrl = `https://www.google.com/search?q=${encodeURIComponent(state.ticker + ' stock news ' + formatDateShort(c.date))}`;

  if (c.close >= maxP * 0.97 && pct > 0)
    return { title: 'All-Time High Breakout', description: formatPrice(c.close), url: baseUrl };
  if (c.close <= minP * 1.03)
    return { title: 'Multi-Year Low', description: formatPrice(c.close), url: baseUrl };
  if (Math.abs(pct) > 15)
    return { title: pct > 0 ? 'Major Rally' : 'Sharp Sell-Off', description: `${formatPercent(pct)} move`, url: baseUrl };
  if (Math.abs(pct) > 8)
    return { title: pct > 0 ? 'Strong Breakout' : 'Significant Drop', description: `${formatPercent(pct)} move`, url: baseUrl };
  return { title: pct > 0 ? 'Notable Rally' : 'Notable Decline', description: formatDateShort(c.date), url: baseUrl };
}

// ========================
// UPCOMING CATALYST
// ========================
function estimateNextEarnings() {
  // Most US companies report earnings quarterly in these windows:
  // Late Jan/Feb (Q4), Late Apr/May (Q1), Late Jul/Aug (Q2), Late Oct/Nov (Q3)
  const reportMonths = [1, 4, 7, 10]; // Feb, May, Aug, Nov (0-indexed)
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentDay = now.getDate();

  for (const m of reportMonths) {
    const candidate = new Date(now.getFullYear(), m, 20);
    if (candidate > now) return candidate;
  }
  // Wrap to next year's first window
  return new Date(now.getFullYear() + 1, reportMonths[0], 20);
}

function renderUpcomingCatalyst() {
  const el = document.getElementById('upcoming-catalyst');
  if (!el) return;

  const earningsDate = estimateNextEarnings();
  const now = new Date();
  const diffDays = Math.ceil((earningsDate - now) / 864e5);
  if (diffDays > 120) { el.classList.add('hidden'); return; }

  const windowStart = new Date(earningsDate);
  windowStart.setDate(windowStart.getDate() - 15);
  const startStr = windowStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endStr = earningsDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const quarter = ['Q4', 'Q1', 'Q2', 'Q3'][Math.floor(earningsDate.getMonth() / 3)];
  const detail = `${quarter} Earnings Window: ${startStr} - ${endStr}`;

  document.getElementById('upcoming-detail').textContent = detail;
  const countdown = diffDays <= 0 ? 'Now' : diffDays === 1 ? 'Tomorrow' : `~${diffDays} days`;
  document.getElementById('upcoming-countdown').textContent = countdown;
  el.classList.remove('hidden');
}

// ========================
// METRICS
// ========================
function calculateMetrics(data, meta, range) {
  const prices = data.map(d => d.close);
  const currentPrice = prices[prices.length - 1];
  const startPrice = prices[0];
  const periodReturn = ((currentPrice - startPrice) / startPrice) * 100;

  const ytdStart = data.find(d => d.date.getFullYear() === new Date().getFullYear());
  const ytdReturn = ytdStart ? ((currentPrice - ytdStart.close) / ytdStart.close) * 100 : null;

  const highs = data.map(d => d.high).filter(Boolean);
  const ath = Math.max(...highs);
  const last52 = data.slice(-Math.min(52, data.length));
  const volumes = data.map(d => d.volume).filter(Boolean);

  return {
    currentPrice, periodReturn,
    periodLabel: { '1Y': '1Y', '2Y': '2Y', '5Y': '5Y', 'MAX': 'All-Time' }[range] || range,
    ytdReturn, ath, fromATH: ((currentPrice - ath) / ath) * 100,
    high52: Math.max(...last52.map(d => d.high).filter(Boolean)),
    low52: Math.min(...last52.map(d => d.low).filter(Boolean)),
    avgVolume: volumes.length ? volumes.reduce((a, b) => a + b, 0) / volumes.length : null,
    marketCap: meta?.marketCap || null,
    companyName: meta?.shortName || meta?.longName || meta?.symbol || state.ticker,
    currency: meta?.currency || 'USD',
  };
}

// ========================
// CHART PLUGINS
// ========================

// Colored area fill
const areaFillPlugin = {
  id: 'areaFill',
  beforeDatasetsDraw(chart) {
    const ctx = chart.ctx;
    const meta = chart.getDatasetMeta(0);
    const chartArea = chart.chartArea;
    if (!meta.data || meta.data.length < 2 || !state.ma.length) return;

    ctx.save();
    for (let i = 0; i < meta.data.length - 1; i++) {
      const p0 = meta.data[i], p1 = meta.data[i + 1];
      const isBull = state.data[Math.min(i + 1, state.data.length - 1)].close >= state.ma[Math.min(i + 1, state.ma.length - 1)];
      const rgb = isBull ? COLORS.bullishArea : COLORS.bearishArea;
      const grad = ctx.createLinearGradient(0, Math.min(p0.y, p1.y), 0, chartArea.bottom);
      grad.addColorStop(0, `rgba(${rgb}, 0.15)`);
      grad.addColorStop(0.6, `rgba(${rgb}, 0.04)`);
      grad.addColorStop(1, `rgba(${rgb}, 0)`);
      ctx.beginPath();
      ctx.moveTo(p0.x, chartArea.bottom);
      ctx.lineTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p1.x, chartArea.bottom);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }
    ctx.restore();
  }
};

// Connector lines from data points to label zone (dots + dashed lines)
const connectorPlugin = {
  id: 'connectorLines',
  afterDraw(chart) {
    if (!state.catalystsVisible) return;
    if (!state.catalysts?.length || !state._labelPositions?.length) return;
    const ctx = chart.ctx;
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;

    ctx.save();
    state._labelPositions.forEach((pos) => {
      const c = pos.catalyst;
      const dataX = xScale.getPixelForValue(c.idx);
      const dataY = yScale.getPixelForValue(c.close);
      const color = c.pctChange >= 0 ? COLORS.positive : COLORS.negative;

      // Dashed connector line
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(dataX, dataY - 5);
      ctx.lineTo(dataX, pos.bottom + 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // Dot at data point
      ctx.beginPath();
      ctx.arc(dataX, dataY, 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Subtle outer ring
      ctx.beginPath();
      ctx.arc(dataX, dataY, 7, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
    ctx.restore();
  }
};

// ATH line
const athLinePlugin = {
  id: 'athLine',
  afterDraw(chart) {
    if (!state.metrics) return;
    const ctx = chart.ctx;
    const yScale = chart.scales.y;
    const chartArea = chart.chartArea;
    const athY = yScale.getPixelForValue(state.metrics.ath);
    if (athY < chartArea.top || athY > chartArea.bottom) return;

    ctx.save();
    ctx.strokeStyle = COLORS.athLine;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(chartArea.left, athY);
    ctx.lineTo(chartArea.right, athY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '600 10px Inter';
    ctx.fillStyle = 'rgba(245, 158, 11, 0.7)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('ATH ' + formatPrice(state.metrics.ath), chartArea.right, athY - 4);
    ctx.restore();
  }
};

// ========================
// CATALYST OVERLAY (HTML)
// ========================
function layoutCatalystLabels(catalysts, chart) {
  const xScale = chart.scales.x;
  const yScale = chart.scales.y;
  const chartArea = chart.chartArea;
  const canvas = chart.canvas;
  const canvasRect = canvas.getBoundingClientRect();

  const LABEL_W = 240;
  const LABEL_H = 46;
  const V_GAP = 6;
  const H_GAP = 8;

  const placed = [];

  for (const c of catalysts) {
    const dataX = xScale.getPixelForValue(c.idx);
    const dataY = yScale.getPixelForValue(c.close);
    let labelX = dataX - LABEL_W / 2;

    // Clamp horizontally within chart area
    labelX = Math.max(chartArea.left, Math.min(labelX, chartArea.right - LABEL_W));

    // Try vertical tiers from top
    let labelY = null;
    for (let tier = 0; tier < 6; tier++) {
      const tryY = chartArea.top + 6 + tier * (LABEL_H + V_GAP);
      const collides = placed.some(p => {
        return !(labelX + LABEL_W + H_GAP < p.x || labelX > p.x + p.w + H_GAP ||
                 tryY + LABEL_H < p.y || tryY > p.y + p.h);
      });
      if (!collides && tryY + LABEL_H < dataY - 15) {
        labelY = tryY;
        break;
      }
    }

    if (labelY === null) labelY = chartArea.top + 6;

    placed.push({
      x: labelX, y: labelY, w: LABEL_W, h: LABEL_H,
      bottom: labelY + LABEL_H,
      catalyst: c, dataX, dataY,
    });
  }

  return placed;
}

function renderCatalystOverlays(positions) {
  const container = catalystContainer();
  container.innerHTML = '';

  positions.forEach((pos, i) => {
    const c = pos.catalyst;
    const isPos = c.pctChange >= 0;

    // Hide labels outside visible range when zoomed
    if (state.chart) {
      const xScale = state.chart.scales.x;
      if (c.idx < xScale.min - 1 || c.idx > xScale.max + 1) return;
    }

    const label = document.createElement('a');
    label.className = `catalyst-label ${isPos ? 'positive' : 'negative'}`;
    label.href = c.url || '#';
    label.target = '_blank';
    label.rel = 'noopener noreferrer';
    label.dataset.catalystIdx = String(c.idx);
    label.style.left = pos.x + 'px';
    label.style.top = pos.y + 'px';

    label.innerHTML = `
      <div class="catalyst-content">
        <div class="catalyst-title">${escapeHtml(c.title)}</div>
        <div class="catalyst-desc">${escapeHtml(c.description || '')}</div>
      </div>
      <span class="catalyst-pct ${isPos ? 'positive' : 'negative'}">${formatPercent(c.pctChange)}*</span>
      <span class="catalyst-link-icon">&#8599;</span>
    `;

    // Cross-highlight: chart label -> timeline item
    label.addEventListener('mouseenter', () => {
      const item = document.querySelector(`.timeline-item[data-catalyst-idx="${c.idx}"]`);
      if (item) {
        item.classList.add('highlighted');
        item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
    label.addEventListener('mouseleave', () => {
      const item = document.querySelector(`.timeline-item[data-catalyst-idx="${c.idx}"]`);
      if (item) item.classList.remove('highlighted');
    });

    container.appendChild(label);
  });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function positionCatalystOverlays() {
  if (!state.chart || !state.catalysts.length) return;
  const positions = layoutCatalystLabels(state.catalysts, state.chart);
  state._labelPositions = positions;
  if (state.catalystsVisible) {
    renderCatalystOverlays(positions);
  } else {
    catalystContainer().innerHTML = '';
  }
}

// ========================
// CATALYST TIMELINE LIST
// ========================
function renderCatalystTimeline() {
  const container = timelineList();
  const timeline = catalystTimeline();
  if (!container || !timeline) return;

  if (!state.catalysts.length) {
    timeline.classList.add('hidden');
    return;
  }

  // Sort newest first (reverse chronological)
  const sorted = [...state.catalysts].sort((a, b) => b.idx - a.idx);

  container.innerHTML = '';
  sorted.forEach(c => {
    const isPos = c.pctChange >= 0;
    const item = document.createElement('a');
    item.className = 'timeline-item';
    item.href = c.url || '#';
    item.target = '_blank';
    item.rel = 'noopener noreferrer';
    item.dataset.catalystIdx = String(c.idx);

    item.innerHTML = `
      <span class="timeline-date">${c.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}</span>
      <div class="timeline-indicator ${isPos ? 'positive' : 'negative'}"></div>
      <div class="timeline-info">
        <div class="timeline-title">${escapeHtml(c.title)}</div>
        <div class="timeline-desc">${escapeHtml(c.description || '')}</div>
      </div>
      <span class="timeline-pct ${isPos ? 'positive' : 'negative'}">${formatPercent(c.pctChange)}*</span>
      <span class="timeline-link-icon">&#8599;</span>
    `;

    // Cross-highlight: timeline item -> chart label
    item.addEventListener('mouseenter', (e) => {
      const chartLabel = document.querySelector(`.catalyst-label[data-catalyst-idx="${c.idx}"]`);
      if (chartLabel) {
        chartLabel.classList.add('highlighted');
      }
    });
    item.addEventListener('mouseleave', () => {
      const chartLabel = document.querySelector(`.catalyst-label[data-catalyst-idx="${c.idx}"]`);
      if (chartLabel) chartLabel.classList.remove('highlighted');
    });

    container.appendChild(item);
  });

  timeline.classList.remove('hidden');
}

// ========================
// ZOOM / PAN HELPERS
// ========================
function autoScaleYAxis(chart) {
  const xScale = chart.scales.x;
  const visMin = Math.max(0, Math.floor(xScale.min));
  const visMax = Math.min(state.data.length - 1, Math.ceil(xScale.max));
  const visibleData = state.data.slice(visMin, visMax + 1);
  if (!visibleData.length) return;

  const prices = visibleData.map(d => d.close);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = maxP - minP || 1;

  chart.options.scales.y.min = minP - range * 0.05;
  chart.options.scales.y.max = maxP + range * 0.08;
  chart.update('none');
}

function onZoomOrPan({ chart }) {
  setTimeout(positionCatalystOverlays, 0);
  updateResetZoomButton();
}

function updateResetZoomButton() {
  const btn = resetZoomBtn();
  if (!btn || !state.chart) return;
  const isZoomed = typeof state.chart.isZoomedOrPanned === 'function'
    ? state.chart.isZoomedOrPanned()
    : (state.chart.scales.x.min > 0.5 || state.chart.scales.x.max < state.data.length - 1.5);
  btn.classList.toggle('hidden', !isZoomed);
}

function handleResetZoom() {
  if (!state.chart) return;
  state.chart.resetZoom();
  // Restore original Y-axis bounds
  const prices = state.data.map(d => d.close);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice;
  state.chart.options.scales.y.min = undefined;
  state.chart.options.scales.y.max = undefined;
  state.chart.options.scales.y.suggestedMin = minPrice - priceRange * 0.05;
  state.chart.options.scales.y.suggestedMax = maxPrice + priceRange * 0.08;
  state.chart.update('none');
  setTimeout(positionCatalystOverlays, 0);
  updateResetZoomButton();
}

// ========================
// CHART CREATION
// ========================
function createChart(data) {
  const canvas = chartCanvas();
  const ctx = canvas.getContext('2d');

  if (state.chart) { state.chart.destroy(); state.chart = null; }
  Chart.register(areaFillPlugin, connectorPlugin, athLinePlugin);
  // chartjs-plugin-zoom auto-registers via CDN

  const chartData = data.map((d, i) => ({ x: i, y: d.close }));
  const prices = data.map(d => d.close);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice;
  const ma = state.ma;

  state.chart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        data: chartData,
        borderWidth: 2.5,
        pointRadius: 0,
        pointHitRadius: 8,
        pointHoverRadius: 5,
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
        tension: 0.05,
        fill: false,
        segment: {
          borderColor: (ctx) => {
            const idx = ctx.p1DataIndex;
            if (idx < ma.length && idx < data.length)
              return data[idx].close >= ma[idx] ? COLORS.bullish : COLORS.bearish;
            return COLORS.bullish;
          },
        },
        borderColor: COLORS.bullish,
        pointHoverBackgroundColor: COLORS.bullish,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 800, easing: 'easeOutQuart' },
      interaction: { mode: 'index', intersect: false },
      layout: {
        padding: { top: 180, right: 10, bottom: 5, left: 5 }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          backgroundColor: '#111827',
          titleColor: COLORS.textSecondary,
          bodyColor: COLORS.textPrimary,
          borderColor: '#1e293b',
          borderWidth: 1, padding: 12, cornerRadius: 8,
          titleFont: { family: 'Inter', size: 11, weight: '500' },
          bodyFont: { family: 'Inter', size: 14, weight: '700' },
          displayColors: false,
          callbacks: {
            title: (items) => data[items[0].parsed.x] ? formatDateShort(data[items[0].parsed.x].date) : '',
            label: (item) => formatPrice(item.parsed.y),
          }
        },
        zoom: {
          pan: {
            enabled: true,
            mode: 'xy',
            onPanComplete: onZoomOrPan,
          },
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: 'xy',
            onZoomComplete: onZoomOrPan,
          },
          limits: {
            x: { min: 0, max: data.length - 1, minRange: 10 },
            y: { min: 0, minRange: priceRange * 0.05 },
          },
        },
      },
      scales: {
        x: {
          type: 'linear', display: true,
          grid: { color: COLORS.gridLine, lineWidth: 1 },
          border: { display: false },
          ticks: {
            color: COLORS.textMuted,
            font: { family: 'Inter', size: 11, weight: '500' },
            maxTicksLimit: 8,
            callback: (val) => {
              const idx = Math.round(val);
              if (idx >= 0 && idx < data.length) {
                const d = data[idx].date;
                return state.range === '1Y'
                  ? d.toLocaleDateString('en-US', { month: 'short' })
                  : d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
              }
              return '';
            }
          },
          min: 0, max: data.length - 1,
        },
        y: {
          display: true, position: 'right',
          grid: { color: COLORS.gridLine, lineWidth: 1 },
          border: { display: false },
          ticks: {
            color: COLORS.textMuted,
            font: { family: 'Inter', size: 11, weight: '500' },
            maxTicksLimit: 7,
            callback: (val) => formatPrice(val),
          },
          suggestedMin: minPrice - priceRange * 0.05,
          suggestedMax: maxPrice + priceRange * 0.08,
        },
      },
    },
    plugins: [
      areaFillPlugin, connectorPlugin, athLinePlugin,
      { id: 'overlaySync', afterRender: () => setTimeout(positionCatalystOverlays, 0) },
    ],
  });

  // Also reposition on resize
  window.addEventListener('resize', () => {
    if (state.chart) setTimeout(positionCatalystOverlays, 50);
  });
}

// ========================
// METRICS PANEL
// ========================
function renderMetrics(metrics) {
  const pctClass = (v) => v == null ? '' : (v >= 0 ? 'positive' : 'negative');
  metricsPanel().innerHTML = `
    <div class="current-price-section">
      <div class="current-price-label">Current Price</div>
      <div class="current-price-value">${formatPrice(metrics.currentPrice)}</div>
      <div class="current-price-change ${pctClass(metrics.periodReturn)}">
        ${formatPercent(metrics.periodReturn)} (${metrics.periodLabel})
      </div>
    </div>
    <div class="metrics-section-title">Key Metrics</div>
    <div class="metric-row"><span class="metric-label">YTD Return</span><span class="metric-value ${pctClass(metrics.ytdReturn)}">${metrics.ytdReturn != null ? formatPercent(metrics.ytdReturn) : '--'}</span></div>
    <div class="metric-row"><span class="metric-label">All-Time High</span><span class="metric-value">${formatPrice(metrics.ath)}</span></div>
    <div class="metric-row"><span class="metric-label">From ATH</span><span class="metric-value ${pctClass(metrics.fromATH)}">${formatPercent(metrics.fromATH)}</span></div>
    <div class="metric-row"><span class="metric-label">52-Wk High</span><span class="metric-value">${formatPrice(metrics.high52)}</span></div>
    <div class="metric-row"><span class="metric-label">52-Wk Low</span><span class="metric-value">${formatPrice(metrics.low52)}</span></div>
    <div class="metric-row"><span class="metric-label">Avg Volume</span><span class="metric-value">${formatVolume(metrics.avgVolume)}</span></div>
    ${metrics.marketCap ? `<div class="metric-row"><span class="metric-label">Market Cap</span><span class="metric-value">${formatLargeNumber(metrics.marketCap)}</span></div>` : ''}
  `;
}

// ========================
// HEADER
// ========================
function updateHeader(metrics, range) {
  const labels = { '1Y': '1 YEAR', '2Y': '2 YEAR', '5Y': '5 YEAR', 'MAX': 'ALL-TIME' };
  companyName().textContent = `${metrics.companyName} (${state.ticker.toUpperCase()})`;
  chartSubtitle().textContent = `${labels[range] || range} PRICE HISTORY`;
  generatedDate().textContent = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// ========================
// EXPORT
// ========================
async function captureChartAsCanvas() {
  const card = document.getElementById('chart-card');
  const rect = card.getBoundingClientRect();
  const scale = 2;

  const offscreen = document.createElement('canvas');
  offscreen.width = rect.width * scale;
  offscreen.height = rect.height * scale;
  const ctx = offscreen.getContext('2d');
  ctx.scale(scale, scale);

  // Background
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, rect.width, rect.height);

  // Header
  ctx.fillStyle = COLORS.textPrimary;
  ctx.font = '700 22px Inter';
  ctx.textBaseline = 'top';
  ctx.fillText(companyName().textContent, 28, 24);
  ctx.fillStyle = COLORS.textMuted;
  ctx.font = '500 13px Inter';
  ctx.fillText(chartSubtitle().textContent, 28, 52);

  // Chart canvas
  const chartEl = chartCanvas();
  const chartRect = chartEl.getBoundingClientRect();
  ctx.drawImage(chartEl, chartRect.left - rect.left, chartRect.top - rect.top, chartRect.width, chartRect.height);

  // Draw catalyst labels on export canvas (static version of HTML overlays)
  if (state._labelPositions) {
    const chartOffset = { x: chartRect.left - rect.left, y: chartRect.top - rect.top };
    state._labelPositions.forEach(pos => {
      const c = pos.catalyst;
      const isPos = c.pctChange >= 0;
      const color = isPos ? COLORS.positive : COLORS.negative;
      const lx = pos.x + chartOffset.x;
      const ly = pos.y + chartOffset.y;
      const lw = pos.w;
      const lh = pos.h;

      // Box
      ctx.fillStyle = 'rgba(11, 16, 24, 0.94)';
      roundRect(ctx, lx, ly, lw, lh, 5);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.5;
      roundRect(ctx, lx, ly, lw, lh, 5);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Title
      ctx.font = '600 10px Inter';
      ctx.fillStyle = COLORS.textPrimary;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const maxTitleW = lw - 55;
      ctx.save();
      ctx.beginPath();
      ctx.rect(lx + 8, ly, maxTitleW, lh);
      ctx.clip();
      ctx.fillText(c.title, lx + 8, ly + lh / 2);
      ctx.restore();

      // Percentage
      ctx.font = '700 11px Inter';
      ctx.fillStyle = color;
      ctx.textAlign = 'right';
      ctx.fillText(formatPercent(c.pctChange) + '*', lx + lw - 8, ly + lh / 2);
    });
  }

  // Metrics panel
  const mEl = metricsPanel();
  const mRect = mEl.getBoundingClientRect();
  const mx = mRect.left - rect.left, my = mRect.top - rect.top, mw = mRect.width;
  ctx.fillStyle = 'rgba(17, 24, 39, 0.5)';
  roundRect(ctx, mx, my, mw, mRect.height, 8);
  ctx.fill();

  if (state.metrics) {
    let y = my + 16;
    const cx = mx + mw / 2;
    ctx.textAlign = 'center';
    ctx.font = '600 11px Inter'; ctx.fillStyle = COLORS.textMuted;
    ctx.fillText('Current Price', cx, y); y += 18;
    ctx.font = '700 28px Inter'; ctx.fillStyle = COLORS.textPrimary;
    ctx.fillText(formatPrice(state.metrics.currentPrice), cx, y); y += 22;
    ctx.font = '600 14px Inter';
    ctx.fillStyle = state.metrics.periodReturn >= 0 ? COLORS.positive : COLORS.negative;
    ctx.fillText(`${formatPercent(state.metrics.periodReturn)} (${state.metrics.periodLabel})`, cx, y); y += 36;

    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mx + 12, y); ctx.lineTo(mx + mw - 12, y); ctx.stroke(); y += 16;
    ctx.font = '600 11px Inter'; ctx.fillStyle = COLORS.textMuted;
    ctx.fillText('KEY METRICS', cx, y); y += 24;

    const rows = [
      ['YTD Return', formatPercent(state.metrics.ytdReturn), state.metrics.ytdReturn],
      ['All-Time High', formatPrice(state.metrics.ath), null],
      ['From ATH', formatPercent(state.metrics.fromATH), state.metrics.fromATH],
      ['52-Wk High', formatPrice(state.metrics.high52), null],
      ['52-Wk Low', formatPrice(state.metrics.low52), null],
      ['Avg Volume', formatVolume(state.metrics.avgVolume), null],
    ];
    rows.forEach(([label, value, pctVal]) => {
      ctx.font = '500 11px Inter'; ctx.fillStyle = COLORS.textSecondary; ctx.textAlign = 'left';
      ctx.fillText(label, mx + 12, y);
      ctx.font = '600 12px Inter';
      ctx.fillStyle = pctVal != null ? (pctVal >= 0 ? COLORS.positive : COLORS.negative) : COLORS.textPrimary;
      ctx.textAlign = 'right'; ctx.fillText(value, mx + mw - 12, y); y += 26;
    });
  }

  // Footnote
  const fy = rect.height - 30;
  ctx.font = 'italic 9px Inter'; ctx.fillStyle = COLORS.textMuted;
  ctx.textAlign = 'left';
  ctx.fillText('* % change reflects the combined price movement over the catalyst session and the following trading session.', 28, fy - 8);

  // Footer
  ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(28, fy); ctx.lineTo(rect.width - 28, fy); ctx.stroke();
  ctx.font = '600 11px Inter'; ctx.fillStyle = COLORS.textMuted;
  ctx.textAlign = 'left'; ctx.fillText('CatalystChart', 28, fy + 10);
  ctx.textAlign = 'right'; ctx.fillText(generatedDate().textContent, rect.width - 28, fy + 10);

  return offscreen;
}

async function copyToClipboard() {
  try {
    const canvas = await captureChartAsCanvas();
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    showCopyToast('Chart copied to clipboard!');
  } catch (err) {
    showError('Clipboard copy not supported. Downloading instead...');
    await downloadPNG();
  }
}

async function downloadPNG() {
  try {
    const canvas = await captureChartAsCanvas();
    const link = document.createElement('a');
    link.download = `${state.ticker.toUpperCase()}_chart_${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) { showError('Failed to export: ' + err.message); }
}

function showCopyToast(msg) {
  let t = document.querySelector('.copy-toast');
  if (!t) { t = document.createElement('div'); t.className = 'copy-toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

// ========================
// LOADING & ERROR
// ========================
function showLoading() { loadingOverlay().classList.remove('hidden'); state.loading = true; }
function hideLoading() { loadingOverlay().classList.add('hidden'); state.loading = false; }
function showError(msg) {
  errorMessage().textContent = msg;
  errorToast().classList.remove('hidden');
  setTimeout(() => errorToast().classList.add('hidden'), 6000);
}

// ========================
// CATALYST TOGGLE
// ========================
function toggleCatalysts() {
  state.catalystsVisible = !state.catalystsVisible;
  const btn = document.getElementById('toggle-catalysts-btn');
  if (btn) btn.classList.toggle('active', state.catalystsVisible);

  // Show/hide HTML overlays
  if (state.catalystsVisible) {
    positionCatalystOverlays();
  } else {
    catalystContainer().innerHTML = '';
  }

  // Redraw chart to show/hide connector lines
  if (state.chart) state.chart.update('none');
}

// ========================
// MAIN FLOW
// ========================
async function generateChart(ticker, range) {
  if (!ticker) { showError('Please enter a ticker symbol.'); return; }
  showLoading();

  try {
    const { data, meta, events } = await fetchStockData(ticker.toUpperCase(), range);
    if (data.length < 5) throw new Error(`Insufficient data for "${ticker}".`);

    state.ticker = ticker;
    state.range = range;
    state.data = data;
    state.meta = meta;
    state.events = events;
    state.ma = calculateMA(data, MA_PERIOD);

    const rawCatalysts = detectCatalysts(data);
    state.metrics = calculateMetrics(data, meta, range);
    state.catalysts = await enrichCatalysts(rawCatalysts, events, data);

    updateHeader(state.metrics, range);
    renderMetrics(state.metrics);

    await document.fonts.ready;
    createChart(data);
    renderCatalystTimeline();

    renderUpcomingCatalyst();

    // Show footnote
    const footnote = document.getElementById('chart-footnote');
    if (footnote) footnote.classList.remove('hidden');

    // Ensure catalyst toggle is on
    state.catalystsVisible = true;
    const toggleBtn = document.getElementById('toggle-catalysts-btn');
    if (toggleBtn) toggleBtn.classList.add('active');

    hideLoading();
  } catch (err) {
    hideLoading();
    showError(err.message || 'Failed to load chart data.');
    console.error(err);
  }
}

// ========================
// EVENT LISTENERS
// ========================
function initEventListeners() {
  searchBtn().addEventListener('click', () => generateChart(tickerInput().value.trim(), state.range));
  tickerInput().addEventListener('keydown', (e) => { if (e.key === 'Enter') generateChart(tickerInput().value.trim(), state.range); });
  document.querySelectorAll('.timeframe-buttons button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.timeframe-buttons button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.range = btn.dataset.range;
      if (state.ticker) generateChart(state.ticker, state.range);
    });
  });
  $('#copy-btn').addEventListener('click', copyToClipboard);
  $('#download-btn').addEventListener('click', downloadPNG);
  $('#error-close').addEventListener('click', () => errorToast().classList.add('hidden'));
  resetZoomBtn().addEventListener('click', handleResetZoom);
  document.getElementById('toggle-catalysts-btn').addEventListener('click', toggleCatalysts);
}

// ========================
// INIT
// ========================
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  tickerInput().focus();
  document.getElementById('toggle-catalysts-btn').classList.add('active');
});
