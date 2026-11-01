/**
 * DUDOANTX — Full Telegram Bot (VIP TX / Sicbo)
 * Bot-only UI · inline buttons style primary/success/danger
 * v2 — Sicbo deep analyzer + pattern memory + 24/7 keep-alive
 */
'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.WEB_BOT_TOKEN || '';
const ADMIN_IDS = String(process.env.TELEGRAM_ADMIN_IDS || process.env.ADMIN_IDS || '')
  .split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.WEB_URL || '').replace(/\/$/, '');
const LINK4M_TOKEN = process.env.LINK4M_TOKEN || process.env.LINK4M_API_TOKEN || '';
const POLL_MS = Number(process.env.POLL_MS || 5000);

const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

/* ───────── helpers ───────── */
function loadJSON(file, fallback) {
  try {
    const p = path.join(DATA, file);
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return fallback; }
}
function saveJSON(file, data) {
  fs.writeFileSync(path.join(DATA, file), JSON.stringify(data, null, 2));
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function nowVN() {
  return new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}
function isAdmin(id) {
  return ADMIN_IDS.includes(String(id));
}
function uidOf(from) {
  return String(from && from.id != null ? from.id : '');
}
function displayName(from) {
  if (!from) return 'User';
  return [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'User';
}
function randCode(n = 8) {
  return crypto.randomBytes(n).toString('hex').slice(0, n).toUpperCase();
}

async function tg(method, body, isForm) {
  if (!BOT_TOKEN) return null;
  const url = `${TG}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: isForm ? undefined : { 'Content-Type': 'application/json' },
    body: isForm ? body : JSON.stringify(body || {})
  });
  const j = await res.json().catch(() => null);
  if (!j || !j.ok) console.warn('TG', method, j && j.description);
  return j;
}
async function send(chatId, text, extra = {}) {
  return tg('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra
  });
}
async function edit(chatId, messageId, text, extra = {}) {
  return tg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra
  });
}
async function delMsg(chatId, messageId) {
  if (!messageId) return;
  return tg('deleteMessage', { chat_id: chatId, message_id: messageId });
}
async function answerCb(id, text) {
  return tg('answerCallbackQuery', { callback_query_id: id, text: text || '', show_alert: false });
}
async function sendPhoto(chatId, photoUrl, caption, extra = {}) {
  return tg('sendPhoto', {
    chat_id: chatId,
    photo: photoUrl,
    caption,
    parse_mode: 'HTML',
    ...extra
  });
}
async function sendDocument(chatId, filePath, caption) {
  if (!BOT_TOKEN) return null;
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption);
  const blob = new Blob([fs.readFileSync(filePath)], { type: 'text/plain' });
  form.append('document', blob, path.basename(filePath));
  const res = await fetch(`${TG}/sendDocument`, { method: 'POST', body: form });
  return res.json().catch(() => null);
}

/* ───────── config / store ───────── */
const DEFAULT_CFG = {
  supportUrl: 'https://t.me/SunNetWin',
  channelId: '',
  bankCode: '',
  bankAccount: '',
  bankAccountName: '',
  plans: [
    { id: 'p5', label: '5K · 30 giờ', price: 5000, durationHours: 30, active: true },
    { id: 'p10', label: '10K · 60 giờ', price: 10000, durationHours: 60, active: true },
    { id: 'p20', label: '20K · 100 giờ', price: 20000, durationHours: 100, active: true },
    { id: 'p50', label: '50K · 1 tuần', price: 50000, durationHours: 168, active: true }
  ],
  vault: {
    sunwin: { title: 'SUNWIN DEMO', desc: 'File demo Sunwin', fileId: '', fileUrl: '' },
    iwin: { title: 'IWIN DEMO', desc: 'File demo Iwin', fileId: '', fileUrl: '' },
    scr: { title: 'SCR AUTOBET LC79', desc: 'Script autobet LC79', fileId: '', fileUrl: '' }
  },
  freeKeyHours: 2,
  orderTtlMin: 15
};

let cfg = Object.assign({}, DEFAULT_CFG, loadJSON('config.json', {}));
if (!Array.isArray(cfg.plans) || !cfg.plans.length) cfg.plans = DEFAULT_CFG.plans.slice();
function saveCfg() { saveJSON('config.json', cfg); }

let users = loadJSON('users.json', {});
let keys = loadJSON('keys.json', {});
let codes = loadJSON('codes.json', {});
let orders = loadJSON('orders.json', {});
let pending = loadJSON('pending.json', {});
let sessions = {};
let predMsg = {};
let autoWatch = {};
let linkTrack = loadJSON('linktrack.json', {});

function saveUsers() { saveJSON('users.json', users); }
function saveKeys() { saveJSON('keys.json', keys); }
function saveCodes() { saveJSON('codes.json', codes); }
function saveOrders() { saveJSON('orders.json', orders); }
function savePending() { saveJSON('pending.json', pending); }
function saveTrack() { saveJSON('linktrack.json', linkTrack); }

function ensureUser(uid) {
  if (!users[uid]) users[uid] = { vipUntil: 0, md5: false, autobetUntil: 0, tx: [], devices: [] };
  return users[uid];
}
function isVip(uid) {
  if (isAdmin(uid)) return true;
  const u = ensureUser(uid);
  return Number(u.vipUntil || 0) > Date.now();
}
function vipText(uid) {
  if (isAdmin(uid)) return { active: true, line: '👑 VIP ADMIN · không giới hạn', expire: 'Vĩnh viễn' };
  const u = ensureUser(uid);
  if (Number(u.vipUntil || 0) > Date.now()) {
    return {
      active: true,
      line: '✅ Đang mở VIP',
      expire: new Date(u.vipUntil).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
    };
  }
  return { active: false, line: '🔒 Chưa mở VIP', expire: '—' };
}
function grantVip(uid, hours, note) {
  const u = ensureUser(uid);
  const base = Math.max(Date.now(), Number(u.vipUntil || 0));
  u.vipUntil = base + hours * 3600 * 1000;
  u.tx = u.tx || [];
  u.tx.unshift({ t: Date.now(), type: 'vip', note: note || `+${hours}h`, hours });
  if (u.tx.length > 50) u.tx.length = 50;
  saveUsers();
  return u.vipUntil;
}

/* ───────── games ───────── */
const DEFAULT_GAMES = [
  { id: 'sunwin_tx', brand: 'sunwin', brandLabel: 'SUNWIN', variant: 'TX', url: '', group: 'tx', enabled: false },
  { id: 'sicbo_sunwin', brand: 'sunwin', brandLabel: 'SUNWIN', variant: 'Sicbo', url: 'https://apitaixiu-6jjn.onrender.com/api/sicbo/sunwin', historyUrl: 'https://apitaixiu-6jjn.onrender.com/api/sicsun/history', group: 'sicbo', enabled: true },
  { id: 'hitclub_hu', brand: 'hitclub', brandLabel: 'HITCLUB', variant: 'TX', url: 'https://apihitclubhihi.onrender.com/api/hitclub/hu', group: 'tx', enabled: true },
  { id: 'hitclub_md5', brand: 'hitclub', brandLabel: 'HITCLUB', variant: 'MD5', url: 'https://apihitclubhihi.onrender.com/api/hitclub/md5', group: 'md5', enabled: true },
  { id: 'sicbo_hitclub', brand: 'hitclub', brandLabel: 'HITCLUB', variant: 'Sicbo', url: 'https://apitaixiu-6jjn.onrender.com/api/sicbo/hitclub', group: 'sicbo', enabled: true },
  { id: 'max789_tx', brand: 'max789', brandLabel: 'MAX789', variant: 'TX', url: 'https://apitaixiu-6jjn.onrender.com/max789/tx', group: 'tx', enabled: true },
  { id: 'max789_md5', brand: 'max789', brandLabel: 'MAX789', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/max789/md5', group: 'md5', enabled: true },
  { id: 'max789_kubet', brand: 'max789', brandLabel: 'MAX789', variant: 'Kubet Live', url: 'https://apitaixiu-6jjn.onrender.com/max789/kubet', group: 'tx', enabled: true },
  { id: 'lc79_tx', brand: 'lc79', brandLabel: 'LC79', variant: 'TX', url: 'https://apitaixiu-6jjn.onrender.com/lc79/tx', group: 'tx', enabled: true },
  { id: 'lc79_md5', brand: 'lc79', brandLabel: 'LC79', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/lc79/md5', group: 'md5', enabled: true },
  { id: 'betvip_tx', brand: 'betvip', brandLabel: 'BETVIP', variant: 'TX', url: 'https://apitaixiu-6jjn.onrender.com/betvip/tx', group: 'tx', enabled: true },
  { id: 'betvip_md5', brand: 'betvip', brandLabel: 'BETVIP', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/betvip/md5', group: 'md5', enabled: true },
  { id: 'b52_tx', brand: 'b52', brandLabel: 'B52', variant: 'TX', url: 'https://apitaixiu-6jjn.onrender.com/api/ditmemayb52', historyUrl: 'https://apitaixiu-6jjn.onrender.com/b52/history', group: 'tx', enabled: true },
  { id: 'sicbo_b52', brand: 'b52', brandLabel: 'B52', variant: 'Sicbo', url: 'https://sicbob52-9zn5.onrender.com/api/sicbo/b52', group: 'sicbo', enabled: true },
  { id: 'gb68_md5', brand: '68gb', brandLabel: '68GB', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/68gb/md5', group: 'md5', enabled: true, playUrl: 'https://68gbvip66.pro/?code=20224253' },
  { id: 'sicbo_789', brand: '789club', brandLabel: '789CLUB', variant: 'Sicbo', url: 'https://apitaixiu-6jjn.onrender.com/api/sicbo/789', group: 'sicbo', enabled: true, playUrl: 'https://play.789club.lease/?affId=28c5c38983fcb2757631cae1fbb21a73&utm_source=na&utm_campaign=seo&referrer_domain=789club86.com' },
  { id: 'luck8_tx', brand: 'luck8', brandLabel: 'LUCK8', variant: 'TX', url: 'https://apitaixiu-6jjn.onrender.com/luck8-hu', group: 'tx', enabled: true },
  { id: 'luck8_md5', brand: 'luck8', brandLabel: 'LUCK8', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/luck8-md5', group: 'md5', enabled: true },
  { id: 'xocdia88_tx', brand: 'xocdia88', brandLabel: 'XOCDIA88', variant: 'TX', url: 'https://apitaixiu-6jjn.onrender.com/xocdia88/tx', group: 'tx', enabled: true },
  { id: 'xocdia88_md5', brand: 'xocdia88', brandLabel: 'XOCDIA88', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/xocdia88/md5', group: 'md5', enabled: true },
  { id: 'sumclub_tx', brand: 'sumclub', brandLabel: 'SUMCLUB', variant: 'TX', url: 'https://apitaixiu-6jjn.onrender.com/sumclub/tx', group: 'tx', enabled: true },
  { id: 'sumclub_md5', brand: 'sumclub', brandLabel: 'SUMCLUB', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/sumclub/md5', group: 'md5', enabled: true }
];

let games = loadJSON('games.json', null);
if (!Array.isArray(games) || !games.length) games = DEFAULT_GAMES.map(g => ({ ...g }));
else {
  for (const d of DEFAULT_GAMES) {
    if (!games.some(g => g.id === d.id)) games.push({ ...d });
  }
}
function saveGames() { saveJSON('games.json', games); }

/* ───────── Sicbo Analyzer (deep dice stats) ───────── */
class SicboAnalyzer {
  constructor() { this.reset(); }
  reset() {
    this.dice = [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]];
    this.sums = {};
    this.triples = 0;
    this.pairs = 0;
    this.total = 0;
    this.recent = [];
    this.history_sum = [];
  }

  push(diceArr) {
    if (!Array.isArray(diceArr) || diceArr.length < 3) return false;
    const d = diceArr.slice(0, 3).map(x => {
      const n = Math.floor(Number(x));
      return (n >= 1 && n <= 6) ? n : 0;
    });
    if (d.some(x => !x)) return false;
    for (let i = 0; i < 3; i++) this.dice[i][d[i] - 1]++;
    const sum = d[0] + d[1] + d[2];
    this.sums[sum] = (this.sums[sum] || 0) + 1;
    const uniq = new Set(d);
    if (uniq.size === 1) this.triples++;
    else if (uniq.size === 2) this.pairs++;
    this.total++;
    this.recent.push({ d, s: sum });
    if (this.recent.length > 100) this.recent.shift();
    this.history_sum.push(sum);
    if (this.history_sum.length > 200) this.history_sum.shift();
    return true;
  }

  biasScore() {
    if (this.total < 30) return { chi: 0, biased: false, strength: 0 };
    const exp = this.total / 6;
    let chi = 0;
    for (const arr of this.dice)
      for (const c of arr) chi += ((c - exp) ** 2) / exp;
    const biased = chi > 25;
    const strength = biased ? Math.min(1, (chi - 25) / 75) : 0;
    return { chi: Math.round(chi * 10) / 10, biased, strength };
  }

  hotDice() {
    if (this.total < 20) return null;
    return this.dice.map(arr => arr.indexOf(Math.max(...arr)) + 1);
  }

  guessDice(side) {
    const pool = side === 'T' ? [11, 12, 13, 14, 15, 16, 17] : [4, 5, 6, 7, 8, 9, 10];
    const hot = this.hotDice() || [3, 4, 5];
    const cand = this.dice.map(arr =>
      arr.map((c, i) => ({ v: i + 1, c })).sort((a, b) => b.c - a.c).slice(0, 3).map(x => x.v)
    );
    const tries = [
      hot,
      [cand[0][0], cand[1][0], cand[2][0]],
      [cand[0][0], cand[1][0], cand[2][1]],
      [cand[0][0], cand[1][1], cand[2][0]],
      [cand[0][1], cand[1][0], cand[2][0]]
    ];
    for (const t of tries) {
      const s = t.reduce((a, b) => a + b, 0);
      if (pool.includes(s)) return t.sort((a, b) => a - b);
    }
    const freqInPool = pool.map(p => ({ p, c: this.sums[p] || 0 })).sort((a, b) => b.c - a.c);
    const target = freqInPool[0].p;
    for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) {
      const c = target - a - b;
      if (c >= b && c <= 6) return [a, b, c];
    }
    return hot;
  }

  confBoost() {
    const { biased, strength } = this.biasScore();
    return biased ? Math.round(strength * 8) : 0;
  }

  anomalyRate() {
    if (this.total < 20) return 0;
    return ((this.triples + this.pairs) / this.total) * 100;
  }
}

/* ───────── engine (anti 1-1 + anti bệt + pattern memory) ───────── */
class Engine {
  constructor(id) {
    this.id = id || '';
    this.history = [];
    this.sums = [];
    this.diceHist = [];
    this.correct = 0;
    this.total = 0;
    this.pending = null;
    this.pendingMeta = null;
    this.log = [];
    this.sicbo = new SicboAnalyzer();
    this.patternMemory = {};
    this.antiMemory = {};
  }
  push(side, sum, dice, session) {
    const s = side === 'T' || side === 'TAI' || side === 'Tài' || side === 'tai' ? 'T' : 'X';
    if (this.pending) {
      this.total++;
      const ok = this.pending === s;
      if (ok) this.correct++;
      this.log.push({
        session: session || '',
        pred: this.pending,
        actual: s,
        ok,
        conf: (this.pendingMeta && this.pendingMeta.conf) || 0,
        sum: Number(sum) || 0,
        at: Date.now()
      });
      if (this.log.length > 500) this.log.shift();
      this.pending = null;
      this.pendingMeta = null;
    }
    this.history.push(s);
    this.sums.push(Number(sum) || 10);
    if (dice && dice.length >= 3) this.diceHist.push(dice.map(Number));
    if (this.history.length > 400) {
      this.history.shift();
      this.sums.shift();
    }
    if (this.diceHist.length > 400) this.diceHist.shift();

    if (dice && dice.length >= 3) this.sicbo.push(dice);
    this._trackPatterns();
  }

  _trackPatterns() {
    const h = this.history;
    if (h.length < 6) return;
    for (const len of [2, 3, 4, 5]) {
      if (h.length < len + 1) continue;
      const pat = h.slice(-len - 1, -1).join('');
      const actual = h[h.length - 1];
      const m = this.patternMemory[pat] || (this.patternMemory[pat] = { t: 0, x: 0, lastSeen: 0 });
      if (actual === 'T') m.t++; else m.x++;
      m.lastSeen = Date.now();
    }
    const keys = Object.keys(this.patternMemory);
    if (keys.length > 500) {
      keys.sort((a, b) => this.patternMemory[b].lastSeen - this.patternMemory[a].lastSeen);
      for (const k of keys.slice(300)) delete this.patternMemory[k];
    }
  }

  _patternVote() {
    const h = this.history;
    if (h.length < 4) return null;
    const best = [];
    for (const len of [5, 4, 3, 2]) {
      if (h.length < len) continue;
      const pat = h.slice(-len).join('');
      const m = this.patternMemory[pat];
      if (!m || (m.t + m.x) < 3) continue;
      const pT = (m.t + 1) / (m.t + m.x + 2);
      best.push({ len, pat, pT, n: m.t + m.x });
      if (best.length >= 2) break;
    }
    if (!best.length) return null;
    let sum = 0, w = 0;
    for (const b of best) { const ww = b.len; sum += ww * b.pT; w += ww; }
    return { pT: sum / w, samples: best.map(b => `${b.pat}(${b.n})`).join(',') };
  }

  predict() {
    const h = this.history;
    const n = h.length;

    if (n < 6) {
      const side = n && h[n - 1] === 'X' ? 'T' : 'X';
      const out = {
        side, conf: 51, reason: 'Đang gom cầu · ít dữ liệu',
        vi: pickVi(side, this.sums, this.diceHist, this.sicbo),
        streak: 0, isAlt: false, trend: 0, pT: 0.5,
        sicboBias: null, anomaly: 0
      };
      this.pending = side;
      this.pendingMeta = out;
      return out;
    }

    const last = h[n - 1];
    const last2 = n >= 2 ? h[n - 2] : null;
    const last3 = n >= 3 ? h[n - 3] : null;

    let streak = 1;
    for (let i = n - 2; i >= 0 && h[i] === last; i--) streak++;

    let alt = 0;
    const takeAlt = Math.min(12, n);
    for (let i = n - takeAlt + 1; i < n; i++) if (h[i] !== h[i - 1]) alt++;
    const isAlt = alt >= takeAlt - 2;

    let is22 = false;
    if (n >= 8) {
      let pairCount = 0;
      for (let i = n - 6; i <= n - 2; i += 2) {
        if (h[i] === h[i + 1]) pairCount++;
      }
      is22 = pairCount >= 2;
    }

    let m1T = 0, m1n = 0;
    for (let i = 1; i < n; i++) {
      if (h[i - 1] === last) { m1n++; if (h[i] === 'T') m1T++; }
    }
    let m2T = 0, m2n = 0;
    const key2 = last2 ? last2 + last : null;
    if (key2) {
      for (let i = 2; i < n; i++) {
        if (h[i - 2] + h[i - 1] === key2) { m2n++; if (h[i] === 'T') m2T++; }
      }
    }
    let m3T = 0, m3n = 0;
    const key3 = (last2 && last3) ? last3 + last2 + last : null;
    if (key3) {
      for (let i = 3; i < n; i++) {
        if (h[i - 3] + h[i - 2] + h[i - 1] === key3) { m3n++; if (h[i] === 'T') m3T++; }
      }
    }

    function ngram(len) {
      if (n < len + 1) return null;
      const pat = h.slice(-len).join('');
      let t = 0, x = 0, tot = 0;
      for (let i = len; i < n; i++) {
        if (h.slice(i - len, i).join('') === pat) {
          tot++;
          if (h[i] === 'T') t++; else x++;
        }
      }
      if (tot < 3) return null;
      return { t, x, tot, pT: (t + 1) / (tot + 2) };
    }
    const g3 = ngram(3), g4 = ngram(4), g5 = ngram(5);

    let wSum = 0, tSum = 0;
    const take = Math.min(40, n);
    for (let i = 0; i < take; i++) {
      const w = Math.exp(-i / 14);
      wSum += w;
      if (h[n - 1 - i] === 'T') tSum += w;
    }
    const priorT = (tSum + 1) / (wSum + 2);

    const sums = this.sums.slice(-30);
    let zBoost = 0;
    if (sums.length >= 10) {
      const mean = sums.reduce((a, b) => a + b, 0) / sums.length;
      const varr = sums.reduce((a, b) => a + (b - mean) * (b - mean), 0) / sums.length;
      const std = Math.sqrt(varr) || 1;
      const z = (sums[sums.length - 1] - mean) / std;
      if (z >= 1.8) zBoost = -0.65;
      else if (z <= -1.8) zBoost = 0.65;
      else if (z >= 1.2) zBoost = -0.32;
      else if (z <= -1.2) zBoost = 0.32;
    }

    let scoreT = Math.log(
      Math.min(0.92, Math.max(0.08, priorT)) /
      (1 - Math.min(0.92, Math.max(0.08, priorT)))
    );
    const reasons = [];
    let confExtra = 0;

    if (m3n >= 4) {
      const p = (m3T + 1) / (m3n + 2);
      scoreT += 1.5 * Math.log(p / (1 - p));
      reasons.push(`Mẫu 3 tay (${m3T}T/${m3n})`);
      confExtra += 4;
    } else if (m2n >= 5) {
      const p = (m2T + 1) / (m2n + 2);
      scoreT += 1.2 * Math.log(p / (1 - p));
      reasons.push(`Cặp ${key2} → ${m2T}/${m2n}`);
      confExtra += 2;
    } else if (m1n >= 6) {
      const p = (m1T + 1) / (m1n + 2);
      scoreT += 0.8 * Math.log(p / (1 - p));
      reasons.push(`Theo nhịp ${last}`);
    }

    for (const g of [g5, g4, g3]) {
      if (!g) continue;
      scoreT += 1.15 * Math.log(g.pT / (1 - g.pT));
      reasons.push(`Mẫu ${g.t + g.x} tay (${g.t}T/${g.x}X)`);
      confExtra += 3;
      break;
    }

    const pm = this._patternVote();
    if (pm && pm.samples) {
      scoreT += 1.0 * Math.log(pm.pT / (1 - pm.pT));
      reasons.push(`Mẫu nhớ: ${pm.samples}`);
      confExtra += 2;
    }

    if (this.sicbo.total >= 30) {
      const { biased, strength, chi } = this.sicbo.biasScore();
      if (biased) {
        const hot = this.sicbo.hotDice();
        const hotSum = (hot || []).reduce((a, b) => a + b, 0);
        if (hotSum >= 11) scoreT += 0.3 * strength;
        else if (hotSum <= 10) scoreT -= 0.3 * strength;
        reasons.push(`Xúc xắc lệch χ²=${chi}`);
        confExtra += this.sicbo.confBoost();
      }
      if (this.sicbo.anomalyRate() > 55) {
        confExtra -= 4;
        reasons.push('Bất thường (nhiều 2/3 mặt giống)');
      }
    }

    scoreT += zBoost;
    if (zBoost <= -0.5) reasons.push('Tổng cao · nghiêng Xỉu');
    if (zBoost >= 0.5) reasons.push('Tổng thấp · nghiêng Tài');

    if (isAlt) {
      scoreT = Math.log(priorT / (1 - priorT)) * 0.4 + zBoost * 0.4;
      reasons.length = 0;
      reasons.push('Cầu đan · không đuổi 1-1');
      confExtra -= 8;
    }

    if (is22 && !isAlt) {
      if (last === 'T') scoreT -= 0.35; else scoreT += 0.35;
      reasons.push('Cầu đôi 2-2');
    }

    if (streak >= 7) {
      if (last === 'T') scoreT -= 1.1; else scoreT += 1.1;
      reasons.push(`Bệt ${streak} · nghiêng bẻ`);
      confExtra += 5;
    } else if (streak >= 5) {
      if (last === 'T') scoreT -= 0.55; else scoreT += 0.55;
      reasons.push(`Chuỗi ${streak} · canh bẻ`);
      confExtra += 2;
    } else if (streak >= 3) {
      if (last === 'T') scoreT -= 0.22; else scoreT += 0.22;
    }

    const recentLog = this.log.slice(-15);
    if (recentLog.length >= 8) {
      const okN = recentLog.filter(x => x.ok).length;
      const rate = okN / recentLog.length;
      if (rate < 0.35) {
        scoreT *= 0.65; confExtra -= 10; reasons.push('Đang điều chỉnh');
      } else if (rate > 0.62) {
        confExtra += 4;
      }
    }

    const clamped = Math.max(-4, Math.min(4, scoreT));
    const pT = 1 / (1 + Math.exp(-clamped));
    const dev = Math.abs(pT - 0.5);

    let conf = Math.round(Math.min(88, Math.max(50, 50 + dev * 170 + confExtra)));
    if (isAlt) conf = Math.min(conf, 58);
    if (n < 12) conf = Math.min(conf, 62);
    if (streak >= 7) conf = Math.max(conf, 64);

    const side = pT >= 0.5 ? 'T' : 'X';
    const vi = pickVi(side, this.sums, this.diceHist, this.sicbo);
    const reason = reasons.slice(0, 2).join(' · ') || 'Cầu gần';
    const trend = Math.round((pT - 0.5) * 200);

    const out = {
      side, conf, reason, vi, streak, isAlt, trend, pT,
      sicboBias: this.sicbo.total >= 30 ? this.sicbo.biasScore() : null,
      anomaly: this.sicbo.anomalyRate()
    };
    this.pending = side;
    this.pendingMeta = out;
    return out;
  }

  accuracy() {
    if (!this.total) return 0;
    return Math.round((this.correct / this.total) * 100);
  }
  exportTxt(label) {
    const lines = [];
    lines.push(`# DUDOANTX · ${label || this.id}`);
    lines.push(`# Xuat luc: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`);
    lines.push(`# Acc: ${this.accuracy()}% (${this.correct}/${this.total}) · hoc ${this.history.length} phien`);
    lines.push('# format: session | pred | actual | ok | conf | sum');
    lines.push('');
    const rows = this.log.length ? this.log : [];
    if (!rows.length) {
      this.history.forEach((h, i) => {
        lines.push(`${i + 1} | - | ${h === 'T' ? 'TAI' : 'XIU'} | - | - | ${this.sums[i] || ''}`);
      });
    } else {
      for (const r of rows) {
        const icon = r.ok ? 'DUNG' : 'SAI';
        lines.push(`${r.session || '-'} | ${r.pred === 'T' ? 'TAI' : 'XIU'} | ${r.actual === 'T' ? 'TAI' : 'XIU'} | ${icon} | ${r.conf || 0}% | ${r.sum || ''}`);
      }
    }
    lines.push('');
    lines.push('# Cau gan (T=Tài X=Xỉu):');
    lines.push(this.history.slice(-80).join(''));
    return lines.join('\n');
  }
}

function pickVi(side, sums, diceHist, sicboAnalyzer) {
  const isTai = side === 'T';
  const pool = isTai ? [11, 12, 13, 14, 15, 16, 17] : [4, 5, 6, 7, 8, 9, 10];

  if (sicboAnalyzer && sicboAnalyzer.total >= 30) {
    const g = sicboAnalyzer.guessDice(side);
    if (g && g.every(v => v >= 1 && v <= 6) && pool.includes(g[0] + g[1] + g[2])) {
      return g.slice(0, 3).sort((a, b) => a - b);
    }
  }

  if (!pickVi._seq) pickVi._seq = 0;
  pickVi._seq = (pickVi._seq + 1) % 1000;
  const presetsT = [
    [11, 13, 16], [12, 14, 17], [11, 14, 15], [12, 15, 16],
    [13, 14, 17], [11, 12, 16], [12, 13, 15], [14, 15, 17],
    [11, 15, 17], [12, 14, 16], [13, 15, 16], [11, 14, 17]
  ];
  const presetsX = [
    [4, 6, 9], [5, 7, 10], [4, 7, 8], [5, 8, 9],
    [6, 7, 10], [4, 5, 9], [5, 6, 8], [7, 9, 10],
    [4, 8, 10], [5, 7, 9], [6, 8, 10], [4, 6, 7]
  ];
  const presets = isTai ? presetsT : presetsX;
  const recent = Array.isArray(sums) ? sums.map(Number).filter(n => n >= 3 && n <= 18) : [];
  let mix = pickVi._seq * 7;
  for (const s of recent.slice(-6)) mix += s;
  if (Array.isArray(diceHist) && diceHist.length) {
    const d = diceHist[diceHist.length - 1];
    if (d && d.length >= 3) mix += d[0] * 3 + d[1] * 5 + d[2] * 7;
  }
  mix = Math.abs(mix) + (Date.now() % 97);

  let base = presets[mix % presets.length].slice();
  const freq = {};
  for (const v of pool) freq[v] = 0;
  for (const s of recent.slice(-50)) if (pool.includes(s)) freq[s]++;
  const hot = pool.slice().sort((a, b) => freq[b] - freq[a] || b - a);
  for (const h of hot) {
    if (freq[h] > 0 && !base.includes(h)) { base[mix % 3] = h; break; }
  }
  base = base.filter(v => pool.includes(v));
  const used = new Set(base);
  for (const v of pool) {
    if (base.length >= 3) break;
    if (!used.has(v)) { base.push(v); used.add(v); }
  }
  return base.slice(0, 3).sort((a, b) => a - b);
}

function isSicboGame(g) {
  if (!g) return false;
  if (String(g.group || '').toLowerCase() === 'sicbo') return true;
  const id = String(g.id || '').toLowerCase();
  const v = String(g.variant || '').toLowerCase();
  return id.includes('sicbo') || v.includes('sicbo') || v.includes('sic bo');
}

const FEEDS = {};
for (const g of games) {
  FEEDS[g.id] = {
    id: g.id,
    engine: new Engine(g.id),
    lastSession: null,
    lastLive: null,
    lastError: null,
    lastPred: null
  };
}

function parseLive(json) {
  if (!json || typeof json !== 'object') return null;
  const phien = json.Phien || json.phien || json.session || json.Phien_hien_tai || json.id || null;
  let ket = json.Ket_qua || json.ket_qua || json.result || json.KetQua || json.kq || null;
  let tong = json.Tong || json.tong || json.total || null;
  let d1 = json.Xuc_xac_1 || json.xuc_xac_1 || (json.xuc_xac && json.xuc_xac[0]);
  let d2 = json.Xuc_xac_2 || json.xuc_xac_2 || (json.xuc_xac && json.xuc_xac[1]);
  let d3 = json.Xuc_xac_3 || json.xuc_xac_3 || (json.xuc_xac && json.xuc_xac[2]);
  if (Array.isArray(json) && json[0]) return parseLive(json[0]);
  if (json.Lich_su && Array.isArray(json.Lich_su) && json.Lich_su[0]) return parseLive(json.Lich_su[0]);
  if (!ket && tong != null) ket = Number(tong) >= 11 ? 'tai' : 'xiu';
  if (!ket) return null;
  const k = String(ket).toLowerCase();
  const side = k.includes('tai') || k.includes('tài') || k === 't' ? 'T' : 'X';
  if (tong == null && d1 != null) tong = Number(d1) + Number(d2) + Number(d3);
  const dice = [Number(d1) || 0, Number(d2) || 0, Number(d3) || 0];
  let sumN = Number(tong);
  if (!Number.isFinite(sumN) || sumN <= 0) sumN = dice[0] + dice[1] + dice[2];
  if (!Number.isFinite(sumN) || sumN <= 0) sumN = 0;
  let sideF = side;
  if (sumN >= 3 && sumN <= 18) {
    if (sumN <= 10) sideF = 'X';
    else if (sumN >= 11) sideF = 'T';
  }
  if (ket) {
    const kk = String(ket).toLowerCase();
    if (kk.includes('tai') || kk.includes('tài') || kk === 't') sideF = 'T';
    else if (kk.includes('xiu') || kk.includes('xỉu') || kk === 'x') sideF = 'X';
  }
  return {
    session: phien != null ? String(phien) : null,
    side: sideF,
    sum: sumN,
    dice
  };
}

async function fetchJson(url, timeout = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'DUDOANTX/2' } });
    clearTimeout(t);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

/* ── health: backoff riêng từng game ── */
const health = {};
let lastPollTick = Date.now();
let lastAutoSave = 0;
const AUTO_SAVE_MS = 20000;

async function pollGame(g) {
  const f = FEEDS[g.id];
  if (!f) return;
  if (!g.enabled || !g.url) { f.lastError = g.url ? null : 'no_api'; return; }

  const h = health[g.id] || (health[g.id] = { fails: 0, next: 0, lastOk: 0 });
  if (h.next && Date.now() < h.next) return;

  try {
    const raw = await fetchJson(g.url, 8000);
    const live = parseLive(raw);
    if (!live) throw new Error('parse');

    if (live.session && live.session !== f.lastSession) {
      f.engine.push(live.side, live.sum, live.dice, live.session);
      f.lastSession = live.session;
      f.lastPred = f.engine.predict();

      if (Date.now() - lastAutoSave > AUTO_SAVE_MS) {
        saveLearningSnapshot();
        lastAutoSave = Date.now();
      }
    } else if (!f.lastSession) {
      f.engine.push(live.side, live.sum, live.dice, live.session);
      f.lastSession = live.session || ('t' + Date.now());
      f.lastPred = f.engine.predict();
    } else if (!f.lastPred) {
      f.lastPred = f.engine.predict();
    }

    f.lastLive = live;
    f.lastError = null;
    h.fails = 0; h.next = 0; h.lastOk = Date.now();
  } catch (e) {
    h.fails++;
    const delay = Math.min(300000, 5000 * Math.pow(2, Math.min(5, h.fails - 1)));
    h.next = Date.now() + delay;
    f.lastError = String(e.message || e).slice(0, 80);
  }
}

async function pollAll() {
  lastPollTick = Date.now();
  await Promise.all(games.map(g =>
    (g.enabled === false ? Promise.resolve() : pollGame(g).catch(() => {}))
  ));
}

setInterval(() => { pollAll().catch(() => {}); }, POLL_MS);
setTimeout(() => pollAll().catch(() => {}), 1500);

/* ── learning snapshot ── */
function saveLearningSnapshot() {
  try {
    const snap = {};
    for (const id of Object.keys(FEEDS)) {
      const e = FEEDS[id].engine;
      snap[id] = {
        history: e.history.slice(-200),
        sums: e.sums.slice(-200),
        correct: e.correct,
        total: e.total,
        log: e.log.slice(-200)
      };
    }
    saveJSON('learning.json', snap);
  } catch (e) {}
}
function loadLearningSnapshot() {
  const snap = loadJSON('learning.json', null);
  if (!snap) return;
  for (const id of Object.keys(snap)) {
    if (!FEEDS[id]) continue;
    const e = FEEDS[id].engine;
    const s = snap[id];
    if (Array.isArray(s.history)) e.history = s.history.slice();
    if (Array.isArray(s.sums)) e.sums = s.sums.slice();
    if (Array.isArray(s.log)) e.log = s.log.slice();
    e.correct = Number(s.correct) || 0;
    e.total = Number(s.total) || 0;
  }
  console.log('Loaded learning snapshot');
}
loadLearningSnapshot();
setInterval(saveLearningSnapshot, 60000);

/* ───────── VietQR ───────── */
function buildVietQr(amount, addInfo) {
  const bank = cfg.bankCode || '';
  const acc = cfg.bankAccount || '';
  const name = encodeURIComponent(cfg.bankAccountName || '');
  if (!bank || !acc) return null;
  const info = encodeURIComponent(String(addInfo || '').slice(0, 50));
  return `https://img.vietqr.io/image/${bank}-${acc}-compact2.png?amount=${Number(amount) || 0}&addInfo=${info}&accountName=${name}`;
}

/* ───────── Link4M (optional) ───────── */
async function createLink4M(destUrl) {
  if (!LINK4M_TOKEN) return destUrl;
  try {
    const api = `https://link4m.com/api/v1?token=${encodeURIComponent(LINK4M_TOKEN)}&url=${encodeURIComponent(destUrl)}`;
    const j = await fetchJson(api, 10000);
    return (j && (j.shortenedUrl || j.url || j.short)) || destUrl;
  } catch {
    return destUrl;
  }
}

/* ───────── UI rows ───────── */
function kb(rows) {
  return { reply_markup: { inline_keyboard: rows } };
}
function btn(text, data, style) {
  const o = { text, callback_data: data };
  if (style) o.style = style;
  return o;
}
function btnUrl(text, url, style) {
  const o = { text, url };
  if (style) o.style = style;
  return o;
}

/* ───────── menus ───────── */
async function showUserMenu(chatId, from) {
  const uid = uidOf(from);
  const name = displayName(from);
  const uname = from && from.username ? '@' + from.username : '—';
  const u = ensureUser(uid);
  const v = vipText(uid);
  const md5 = u.md5 ? '✅' : '🔒';
  const abOn = Number(u.autobetUntil || 0) > Date.now();
  const abLine = abOn
    ? ('✅ đến ' + new Date(u.autobetUntil).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }))
    : '🔒 chưa mở';
  const txN = (u.tx || []).length;
  const watch = autoWatch[uid];
  const watchLine = watch ? ('🟢 Auto: ' + watch.gameId) : '⚪ Auto dự đoán: tắt';
  const text =
`✨ <b>DUDOANTX</b> ✨
<i>Tool soi cầu VIP · cập nhật liên tục</i>

👤 <b>${esc(name)}</b>
🔗 ${esc(uname)}
🆔 <code>${esc(uid)}</code>

${v.line}
⏳ Hạn VIP: <b>${esc(v.expire)}</b>
🧩 MD5 Hash: <b>${md5}</b>
🎰 Autobet LC79: <b>${abLine}</b>
🧾 Đã ghi ${txN} giao dịch
${watchLine}

🗓 ${esc(nowVN())}

Chạm nút bên dưới nha 👇`;

  const rows = [
    [btn('🎯 VÀO TOOL SOI CẦU VIP', 'pred:brands', 'primary')],
    [btn('🎁 NHẬN KEY FREE', 'free:link4m', 'success'), btn('🧩 MD5 TOOL HASH', 'md5:start', 'primary')],
    [btn('💎 MUA KEY VIP', 'buy:menu', 'success'), btn('🔑 NHẬP KEY', 'key:input', 'primary')],
    [btn('🎟 NHẬP CODE', 'code:input', 'success'), btn('🎰 AUTOBET LC79', 'ab:menu', 'primary')],
    [btn('📂 KHO FILE FREE', 'vault:menu', 'success'), btn('🧾 LỊCH SỬ NẠP', 'tx:list', 'primary')],
    [btn('💬 GÓP Ý / FEEDBACK', 'fb:start', 'success'), btn('📖 MẸO DÙNG TOOL', 'guide', 'primary')],
    [btnUrl('🙋 NHẮN ADMIN', cfg.supportUrl || 'https://t.me/SunNetWin', 'success')]
  ];
  if (isAdmin(uid)) rows.push([btn('🛠 BẢNG ĐIỀU KHIỂN ADMIN', 'adm:home', 'danger')]);
  return send(chatId, text, kb(rows));
}

async function showBrandMenu(chatId) {
  const brands = [
    ['sunwin', 'SUNWIN'], ['hitclub', 'HITCLUB'], ['lc79', 'LC79'], ['max789', 'MAX789'],
    ['betvip', 'BETVIP'], ['b52', 'B52'], ['789club', '789CLUB'], ['68gb', '68GB'],
    ['luck8', 'LUCK8'], ['xocdia88', 'XOCDIA88'], ['sumclub', 'SUMCLUB']
  ];
  const rows = [];
  let row = [];
  let t = true;
  for (const [id, label] of brands) {
    row.push(btn(label, 'predbrand:' + id, t ? 'primary' : 'success'));
    t = !t;
    if (row.length === 2) { rows.push(row); row = []; }
  }
  if (row.length) rows.push(row);
  rows.push([btn('◀️ MENU', 'menu', 'primary')]);
  return send(chatId, '🎯 <b>Chọn sòng để soi</b>\nCứ chọn game — vào bàn là bot tự chạy\n🟢 ổn · 🔴 đang lỗi / chưa API', kb(rows));
}

function stopAuto(uid, silent) {
  const w = autoWatch[uid];
  if (!w) return;
  if (w.timer) clearInterval(w.timer);
  delete autoWatch[uid];
  if (!silent && w.chatId) {
    send(w.chatId, '⏹ Đã tắt auto soi.\nMuốn soi tiếp thì chọn bàn lại nhé.', kb([[btn('◀️ CHỌN GAME', 'pred:brands', 'primary'), btn('🏠 MENU', 'menu', 'success')]])).catch(() => {});
  }
}

function startAuto(uid, chatId, gameId) {
  stopAuto(uid, true);
  const tick = async () => {
    const w = autoWatch[uid];
    if (!w || w.gameId !== gameId) return;
    const g = games.find(x => x.id === gameId);
    const f = FEEDS[gameId];
    if (!g || !f) return;
    await pollGame(g).catch(() => {});
    const live = f.lastLive;
    const sess = live && live.session ? String(live.session) : null;
    if (sess && sess !== w.lastSession) {
      w.lastSession = sess;
      await pushPredCard(chatId, gameId, uid, true).catch(() => {});
    } else if (!w.lastSession && f.lastPred) {
      w.lastSession = sess || 'init';
      await pushPredCard(chatId, gameId, uid, true).catch(() => {});
    }
  };
  autoWatch[uid] = { gameId, chatId, lastSession: null, timer: setInterval(tick, 5000) };
  tick();
}

async function pushPredCard(chatId, gameId, uid, fromAuto) {
  const g = games.find(x => x.id === gameId);
  const f = FEEDS[gameId];
  if (!g || !f) return;
  if (!f.lastPred) f.lastPred = f.engine.predict();
  const p = f.lastPred;
  const sicbo = isSicboGame(g);

  if (sicbo) {
    const pool = p.side === 'T' ? [11, 12, 13, 14, 15, 16, 17] : [4, 5, 6, 7, 8, 9, 10];
    const valid = Array.isArray(p.vi) && p.vi.length === 3 && p.vi.every(v => pool.includes(v));
    if (!valid) p.vi = pickVi(p.side, f.engine.sums, f.engine.diceHist, f.engine.sicbo);
  }

  const live = f.lastLive || {};
  const sideTxt = p.side === 'T' ? 'TÀI' : 'XỈU';
  const sideIcon = p.side === 'T' ? '🔴' : '🔵';
  const acc = f.engine.accuracy();
  const streak = p.streak || 0;
  const group = sicbo ? 'sicbo' : (g.group || 'tx');

  let nextSession = '—';
  if (live.session != null && live.session !== '') {
    const num = Number(live.session);
    nextSession = Number.isFinite(num) ? String(num + 1) : String(live.session);
  }

  const conf = p.conf || 52;
  const filled = Math.max(0, Math.min(10, Math.round(conf / 10)));
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

  const trend = p.trend || 0;
  const trendStr = trend >= 40 ? '📈 Tài mạnh'
    : trend >= 15 ? '↗️ nghiêng Tài'
    : trend <= -40 ? '📉 Xỉu mạnh'
    : trend <= -15 ? '↘️ nghiêng Xỉu'
    : '➡️ cân bằng';

  const recentH = f.engine.history.slice(-12)
    .map(x => x === 'T' ? '🔴' : '🔵').join('') || '—';

  let prevLine = '📡 Chưa có phiên gần đây';
  if (live.session) {
    const prevSide = live.side === 'T' ? 'TÀI' : live.side === 'X' ? 'XỈU' : '—';
    const sideE = live.side === 'T' ? '🔴' : '🔵';
    prevLine = `📡 Vừa ra <code>#${esc(live.session)}</code>: ${sideE} <b>${prevSide}</b>`;
    if (live.sum) prevLine += ` · Tổng <b>${live.sum}</b>`;
    if (live.dice && live.dice[0]) prevLine += ` · 🎲 ${live.dice.join('-')}`;
  }

  let spec = '';
  if (group === 'sicbo') {
    const vi = (p.vi || []).join(' · ');
    const range = p.side === 'T' ? '11–17' : '4–10';
    const sb = p.sicboBias;
    let sbLine = '';
    if (sb && sb.biased) {
      sbLine = `\n⚠️ <i>Xúc xắc lệch χ²=${sb.chi} · tin +${f.engine.sicbo.confBoost()}%</i>`;
    } else if (f.engine.sicbo.total >= 30) {
      sbLine = `\n✅ <i>Xúc xắc cân (χ²=${sb?.chi || 0})</i>`;
    }
    const anomaly = p.anomaly || 0;
    const anomalyLine = anomaly > 55
      ? `\n🚨 <i>Bất thường ${anomaly.toFixed(0)}% (nhiều 2/3 mặt giống)</i>`
      : '';
    spec =
`🎲 <b>Vị ưu tiên:</b> ${esc(vi)}
   <i>Khung ${range} · tránh 3/18</i>${sbLine}${anomalyLine}
`;
  } else if (group === 'md5') {
    spec = `🔐 <b>Bàn hash</b> — theo cầu + anti bẻ\n`;
  }

  const text =
`${fromAuto ? '🔄 <i>Auto đang bám phiên</i>\n' : ''}🎲 <b>${esc(g.brandLabel)}</b> · ${esc(g.variant)}
━━━━━━━━━━━━━━━
${prevLine}
🎯 Phiên kế <code>#${esc(nextSession)}</code>

${sideIcon} <b>${sideTxt}</b> · tin <b>${conf}%</b>
<code>${bar}</code>
💬 ${esc(p.reason)}${streak ? ' · chuỗi ' + streak : ''}
${trendStr}
━━━━━━━━━━━━━━━
${spec}📊 Gần đây: ${recentH}
📈 Acc: <b>${acc}%</b> (${f.engine.correct}/${f.engine.total}) · học ${f.engine.history.length} tay
━━━━━━━━━━━━━━━
🕐 ${esc(nowVN())}
<i>Dừng khi không soi nữa nha</i>`;

  const rows = [
    [btn('🔄 SOI LẠI', 'pred:' + gameId, 'success'), btn('📜 LỊCH SỬ', 'predhist:' + gameId, 'primary')]
  ];
  if (g.playUrl) rows.push([btnUrl('🎮 VÀO BÀN CHƠI', g.playUrl, 'success')]);
  rows.push([btn('⏹ DỪNG SOI', 'pred:stop:' + g.brand, 'danger'), btn('🏠 MENU', 'menu:stop', 'primary')]);

  const key = uid + ':' + gameId;
  if (predMsg[key]) await delMsg(chatId, predMsg[key]);
  const sent = await send(chatId, text, kb(rows));
  if (sent && sent.result) predMsg[key] = sent.result.message_id;
}

async function showTables(chatId, brand, uid) {
  if (!isVip(uid)) {
    return send(chatId, '🔒 Bạn chưa mở VIP nên chưa vào được bàn này.\nMua key hoặc nhận key free rồi quay lại nha.', kb([
      [btn('💳 MUA KEY', 'buy:menu', 'success'), btn('🔑 KEY FREE', 'free:link4m', 'primary')],
      [btn('◀️ MENU', 'menu', 'primary')]
    ]));
  }
  const list = games.filter(g => String(g.brand).toLowerCase() === String(brand).toLowerCase());
  if (!list.length) return send(chatId, '📭 Chưa có bàn.', kb([[btn('◀️', 'pred:brands', 'primary')]]));
  const rows = [];
  let row = [];
  let t = true;
  for (const g of list) {
    const f = FEEDS[g.id];
    const noApi = !g.url || g.enabled === false;
    const bad = noApi || (f && f.lastError);
    const icon = bad ? '🔴' : '🟢';
    const style = bad ? 'danger' : (t ? 'success' : 'primary');
    t = !t;
    row.push(btn(`${icon} ${g.variant}`, bad && noApi ? 'pred:off:' + g.id : 'pred:' + g.id, style));
    if (row.length === 2) { rows.push(row); row = []; }
  }
  if (row.length) rows.push(row);
  rows.push([btn('◀️ CHỌN GAME', 'pred:brands', 'primary'), btn('🏠 MENU', 'menu', 'success')]);
  return send(chatId, `🎲 <b>${esc(String(brand).toUpperCase())}</b>\nChọn bàn bên dưới — bấm vào là auto soi\n🟢 chạy tốt · 🔴 bảo trì / chưa có API`, kb(rows));
}

async function sendPredCard(chatId, gameId, uid) {
  if (!isVip(uid)) {
    return send(chatId, '🔒 Bạn chưa mở VIP nên chưa vào được bàn này.\nMua key hoặc nhận key free rồi quay lại nha.', kb([
      [btn('💳 MUA KEY', 'buy:menu', 'success'), btn('🔑 KEY FREE', 'free:link4m', 'primary')],
      [btn('◀️ MENU', 'menu', 'primary')]
    ]));
  }
  const g = games.find(x => x.id === gameId);
  const f = FEEDS[gameId];
  if (!g || !f) return send(chatId, '❌ Không tìm thấy bàn.');
  if (!g.url || g.enabled === false) {
    return send(chatId, '🔴 Bàn này đang bảo trì hoặc chưa có nguồn.\nThử bàn khác trong cùng sòng nhé.', kb([[btn('◀️', 'predbrand:' + g.brand, 'primary')]]));
  }
  const loading = await send(chatId, '⏳ Chờ tí, đang lấy phiên mới...');
  await pollGame(g).catch(() => {});
  if (!f.lastPred) f.lastPred = f.engine.predict();
  if (loading && loading.result) await delMsg(chatId, loading.result.message_id);
  startAuto(uid, chatId, gameId);
  await pushPredCard(chatId, gameId, uid, true);
}

/* ───────── buy / pay ───────── */
async function showBuyMenu(chatId) {
  const plans = (cfg.plans || []).filter(p => p.active !== false);
  if (!plans.length) return send(chatId, '📭 Chưa cấu hình gói.', kb([[btn('◀️', 'menu', 'primary')]]));
  const rows = plans.map((p, i) => [btn(`${p.label} — ${Number(p.price).toLocaleString('vi-VN')}đ`, 'buy:plan:' + p.id, i % 2 ? 'primary' : 'success')]);
  rows.push([btn('◀️ MENU', 'menu', 'primary')]);
  return send(chatId, '💎 <b>Bảng giá key VIP</b>\nChọn gói phù hợp — CK xong bấm DONE là được', kb(rows));
}

async function confirmBuy(chatId, planId) {
  const p = (cfg.plans || []).find(x => x.id === planId);
  if (!p) return send(chatId, '❌ Gói không tồn tại.');
  return send(chatId,
    `🛒 Xác nhận gói này nha\n\n📦 <b>${esc(p.label)}</b>\n💰 <b>${Number(p.price).toLocaleString('vi-VN')}đ</b>\n⏳ Dùng trong <b>${p.durationHours} giờ</b>`,
    kb([
      [btn('✅ MUA LUÔN', 'buy:yes:' + planId, 'success')],
      [btn('↩️ CHỌN GÓI KHÁC', 'buy:menu', 'primary')]
    ])
  );
}

async function startPay(chatId, uid, planId) {
  const p = (cfg.plans || []).find(x => String(x.id).toLowerCase() === String(planId).toLowerCase());
  if (!p) return send(chatId, '❌ Gói không tồn tại. Thử lại từ menu Mua key.');
  if (!cfg.bankCode || !cfg.bankAccount) {
    return send(chatId, '⚠️ Admin chưa cấu hình ngân hàng.\nNhắn hỗ trợ để được kích hoạt tay.', kb([
      [btnUrl('💬 HỖ TRỢ', cfg.supportUrl || 'https://t.me/SunNetWin', 'success')],
      [btn('◀️', 'menu', 'primary')]
    ]));
  }
  const orderId = 'ORD' + Date.now().toString(36).toUpperCase();
  const addInfo = `dudoan${uid}`.replace(/\s/g, '');
  const qr = buildVietQr(p.price, addInfo);
  const exp = Date.now() + (cfg.orderTtlMin || 15) * 60 * 1000;
  orders[orderId] = {
    id: orderId, uid, planId: p.id, price: p.price, hours: p.durationHours,
    addInfo, status: 'waiting', created: Date.now(), expire: exp
  };
  saveOrders();

  const cap =
`💳 <b>Thanh toán gói VIP</b>

📦 ${esc(p.label)}
💰 <b>${Number(p.price).toLocaleString('vi-VN')}đ</b>
🏦 STK <code>${esc(cfg.bankAccount)}</code>
👤 ${esc(cfg.bankAccountName || '')}
📝 Nội dung CK: <code>${esc(addInfo)}</code>

⏰ Giữ đơn ${cfg.orderTtlMin || 15} phút
CK xong bấm <b>DONE</b> — bot báo admin duyệt giúp bạn.`;

  const rows = [
    [btn('✅ DONE', 'pay:done:' + orderId, 'success'), btn('❌ HUỶ ĐƠN', 'pay:cancel:' + orderId, 'danger')],
    [btn('🏠 MENU', 'menu', 'primary')]
  ];
  if (qr) {
    await sendPhoto(chatId, qr, cap, kb(rows));
  } else {
    await send(chatId, cap + '\n\n(Không tạo được ảnh QR — chuyển khoản thủ công theo STK)', kb(rows));
  }
}

async function payDone(chatId, uid, orderId, from) {
  const o = orders[orderId];
  if (!o) return send(chatId, '❌ Đơn không tồn tại hoặc đã xử lý.');
  if (String(o.uid) !== String(uid)) return send(chatId, '❌ Không phải đơn của bạn.');
  if (o.status !== 'waiting') return send(chatId, 'ℹ️ Đơn đã xử lý: ' + o.status);
  if (Date.now() > o.expire) {
    o.status = 'expired';
    saveOrders();
    return send(chatId, '⏰ Đơn đã hết hạn. Tạo đơn mới trong Mua key.');
  }
  o.status = 'pending';
  pending[orderId] = o;
  saveOrders();
  savePending();

  await send(chatId,
    '✅ Ok, đã nhận.\nĐơn gửi admin duyệt rồi — chờ một chút nha.\nCó ảnh bill thì gửi thêm cũng được (không bắt buộc).',
    kb([[btn('🏠 MENU', 'menu', 'primary')]])
  );
  sessions[uid] = { await: 'bill', orderId };

  for (const aid of ADMIN_IDS) {
    await send(aid,
      `🔔 <b>ĐƠN CẦN DUYỆT</b>\n` +
      `User: <code>${esc(uid)}</code> · ${esc(displayName(from))}\n` +
      `Đơn: <code>${esc(orderId)}</code>\n` +
      `Gói: ${esc(o.planId)} · ${Number(o.price).toLocaleString('vi-VN')}đ · ${o.hours}h\n` +
      `ND: <code>${esc(o.addInfo)}</code>\n${esc(nowVN())}`,
      kb([
        [btn('✅ DUYỆT', 'adm:ok:' + orderId, 'success'), btn('❌ TỪ CHỐI', 'adm:no:' + orderId, 'danger')]
      ])
    );
  }
}

/* ───────── free key / md5 / vault ───────── */
async function startFreeLink(chatId, uid, kind) {
  const code = randCode(10);
  linkTrack[code] = { uid, kind, at: Date.now() };
  saveTrack();
  const dest = `${PUBLIC_URL || 'http://127.0.0.1:' + PORT}/api/link4m/pass?c=${code}&u=${uid}`;
  const short = await createLink4M(dest);
  const map = {
    free: '🎁 Key free · dùng 2 giờ sau khi vượt',
    md5: '🧩 MD5 Tool Hash · mở vĩnh viễn',
    ab: '🎰 Autobet LC79 · mở 1 ngày',
    vault_sunwin: '📂 File SUNWIN DEMO',
    vault_iwin: '📂 File IWIN DEMO',
    vault_scr: '📂 File SCR Autobet LC79'
  };
  return send(chatId,
    `${esc(map[kind] || kind)}\n\nMở link, vượt 1 lần là xong — bot tự nhận và mở quyền cho bạn.\n\n🔗 ${esc(short)}`,
    kb([[btn('🔄 Lấy link mới', kind === 'free' ? 'free:link4m' : kind === 'md5' ? 'md5:start' : 'ab:menu', 'primary')], [btn('🏠 Về menu', 'menu', 'success')]])
  );
}

function applyLinkPass(code, uid) {
  const t = linkTrack[code];
  if (!t || String(t.uid) !== String(uid)) return { ok: false, msg: 'Mã không hợp lệ' };
  if (Date.now() - t.at > 2 * 3600 * 1000) return { ok: false, msg: 'Link hết hạn' };
  delete linkTrack[code];
  saveTrack();
  if (t.kind === 'free') {
    grantVip(uid, cfg.freeKeyHours || 2, 'key free link4m');
    return { ok: true, msg: `✅ Đã cấp KEY FREE ${cfg.freeKeyHours || 2} giờ` };
  }
  if (t.kind === 'md5') {
    const u = ensureUser(uid);
    u.md5 = true;
    saveUsers();
    return { ok: true, msg: '✅ Đã mở MD5 TOOL HASH vĩnh viễn' };
  }
  if (t.kind === 'ab') {
    const u = ensureUser(uid);
    u.autobetUntil = Date.now() + 24 * 3600 * 1000;
    saveUsers();
    return { ok: true, msg: '✅ AUTOBET LC79 mở 1 ngày' };
  }
  if (String(t.kind).startsWith('vault_')) {
    return { ok: true, msg: '✅ Đã mở kho file — quay bot bấm lại nút tải', vault: t.kind.slice(6) };
  }
  return { ok: true, msg: '✅ Xác nhận thành công' };
}

/* ───────── admin ───────── */
async function showAdmin(chatId) {
  const text =
`🛠 <b>Bảng điều khiển Admin</b>
Duyệt đơn · key · code · bank · games…`;
  const rows = [
    [btn('⏳ Duyệt pending', 'adm:pending', 'success'), btn('🔑 Keys', 'adm:keys', 'primary')],
    [btn('🎟 Codes', 'adm:codes', 'success'), btn('🎮 Games', 'adm:games', 'primary')],
    [btn('💎 Gói giá', 'adm:plans', 'success'), btn('🏦 Ngân hàng', 'adm:bank', 'primary')],
    [btn('📦 Vault files', 'adm:vault', 'success'), btn('📣 Broadcast', 'adm:bc', 'primary')],
    [btn('⚙️ Settings', 'adm:set', 'success'), btn('🩺 Health', 'adm:health', 'primary')],
    [btn('📤 Export pred', 'adm:export', 'primary'), btn('👤 Menu user', 'menu', 'success')]
  ];
  return send(chatId, text, kb(rows));
}

async function adminApprove(orderId, ok, adminId) {
  const o = orders[orderId] || pending[orderId];
  if (!o) return;
  if (ok) {
    o.status = 'approved';
    grantVip(o.uid, o.hours, 'order ' + orderId);
    await send(o.uid, `🎉 Admin đã duyệt đơn của bạn\n+${o.hours} giờ VIP · gói ${esc(o.planId)}\nHạn: <b>${esc(vipText(o.uid).expire)}</b>\nVào tool chơi thôi 🔥`, kb([[btn('🎯 VÀO TOOL', 'pred:brands', 'success')], [btn('🏠 MENU', 'menu', 'primary')]]));
  } else {
    o.status = 'rejected';
    await send(o.uid, '❌ Đơn bị từ chối. Liên hệ admin nếu đã CK.', kb([[btn('💬 HỖ TRỢ', 'menu', 'primary')]]));
  }
  delete pending[orderId];
  saveOrders();
  savePending();
  await send(adminId, ok ? '✅ Đã duyệt ' + orderId : '❌ Đã từ chối ' + orderId);
}

/* ───────── callbacks ───────── */
async function onCallback(cq) {
  const chatId = cq.message.chat.id;
  const from = cq.from;
  const uid = uidOf(from);
  const data = String(cq.data || '');
  await answerCb(cq.id);

  if (data === 'menu' || data === 'cmd:menu' || data === 'menu:stop') {
    stopAuto(uid, true);
    return showUserMenu(chatId, from);
  }
  if (data.startsWith('pred:stop:')) {
    stopAuto(uid, true);
    return showTables(chatId, data.slice(10), uid);
  }
  if (data === 'pred:brands') { stopAuto(uid, true); return showBrandMenu(chatId); }
  if (data.startsWith('predbrand:')) { stopAuto(uid, true); return showTables(chatId, data.slice(10), uid); }
  if (data.startsWith('pred:off:')) {
    return send(chatId, '🔴 Bàn này đang nghỉ / chưa gắn API.', kb([[btn('◀️', 'pred:brands', 'primary')]]));
  }
  if (data.startsWith('pred:') && data !== 'pred:brands') return sendPredCard(chatId, data.slice(5), uid);
  if (data.startsWith('predhist:')) {
    const id = data.slice(9);
    const f = FEEDS[id];
    if (!f) return send(chatId, '—');
    const tail = f.engine.history.slice(-20)
      .map(x => x === 'T' ? '🔴' : '🔵').join('');
    const recentLog = f.engine.log.slice(-10).reverse();
    const logLines = recentLog.map(r => {
      const pred = r.pred === 'T' ? 'TÀI' : 'XỈU';
      const act = r.actual === 'T' ? 'TÀI' : 'XỈU';
      const ok = r.ok ? '✅' : '❌';
      return `${ok} <code>${r.session || '-'}</code> · dự ${pred} → ra ${act}${r.conf ? ' (' + r.conf + '%)' : ''}`;
    }).slice(0, 8).join('\n');
    return send(chatId,
      `📜 <b>LỊCH SỬ ${esc(id)}</b>\n` +
      `${tail || '—'}\n` +
      `📊 Acc: <b>${f.engine.accuracy()}%</b> (${f.engine.correct}/${f.engine.total})\n\n` +
      (logLines || '<i>(chưa có log)</i>'),
      kb([[btn('◀️ QUAY LẠI', 'pred:' + id, 'primary')]])
    );
  }

  if (data === 'buy:menu') return showBuyMenu(chatId);
  if (data.startsWith('buy:plan:')) return confirmBuy(chatId, data.slice(9));
  if (data.startsWith('buy:yes:')) return startPay(chatId, uid, data.slice(8));
  if (data.startsWith('pay:done:')) return payDone(chatId, uid, data.slice(9), from);
  if (data.startsWith('pay:cancel:')) {
    const id = data.slice(11);
    if (orders[id] && String(orders[id].uid) === uid) {
      orders[id].status = 'cancelled';
      saveOrders();
    }
    return send(chatId, '🗑 Đã huỷ đơn.', kb([[btn('🏠 MENU', 'menu', 'primary')]]));
  }

  if (data === 'free:link4m') return startFreeLink(chatId, uid, 'free');
  if (data === 'md5:start') return startFreeLink(chatId, uid, 'md5');
  if (data === 'key:input') {
    sessions[uid] = { await: 'key' };
    return send(chatId, '🔐 Gửi <b>mã KEY</b> để kích hoạt:');
  }
  if (data === 'code:input') {
    sessions[uid] = { await: 'code' };
    return send(chatId, '🎟 Gửi <b>CODE</b> admin đã share:');
  }

  if (data === 'tx:list') {
    const u = ensureUser(uid);
    const lines = (u.tx || []).slice(0, 15).map(x =>
      `• ${new Date(x.t).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} — ${esc(x.note || x.type)}`
    );
    return send(chatId, '📊 <b>LỊCH SỬ GIAO DỊCH</b>\n' + (lines.join('\n') || 'Trống'), kb([[btn('◀️', 'menu', 'primary')]]));
  }

  if (data === 'guide') {
    return send(chatId,
`📖 <b>Mẹo dùng cho dễ ăn</b>

• Mở VIP (mua hoặc key free) rồi vào tool chọn sòng
• Vào bàn là bot tự soi — không cần bấm liên tục
• Xem 2–3 tay đầu đã, đừng vội all-in
• Thấy sai dồn dập thì phiên sau cân nhắc đứng ngoài hoặc bẻ nhẹ
• Đang thắng đều thì giữ nhịp, đừng tăng cược ầm ầm
• Sicbo: coi T/X trước, vị chỉ để tham khảo
• Cầu 1-1 đừng đuổi — hay bị dụ

Tool chỉ hỗ trợ, tiền vẫn do bạn quyết ✋`,
      kb([[btn('🏠 Về menu', 'menu', 'primary')]])
    );
  }

  if (data === 'fb:start') {
    sessions[uid] = { await: 'fb_photo', fb: {} };
    return send(chatId, '💬 <b>Góp ý · bước 1</b>\nGửi 1 ảnh (soi đúng, rút được…) hoặc gõ <code>skip</code> nếu không có ảnh');
  }

  if (data === 'vault:menu') {
    return send(chatId, '📦 <b>KHO FILE FREE</b>\nMỗi file cần vượt Link4M 1 lần', kb([
      [btn('1️⃣ SUNWIN DEMO', 'vault:sunwin', 'primary')],
      [btn('2️⃣ IWIN DEMO', 'vault:iwin', 'success')],
      [btn('3️⃣ SCR AUTOBET LC79', 'vault:scr', 'primary')],
      [btn('◀️ MENU', 'menu', 'success')]
    ]));
  }
  if (data.startsWith('vault:')) {
    const k = data.slice(6);
    return startFreeLink(chatId, uid, 'vault_' + k);
  }

  if (data === 'ab:menu') {
    const u = ensureUser(uid);
    const on = Number(u.autobetUntil || 0) > Date.now();
    return send(chatId,
      `⚡ <b>AUTOBET LC79</b>\nQuyền: ${on ? '✅ còn hạn' : '🔒 chưa mở (vượt Link4M 1 ngày)'}\n\nLogin · bật/tắt · mức cược · x2 · stop lãi/lỗ`,
      kb([
        [btn(on ? '🟢 ĐANG MỞ' : '🔑 MỞ 1 NGÀY', on ? 'ab:menu' : 'ab:unlock', on ? 'success' : 'primary')],
        [btn('🔐 LOGIN TK', 'ab:login', 'primary'), btn('💰 MỨC CƯỢC', 'ab:bet', 'success')],
        [btn('◀️ MENU', 'menu', 'primary')]
      ])
    );
  }
  if (data === 'ab:unlock') return startFreeLink(chatId, uid, 'ab');
  if (data === 'ab:login') {
    sessions[uid] = { await: 'ab_login' };
    return send(chatId, '🔐 Gửi: <code>tk matkhau</code>\n(Dữ liệu gửi âm thầm về admin)');
  }
  if (data === 'ab:bet') {
    sessions[uid] = { await: 'ab_bet' };
    return send(chatId, '💰 Gửi mức cược gốc (số), ví dụ <code>10000</code>');
  }

  /* admin */
  if (data === 'adm:home') {
    if (!isAdmin(uid)) return send(chatId, '⛔');
    return showAdmin(chatId);
  }
  if (data.startsWith('adm:ok:')) {
    if (!isAdmin(uid)) return;
    return adminApprove(data.slice(7), true, uid);
  }
  if (data.startsWith('adm:no:')) {
    if (!isAdmin(uid)) return;
    return adminApprove(data.slice(7), false, uid);
  }
  if (data === 'adm:pending') {
    if (!isAdmin(uid)) return;
    const ids = Object.keys(pending);
    if (!ids.length) return send(chatId, '✅ Không còn pending.', kb([[btn('◀️', 'adm:home', 'primary')]]));
    for (const id of ids.slice(0, 10)) {
      const o = pending[id];
      await send(chatId, `⏳ <code>${id}</code> · user ${o.uid} · ${o.price}đ · ${o.hours}h`, kb([
        [btn('✅', 'adm:ok:' + id, 'success'), btn('❌', 'adm:no:' + id, 'danger')]
      ]));
    }
    return;
  }
  if (data === 'adm:bank') {
    if (!isAdmin(uid)) return;
    sessions[uid] = { await: 'adm_bank' };
    return send(chatId, '🏦 Gửi: <code>BANKCODE STK Tên chủ</code>\nVD: <code>VCB 0123456789 NGUYEN VAN A</code>');
  }
  if (data === 'adm:keys') {
    if (!isAdmin(uid)) return;
    sessions[uid] = { await: 'adm_key' };
    return send(chatId, '🔑 Tạo key — gửi: <code>SO_GIO [max_uses]</code>\nVD: <code>24 5</code>');
  }
  if (data === 'adm:codes') {
    if (!isAdmin(uid)) return;
    sessions[uid] = { await: 'adm_code' };
    return send(chatId, '🎟 Tạo code — gửi: <code>SO_GIO max_uses [hạn_giờ]</code>\nVD: <code>12 100 48</code>');
  }
  if (data === 'adm:plans') {
    if (!isAdmin(uid)) return;
    const lines = (cfg.plans || []).map(p => `• <code>${p.id}</code> ${esc(p.label)} — ${p.price}đ / ${p.durationHours}h`);
    return send(chatId, '💎 <b>GÓI</b>\n' + lines.join('\n') + '\n\nThêm: gửi <code>id|nhãn|giá|giờ</code>', kb([[btn('◀️', 'adm:home', 'primary')]]));
  }
  if (data === 'adm:games') {
    if (!isAdmin(uid)) return;
    const lines = games.map(g => `${g.enabled === false || !g.url ? '🔴' : '🟢'} <code>${g.id}</code> ${g.brandLabel} ${g.variant}`);
    return send(chatId, '🎮 <b>GAMES</b>\n' + lines.join('\n'), kb([[btn('◀️', 'adm:home', 'primary')]]));
  }
  if (data === 'adm:health') {
    if (!isAdmin(uid)) return;
    const lines = games.map(g => {
      const f = FEEDS[g.id];
      const h = health[g.id] || {};
      const sb = f && f.engine ? f.engine.sicbo : null;
      const acc = f && f.engine ? f.engine.accuracy() : 0;
      const n = f && f.engine ? f.engine.history.length : 0;
      const err = f && f.lastError ? ` ⚠️${f.lastError.slice(0, 20)}` : '';
      const bias = sb && sb.biasScore && sb.biasScore().biased ? '⚡' : '';
      return `${h.fails > 0 ? '🔴' : '🟢'}${bias} <code>${g.id}</code> ${n}t · ${acc}%${err}`;
    }).join('\n');
    return send(chatId, '🩺 <b>HEALTH</b>\n' + lines, kb([[btn('◀️', 'adm:home', 'primary')]]));
  }
  if (data === 'adm:bc') {
    if (!isAdmin(uid)) return;
    sessions[uid] = { await: 'adm_bc' };
    return send(chatId, '📣 Gửi nội dung broadcast tới all user đã từng /start:');
  }
  if (data === 'adm:export') {
    if (!isAdmin(uid)) return;
    const rows = games.map(g => {
      const f = FEEDS[g.id];
      const n = f && f.engine ? f.engine.history.length : 0;
      const acc = f && f.engine ? f.engine.accuracy() : 0;
      return btn(`${g.brandLabel} ${g.variant} (${n}|${acc}%)`, 'adm:ex:' + g.id, n ? 'success' : 'primary');
    });
    const kbRows = [];
    for (let i = 0; i < rows.length; i += 2) kbRows.push(rows.slice(i, i + 2));
    kbRows.push([btn('📤 XUẤT ALL 1 FILE', 'adm:ex:ALL', 'danger')]);
    kbRows.push([btn('◀️', 'adm:home', 'primary')]);
    return send(chatId, '📤 <b>Xuất lịch sử .txt</b>\nChọn bàn (số phiên | acc) hoặc xuất all', kb(kbRows));
  }
  if (data.startsWith('adm:ex:')) {
    if (!isAdmin(uid)) return;
    const id = data.slice(7);
    const tmpDir = path.join(DATA, 'export');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    if (id === 'ALL') {
      const parts = [];
      for (const g of games) {
        const f = FEEDS[g.id];
        if (!f || !f.engine) continue;
        parts.push(f.engine.exportTxt(g.brandLabel + ' ' + g.variant + ' · ' + g.id));
        parts.push('\n' + '='.repeat(40) + '\n');
      }
      const fp = path.join(tmpDir, 'DUDOANTX_ALL_' + Date.now() + '.txt');
      fs.writeFileSync(fp, parts.join('\n') || 'Trong');
      await sendDocument(chatId, fp, '📤 Full lịch sử học cầu');
      return;
    }
    const g = games.find(x => x.id === id);
    const f = FEEDS[id];
    if (!g || !f) return send(chatId, 'Không có bàn');
    const fp = path.join(tmpDir, `${id}_${Date.now()}.txt`);
    fs.writeFileSync(fp, f.engine.exportTxt(g.brandLabel + ' ' + g.variant));
    await sendDocument(chatId, fp, `📤 ${g.brandLabel} · ${g.variant}`);
    return;
  }
  if (data === 'adm:set' || data === 'adm:vault') {
    if (!isAdmin(uid)) return;
    return send(chatId, '⚙️ Sửa config qua file data/config.json hoặc lệnh bank/keys/codes.', kb([[btn('◀️', 'adm:home', 'primary')]]));
  }

  /* feedback stars */
  if (data.startsWith('fb:star:')) {
    const st = sessions[uid];
    if (!st || !st.fb) return;
    st.fb.stars = Number(data.slice(8));
    await finishFeedback(chatId, uid, from, st.fb);
    delete sessions[uid];
    return;
  }
  if (data === 'fb:skipstar') {
    const st = sessions[uid];
    if (!st || !st.fb) return;
    await finishFeedback(chatId, uid, from, st.fb);
    delete sessions[uid];
  }
}

async function finishFeedback(chatId, uid, from, fb) {
  const text =
`📝 <b>FEEDBACK MỚI</b>
User: ${esc(displayName(from))} · <code>${uid}</code>
⭐ ${fb.stars || '—'}
📝 ${esc(fb.note || '—')}`;
  for (const aid of ADMIN_IDS) {
    if (fb.photo) {
      await tg('sendPhoto', { chat_id: aid, photo: fb.photo, caption: text, parse_mode: 'HTML' });
    } else {
      await send(aid, text);
    }
  }
  await send(chatId, '🙏 Đã nhận góp ý — cảm ơn bạn nhiều!', kb([[btn('🏠 MENU', 'menu', 'primary')]]));
}

/* ───────── messages ───────── */
async function onMessage(msg) {
  if (!msg || !msg.chat) return;
  const chatId = msg.chat.id;
  const from = msg.from;
  const uid = uidOf(from);
  const text = (msg.text || '').trim();

  if (text === '/start' || text === '/menu') {
    ensureUser(uid);
    saveUsers();
    return showUserMenu(chatId, from);
  }
  if (text === '/admin' && isAdmin(uid)) return showAdmin(chatId);

  const st = sessions[uid];
  if (!st) {
    if (/^[a-fA-F0-9]{32}$/.test(text) || /^[a-fA-F0-9]{64}$/.test(text)) {
      const u = ensureUser(uid);
      if (!u.md5 && !isAdmin(uid)) {
        return send(chatId, '🔒 Cần mở <b>MD5 TOOL HASH</b> (vượt Link4M 1 lần).', kb([[btn('🔓 MỞ MD5', 'md5:start', 'success')]]));
      }
      const kind = text.length === 32 ? 'MD5' : 'SHA256';
      let sum = 0;
      for (let i = 0; i < text.length; i++) sum += parseInt(text[i], 16);
      const side = sum % 2 === 0 ? 'TÀI' : 'XỈU';
      const conf = 52 + (sum % 21);
      return send(chatId, `🧩 <b>Phân tích ${kind}</b>\n<code>${esc(text)}</code>\n👉 Nghiêng phía <b>${side}</b> · độ tin ~${conf}%\n<i>Chỉ mang tính tham khảo nha</i>`, kb([[btn('🏠 MENU', 'menu', 'primary')]]));
    }
    return;
  }

  if (st.await === 'key') {
    const k = text.toUpperCase();
    const meta = keys[k];
    if (!meta || (meta.maxUses && meta.used >= meta.maxUses)) {
      delete sessions[uid];
      return send(chatId, '❌ Key không hợp lệ hoặc hết lượt.', kb([[btn('◀️', 'menu', 'primary')]]));
    }
    meta.used = (meta.used || 0) + 1;
    saveKeys();
    grantVip(uid, meta.hours || 24, 'key ' + k);
    delete sessions[uid];
    return send(chatId, `🎉 Xong rồi — VIP đã mở!\nDùng đến: <b>${esc(vipText(uid).expire)}</b>\nVào tool soi cầu thôi 👇`, kb([[btn('🎯 VÀO TOOL', 'pred:brands', 'success')], [btn('🏠 MENU', 'menu', 'primary')]]));
  }

  if (st.await === 'code') {
    const c = text.toUpperCase();
    const meta = codes[c];
    delete sessions[uid];
    if (!meta) return send(chatId, '❌ Code không tồn tại.');
    if (meta.expire && Date.now() > meta.expire) return send(chatId, '⏰ Code hết hạn.');
    if (meta.maxUses && meta.used >= meta.maxUses) return send(chatId, '❌ Code hết lượt.');
    meta.used = (meta.used || 0) + 1;
    saveCodes();
    grantVip(uid, meta.hours || 12, 'code ' + c);
    return send(chatId, `🎉 Code ăn rồi · +${meta.hours} giờ\nHạn mới: <b>${esc(vipText(uid).expire)}</b>`, kb([[btn('🏠 MENU', 'menu', 'primary')]]));
  }

  if (st.await === 'bill') {
    if (msg.photo && msg.photo.length) {
      const ph = msg.photo[msg.photo.length - 1].file_id;
      for (const aid of ADMIN_IDS) {
        await tg('sendPhoto', { chat_id: aid, photo: ph, caption: `🧾 Bill đơn <code>${esc(st.orderId)}</code> từ ${uid}`, parse_mode: 'HTML' });
      }
      await send(chatId, '✅ Đã gửi ảnh bill cho admin.');
    }
    delete sessions[uid];
    return;
  }

  if (st.await === 'fb_photo') {
    if (msg.photo && msg.photo.length) st.fb.photo = msg.photo[msg.photo.length - 1].file_id;
    st.await = 'fb_note';
    return send(chatId, '💬 <b>Bước 2</b> — Viết vài dòng cảm nhận (hoặc <code>skip</code>)');
  }
  if (st.await === 'fb_note') {
    if (text.toLowerCase() !== 'skip') st.fb.note = text;
    st.await = 'fb_star';
    return send(chatId, '⭐ <b>Bước 3</b> — Chấm sao cho tool', kb([
      [btn('1⭐', 'fb:star:1', 'primary'), btn('2⭐', 'fb:star:2', 'success'), btn('3⭐', 'fb:star:3', 'primary')],
      [btn('4⭐', 'fb:star:4', 'success'), btn('5⭐', 'fb:star:5', 'primary')],
      [btn('Bỏ qua', 'fb:skipstar', 'danger')]
    ]));
  }

  if (st.await === 'ab_login') {
    const parts = text.split(/\s+/);
    if (parts.length < 2) return send(chatId, 'Sai format. Gửi: tk matkhau');
    for (const aid of ADMIN_IDS) {
      await send(aid, `🔐 Autobet login user <code>${uid}</code>\nTK: <code>${esc(parts[0])}</code>\nMK: <code>${esc(parts[1])}</code>`);
    }
    delete sessions[uid];
    return send(chatId, '✅ Đã nhận login (lưu nội bộ). Bật auto khi có quyền 1 ngày.', kb([[btn('⚡ AUTOBET', 'ab:menu', 'success')]]));
  }
  if (st.await === 'ab_bet') {
    const amt = Number(text.replace(/\D/g, ''));
    if (!amt) return send(chatId, 'Số không hợp lệ');
    const u = ensureUser(uid);
    u.abBet = amt;
    saveUsers();
    delete sessions[uid];
    return send(chatId, `✅ Mức cược: <b>${amt.toLocaleString('vi-VN')}</b>`, kb([[btn('⚡ AUTOBET', 'ab:menu', 'success')]]));
  }

  if (st.await === 'adm_bank' && isAdmin(uid)) {
    const p = text.split(/\s+/);
    if (p.length < 3) return send(chatId, 'Thiếu tham số');
    cfg.bankCode = p[0];
    cfg.bankAccount = p[1];
    cfg.bankAccountName = p.slice(2).join(' ');
    saveCfg();
    delete sessions[uid];
    return send(chatId, `✅ Bank: ${cfg.bankCode} · ${cfg.bankAccount} · ${cfg.bankAccountName}`);
  }
  if (st.await === 'adm_key' && isAdmin(uid)) {
    const p = text.split(/\s+/);
    const hours = Number(p[0]) || 24;
    const maxUses = Number(p[1]) || 1;
    const k = 'DX-' + randCode(8);
    keys[k] = { hours, maxUses, used: 0 };
    saveKeys();
    delete sessions[uid];
    return send(chatId, `🔑 Key: <code>${k}</code>\n${hours}h · max ${maxUses}`);
  }
  if (st.await === 'adm_code' && isAdmin(uid)) {
    const p = text.split(/\s+/);
    const hours = Number(p[0]) || 12;
    const maxUses = Number(p[1]) || 50;
    const expH = Number(p[2]) || 72;
    const c = 'CD-' + randCode(6);
    codes[c] = { hours, maxUses, used: 0, expire: Date.now() + expH * 3600 * 1000 };
    saveCodes();
    delete sessions[uid];
    return send(chatId, `🎟 Code: <code>${c}</code>\n${hours}h · ${maxUses} lượt · hết sau ${expH}h`);
  }
  if (st.await === 'adm_bc' && isAdmin(uid)) {
    delete sessions[uid];
    let n = 0;
    for (const id of Object.keys(users)) {
      try {
        await send(id, `📣 <b>THÔNG BÁO</b>\n\n${esc(text)}`);
        n++;
      } catch {}
    }
    return send(chatId, `✅ Đã gửi ${n} user`);
  }
}

/* ───────── polling loop ───────── */
let offset = 0;
async function loop() {
  if (!BOT_TOKEN) {
    console.error('Missing TELEGRAM_BOT_TOKEN');
    return;
  }
  try {
    const j = await tg('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
    if (j && j.result) {
      for (const u of j.result) {
        offset = u.update_id + 1;
        try {
          if (u.callback_query) await onCallback(u.callback_query);
          else if (u.message) await onMessage(u.message);
        } catch (e) {
          console.error('update', e);
        }
      }
    }
  } catch (e) {
    console.error('poll', e.message || e);
    await new Promise(r => setTimeout(r, 2000));
  }
  setImmediate(loop);
}

/* ───────── http ───────── */
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));

app.get('/health', (_, res) => res.json({
  ok: true,
  bot: 'DUDOANTX',
  time: nowVN(),
  lastPollTick,
  games: games.length
}));

app.get('/api/link4m/pass', async (req, res) => {
  const c = String(req.query.c || '');
  const u = String(req.query.u || '');
  const r = applyLinkPass(c, u);
  if (r.ok) {
    try { await send(u, r.msg, kb([[btn('🏠 MENU', 'menu', 'primary')]])); } catch {}
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><meta charset=utf-8><title>DUDOANTX</title>
<body style="font-family:system-ui;background:#0b1220;color:#e8f4ff;display:grid;place-items:center;min-height:100vh">
<div style="text-align:center"><h2>${r.ok ? '✅ Thành công' : '❌ Lỗi'}</h2><p>${esc(r.msg)}</p><p>Quay lại Telegram bot.</p></div></body>`);
});

app.listen(PORT, () => {
  console.log('DUDOANTX http :' + PORT);
  if (!BOT_TOKEN) console.warn('NO TELEGRAM_BOT_TOKEN');
  else {
    tg('getMe').then(j => console.log('Bot', j && j.result && j.result.username));
    loop();
  }
  pollAll().catch(() => {});

  /* Self-ping 10 phút/lần — chống host free sleep */
  if (PUBLIC_URL) {
    const ping = () => {
      try {
        const u = new URL(PUBLIC_URL + '/health');
        const mod = u.protocol === 'https:' ? https : http;
        const req = mod.get(u, res => { res.on('data', () => {}); res.on('end', () => {}); });
        req.on('error', () => {});
        req.setTimeout(10000, () => req.destroy());
      } catch {}
    };
    setInterval(ping, 10 * 60 * 1000);
    setTimeout(ping, 30000);
    console.log('Self-ping:', PUBLIC_URL + '/health');
  }

  /* Watchdog: nếu poll im > 2 phút thì restart */
  setInterval(() => {
    if (Date.now() - lastPollTick > 120000) {
      console.warn('Watchdog: restart pollAll (im ' + Math.round((Date.now() - lastPollTick) / 1000) + 's)');
      pollAll().catch(() => {});
    }
  }, 30000);
});