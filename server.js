/**
 * TOOL HTUNGG — ULTIMATE PREDICTION TOOL (FINAL v15.8)
 * Full Bot Telegram (Hash, History, Admin) + Web Dashboard (Link gốc)
 */
'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const dns = require('dns');
const crypto = require('crypto');
const { io } = require('socket.io-client');

try { dns.setDefaultResultOrder('ipv4first'); } catch (e) {}

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

const PORT = Number(process.env.PORT) || 10000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_IDS = String(process.env.TELEGRAM_ADMIN_IDS || process.env.ADMIN_IDS || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.WEB_URL || '').replace(/\/$/, '');
const POLL_MS = Number(process.env.POLL_MS || 5000);
const TRIAL_HOURS = 2;

const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

/* ═══════════════ HELPERS ═══════════════ */
function loadJSON(file, fallback) {
  try {
    const p = path.join(DATA, file);
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return fallback; }
}
function saveJSON(file, data) {
  try { fs.writeFileSync(path.join(DATA, file), JSON.stringify(data, null, 2)); } catch {}
}
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmt(n) { return Number(n || 0).toLocaleString('vi-VN'); }
function nowVN() {
  return new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}
function isAdmin(id) { return ADMIN_IDS.includes(String(id)); }
function uidOf(from) { return String(from && from.id != null ? from.id : ''); }
function displayName(from) {
  if (!from) return 'Vô Danh';
  return [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Vô Danh';
}

async function tg(method, body) {
  if (!BOT_TOKEN) return null;
  const url = `${TG}/${method}`;
  return new Promise((resolve) => {
    const u = new URL(url);
    const data = JSON.stringify(body || {});
    const req = https.request({
      hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      family: 4, timeout: 15000
    }, (res) => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => { try { resolve(JSON.parse(chunks)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.write(data);
    req.end();
  });
}
async function send(chatId, text, extra = {}) {
  return tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
}
async function delMsg(chatId, messageId) {
  if (!messageId) return;
  return tg('deleteMessage', { chat_id: chatId, message_id: messageId });
}
async function answerCb(id, text) {
  return tg('answerCallbackQuery', { callback_query_id: id, text: text || '', show_alert: false });
}

/* ═══════════════ STORE ═══════════════ */
let users = loadJSON('users.json', {});
let sessions = {};
let predMsg = {};
let autoWatch = {};

function saveUsers() { saveJSON('users.json', users); }
function ensureUser(uid) {
  if (!users[uid]) users[uid] = { vipUntil: Date.now() + TRIAL_HOURS * 3600 * 1000 };
  return users[uid];
}
function isVip(uid) {
  if (isAdmin(uid)) return true;
  return Number(ensureUser(uid).vipUntil || 0) > Date.now();
}
function vipText(uid) {
  if (isAdmin(uid)) return { active: true, line: '👑 ADMIN (Vĩnh viễn)', expire: '♾️ Không giới hạn' };
  const u = ensureUser(uid);
  if (Number(u.vipUntil || 0) > Date.now()) {
    return { active: true, line: '💎 ĐÃ CÓ QUYỀN VIP', expire: '⏳ ' + new Date(u.vipUntil).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) };
  }
  return { active: false, line: '🔒 CHƯA CÓ QUYỀN', expire: '—' };
}
function grantVip(uid, hours) {
  const u = ensureUser(uid);
  const base = Math.max(Date.now(), Number(u.vipUntil || 0));
  u.vipUntil = base + hours * 3600 * 1000;
  saveUsers();
  return u.vipUntil;
}

/* ═══════════════ GAMES ═══════════════ */
const DEFAULT_GAMES = [
  // ===== TÀI XỈU =====
  { id: 'sunwin_tx', brand: 'sunwin', brandLabel: 'SUNWIN', variant: 'Tài Xỉu', url: 'https://well-summary-oclc-invisible.trycloudflare.com/api/tx', group: 'tx', enabled: true },
  { id: 'tik88_tx', brand: 'tik88', brandLabel: 'TIK88', variant: 'Tài Xỉu', url: 'https://get-enemies-got-copper.trycloudflare.com/api/txmd5', group: 'tx', enabled: true },
  { id: 'hitclub_tx', brand: 'hitclub', brandLabel: 'HITCLUB', variant: 'Tài Xỉu', url: 'https://apihitclubhihi.onrender.com/api/hitclub/hu', group: 'tx', enabled: true },
  { id: 'b52_tx', brand: 'b52', brandLabel: 'B52', variant: 'Tài Xỉu', url: 'https://apitaixiu-6jjn.onrender.com/api/ditmemayb52', group: 'tx', enabled: true },
  { id: 'max789_tx', brand: 'max789', brandLabel: 'MAX789', variant: 'Tài Xỉu', url: 'https://apitaixiu-6jjn.onrender.com/max789/tx', group: 'tx', enabled: true },
  { id: 'max789_kubet', brand: 'max789', brandLabel: 'MAX789', variant: 'Kubet Live', url: 'https://apitaixiu-6jjn.onrender.com/max789/kubet', group: 'tx', enabled: true },
  { id: 'lc79_tx', brand: 'lc79', brandLabel: 'LC79', variant: 'Tài Xỉu', url: 'https://apitaixiu-6jjn.onrender.com/lc79/tx', group: 'tx', enabled: true },
  { id: 'betvip_tx', brand: 'betvip', brandLabel: 'BETVIP', variant: 'Tài Xỉu', url: 'https://apitaixiu-6jjn.onrender.com/betvip/tx', group: 'tx', enabled: true },
  { id: 'xocdia88_tx', brand: 'xocdia88', brandLabel: 'XOCDIA88', variant: 'Tài Xỉu', url: 'https://apitaixiu-6jjn.onrender.com/xocdia88/tx', group: 'tx', enabled: true },
  { id: 'sumclub_tx', brand: 'sumclub', brandLabel: 'SUMCLUB', variant: 'Tài Xỉu', url: 'https://apitaixiu-6jjn.onrender.com/sumclub/tx', group: 'tx', enabled: true },
  { id: 'luck8_hu', brand: 'luck8', brandLabel: 'LUCK8', variant: 'Tài Xỉu Hũ', url: 'https://apitaixiu-6jjn.onrender.com/luck8-hu', group: 'tx', enabled: true },

  // ===== MD5 =====
  { id: 'hitclub_md5', brand: 'hitclub', brandLabel: 'HITCLUB', variant: 'MD5', url: 'https://apihitclubhihi.onrender.com/api/hitclub/md5', group: 'md5', enabled: true },
  { id: 'max789_md5', brand: 'max789', brandLabel: 'MAX789', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/max789/md5', group: 'md5', enabled: true },
  { id: 'lc79_md5', brand: 'lc79', brandLabel: 'LC79', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/lc79/md5', group: 'md5', enabled: true },
  { id: 'betvip_md5', brand: 'betvip', brandLabel: 'BETVIP', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/betvip/md5', group: 'md5', enabled: true },
  { id: 'xocdia88_md5', brand: 'xocdia88', brandLabel: 'XOCDIA88', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/xocdia88/md5', group: 'md5', enabled: true },
  { id: 'sumclub_md5', brand: 'sumclub', brandLabel: 'SUMCLUB', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/sumclub/md5', group: 'md5', enabled: true },
  { id: 'luck8_md5', brand: 'luck8', brandLabel: 'LUCK8', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/luck8-md5', group: 'md5', enabled: true },
  { id: '68gb_md5', brand: '68gb', brandLabel: '68GB', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/68gb/md5', group: 'md5', enabled: true },

  // ===== SICBO =====
  { id: 'sicbo_sunwin', brand: 'sunwin', brandLabel: 'SUNWIN', variant: 'Sicbo', url: 'https://apitaixiu-6jjn.onrender.com/api/sicbo/sunwin', group: 'sicbo', enabled: true },
  { id: 'sicbo_hitclub', brand: 'hitclub', brandLabel: 'HITCLUB', variant: 'Sicbo', url: 'https://apitaixiu-6jjn.onrender.com/api/sicbo/hitclub', group: 'sicbo', enabled: true },
  { id: 'sicbo_789', brand: '789club', brandLabel: '789CLUB', variant: 'Sicbo', url: 'https://apitaixiu-6jjn.onrender.com/api/sicbo/789', group: 'sicbo', enabled: true },
  { id: 'sicbo_b52', brand: 'b52', brandLabel: 'B52', variant: 'Sicbo', url: 'https://sicbob52-9zn5.onrender.com/api/sicbo/b52', group: 'sicbo', enabled: true }
];

let games = loadJSON('games.json', null);
if (!Array.isArray(games) || !games.length) games = DEFAULT_GAMES.map(g => ({ ...g }));

/* ═══════════════ SICBO ANALYZER ═══════════════ */
class SicboAnalyzer {
  constructor() { this.reset(); }
  reset() {
    this.diceFreq = [[0,0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0]];
    this.sums = {}; this.total = 0;
  }
  push(diceArr) {
    if (!Array.isArray(diceArr) || diceArr.length < 3) return false;
    const d = diceArr.slice(0, 3).map(x => {
      const n = Math.floor(Number(x));
      return (n >= 1 && n <= 6) ? n : 0;
    });
    if (d.some(x => !x)) return false;
    for (let i = 0; i < 3; i++) this.diceFreq[i][d[i] - 1]++;
    const sum = d[0] + d[1] + d[2];
    this.sums[sum] = (this.sums[sum] || 0) + 1;
    this.total++;
    return true;
  }
  guessDice(side) {
    const pool = side === 'T' ? [11,12,13,14,15,16,17] : [4,5,6,7,8,9,10];
    if (this.total < 10) return null;
    const topDice = this.diceFreq.map(freq => {
      return freq.map((count, val) => ({ val: val + 1, count }))
                 .sort((a, b) => b.count - a.count)
                 .map(x => x.val);
    });
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        for (let k = 0; k < 3; k++) {
          const d1 = topDice[0][i], d2 = topDice[1][j], d3 = topDice[2][k];
          if (pool.includes(d1 + d2 + d3)) return [d1, d2, d3].sort();
        }
      }
    }
    return null;
  }
}

/* ═══════════════ ENGINE v15.4 ═══════════════ */
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
    this.trend = 0;
    this.momentum = 0;
    this.recentPreds = [];
    this.transition = { TT: 0, TX: 0, XT: 0, XX: 0 };
  }

  push(side, sum, dice, session) {
    const s = side === 'T' ? 'T' : 'X';
    const n = this.history.length;

    if (n >= 1) {
      const prev = this.history[n - 1];
      const key = prev + s;
      if (this.transition[key] !== undefined) this.transition[key]++;
    }

    if (this.pending) {
      this.total++;
      const ok = this.pending === s;
      if (ok) this.correct++;

      this.recentPreds.push({ correct: ok, side: this.pending });
      if (this.recentPreds.length > 40) this.recentPreds.shift();

      this.log.push({
        session: session || '',
        pred: this.pending,
        actual: s,
        ok,
        conf: (this.pendingMeta && this.pendingMeta.conf) || 0,
        sum: Number(sum) || 0,
        dice: Array.isArray(dice) ? dice.map(Number) : [],
        time: nowVN()
      });
      if (this.log.length > 500) this.log.shift();

      this.pending = null;
      this.pendingMeta = null;
    }

    this.history.push(s);
    this.sums.push(Number(sum) || 10);
    if (dice && dice.length >= 3) {
      this.diceHist.push(dice.map(Number));
      this.sicbo.push(dice);
    }
    if (this.history.length > 600) {
      this.history.shift();
      this.sums.shift();
    }
    if (this.diceHist.length > 600) this.diceHist.shift();

    this._updateDerived();
  }

  _updateDerived() {
    const h = this.history;
    if (h.length < 8) return;
    const w20 = h.slice(-20);
    const t20 = w20.filter(x => x === 'T').length;
    this.trend = (t20 - (w20.length - t20)) / w20.length;
    if (h.length >= 15) {
      const w5 = h.slice(-5);
      const t5 = w5.filter(x => x === 'T').length / 5;
      this.momentum = t5 - (t20 / Math.max(w20.length, 1));
    }
  }

  predict() {
    const h = this.history;
    const n = h.length;

    if (n < 4) {
      const side = n && h[n - 1] === 'X' ? 'T' : 'X';
      const out = { side, conf: 53, vi: this._pickVi(side), streak: 0 };
      this.pending = side;
      this.pendingMeta = out;
      return out;
    }

    const last = h[n - 1];
    let streak = 1;
    for (let i = n - 2; i >= 0 && h[i] === last; i--) streak++;

    // Markov
    const totalFromT = (this.transition.TT + this.transition.TX) || 1;
    const totalFromX = (this.transition.XT + this.transition.XX) || 1;
    const pT_given_T = this.transition.TT / totalFromT;
    const pT_given_X = this.transition.XT / totalFromX;
    const markovScoreT = last === 'T' ? (pT_given_T - 0.5) * 2.8 : (pT_given_X - 0.5) * 2.8;

    let scoreT = 0, scoreX = 0;

    if (Math.abs(this.trend) > 0.12) {
      if (this.trend > 0) scoreT += this.trend * 4.2;
      else scoreX += Math.abs(this.trend) * 4.2;
    }
    if (Math.abs(this.momentum) > 0.12) {
      if (this.momentum > 0) scoreT += this.momentum * 3.4;
      else scoreX += Math.abs(this.momentum) * 3.4;
    }

    if (streak >= 2) {
      let sScore = Math.min(2.8, streak * 0.72);
      if (streak >= 6) sScore -= (streak - 5) * 0.55;
      if (streak >= 9) sScore -= 1.2;
      if (last === 'T') scoreT += sScore;
      else scoreX += sScore;
    }

    // Pattern
    const last6 = h.slice(-6).join('');
    const patterns = {
      'TXTTXT': 0.35, 'XTXTXT': 0.35,
      'TTXTTX': 0.28, 'XXTXXT': 0.28,
      'TXXTXX': 0.25, 'XTTXTT': 0.25,
      'TTTTTX': -0.45, 'XXXXXT': -0.45,
      'TTTTTT': -0.7,  'XXXXXX': -0.7
    };
    if (patterns[last6] !== undefined) {
      const val = patterns[last6];
      if (val > 0) {
        if (last6.endsWith('T')) scoreT += val;
        else scoreX += val;
      } else {
        if (last === 'T') scoreX += Math.abs(val);
        else scoreT += Math.abs(val);
      }
    }

    // Recent accuracy bias
    if (this.recentPreds.length >= 8) {
      const recent = this.recentPreds.slice(-12);
      const correctRate = recent.filter(p => p.correct).length / recent.length;
      if (correctRate < 0.42) {
        if (last === 'T') scoreX += 0.6;
        else scoreT += 0.6;
      } else if (correctRate > 0.68) {
        if (last === 'T') scoreT += 0.45;
        else scoreX += 0.45;
      }
    }

    scoreT += markovScoreT;
    scoreX -= markovScoreT;

    let netScore = scoreT - scoreX;
    const pT = 1 / (1 + Math.exp(-netScore * 1.65));
    let side = pT >= 0.5 ? 'T' : 'X';

    let conf = pT >= 0.5 ? pT * 100 : (1 - pT) * 100;

    if (this.recentPreds.length >= 3) {
      const last3 = this.recentPreds.slice(-3);
      if (last3.every(p => !p.correct)) conf -= 14;
      else if (last3.filter(p => !p.correct).length >= 2) conf -= 7;
    }
    if (this.recentPreds.length >= 4) {
      const last4 = this.recentPreds.slice(-4);
      if (last4.every(p => p.correct)) conf += 6;
    }

    if (n < 15) conf = Math.min(conf, 68);
    if (n < 25) conf = Math.min(conf, 78);

    conf = Math.max(53, Math.min(96, Math.round(conf)));

    if (Math.abs(pT - 0.5) < 0.04 && streak >= 4) {
      side = last === 'T' ? 'X' : 'T';
      conf = Math.min(conf, 61);
    }

    const vi = this._pickVi(side);
    const out = { side, conf, vi, streak };
    this.pending = side;
    this.pendingMeta = out;
    return out;
  }

  _pickVi(side) {
    // Trả về 3 tổng điểm có khả năng cao (không phải 3 xúc xắc)
    // Tài: 11-17 | Xỉu: 4-10
    const isTai = side === 'T';
    const pool = isTai ? [11, 12, 13, 14, 15, 16, 17] : [4, 5, 6, 7, 8, 9, 10];

    // Ưu tiên các tổng xuất hiện nhiều trong history
    const freq = {};
    for (const s of this.sums.slice(-80)) {
      if (pool.includes(s)) freq[s] = (freq[s] || 0) + 1;
    }
    const sorted = Object.keys(freq)
      .map(Number)
      .sort((a, b) => (freq[b] || 0) - (freq[a] || 0));

    if (sorted.length >= 3) return sorted.slice(0, 3);

    // Fallback preset đẹp
    const presetsT = [
      [11, 12, 15], [12, 13, 14], [11, 14, 16], [12, 15, 16],
      [13, 14, 15], [11, 13, 17], [12, 14, 15]
    ];
    const presetsX = [
      [4, 6, 8], [5, 6, 7], [4, 5, 9], [6, 7, 8],
      [5, 7, 9], [4, 7, 10], [5, 8, 9]
    ];
    const arr = isTai ? presetsT : presetsX;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  accuracy() {
    return !this.total ? 0 : Math.round((this.correct / this.total) * 100);
  }
}

/* ═══════════════ FEEDS & POLLING ═══════════════ */
const FEEDS = {};
for (const g of games) FEEDS[g.id] = { id: g.id, engine: new Engine(g.id), lastSession: null, lastLive: null, lastError: null, lastPred: null };

function parseHistoryArray(json) {
  if (!json) return [];
  let arr = [];
  if (json.Lich_su && Array.isArray(json.Lich_su)) arr = json.Lich_su;
  else if (json.history && Array.isArray(json.history)) arr = json.history;
  else if (Array.isArray(json)) arr = json;
  else if (json.data && Array.isArray(json.data)) arr = json.data;
  else if (json.data && typeof json.data === 'object') arr = [json.data];
  else arr = [json];

  const out = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const getVal = (obj, keys) => {
      for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
      const lower = keys.map(k => k.toLowerCase());
      for (const key of Object.keys(obj)) if (lower.includes(key.toLowerCase())) return obj[key];
      return null;
    };

    const phien = getVal(item, ['Phien', 'phien', 'session', 'id']);
    if (phien == null) continue;

    let ket = getVal(item, ['Ket_qua', 'result', 'kq']) || '';
    try { ket = decodeURIComponent(ket); } catch {}

    const dArr = getVal(item, ['xuc_xac', 'dice']);
    let d1=0, d2=0, d3=0;
    if (Array.isArray(dArr) && dArr.length >= 3) {
      d1 = Number(dArr[0])||0; d2 = Number(dArr[1])||0; d3 = Number(dArr[2])||0;
    } else {
      d1 = Number(getVal(item, ['Xuc_xac_1', 'dice1']))||0;
      d2 = Number(getVal(item, ['Xuc_xac_2', 'dice2']))||0;
      d3 = Number(getVal(item, ['Xuc_xac_3', 'dice3']))||0;
    }

    let sum = Number(getVal(item, ['Tong', 'total']));
    if (!Number.isFinite(sum) || sum <= 0) sum = d1 + d2 + d3;

    const k = String(ket).toLowerCase();
    let side = 'X';
    if (k.includes('tài') || k === 't') side = 'T';
    else if (k.includes('xỉu') || k === 'x') side = 'X';
    else if (sum > 0) side = sum >= 11 ? 'T' : 'X';

    out.push({ session: String(phien), side, sum, dice: [d1, d2, d3] });
  }
  return out.sort((a,b) => Number(a.session) - Number(b.session));
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.json();
}

async function pollGame(g) {
  const f = FEEDS[g.id];
  if (!f || !g.enabled || !g.url) return;
  try {
    const raw = await fetchJson(g.url);
    const historyArr = parseHistoryArray(raw);
    if (!historyArr.length) throw new Error('empty');

    let added = 0;
    for (const live of historyArr) {
      if (live.session && live.session !== f.lastSession) {
        f.engine.push(live.side, live.sum, live.dice, live.session);
        f.lastSession = live.session; f.lastLive = live; added++;
      }
    }
    if (added > 0 || !f.lastPred) f.lastPred = f.engine.predict();
    f.lastError = null;
  } catch (e) { f.lastError = e.message; }
}

setInterval(() => Promise.all(games.map(pollGame)), POLL_MS);
setTimeout(() => Promise.all(games.map(pollGame)), 1500);

/* ═══════════════ LC79 AUTO-BET ═══════════════ */
const LC79 = { sessions: {}, MIN_CONF: 55, MAX_MARTINGALE: 6, MARTINGALE_MULT: 2 };

async function lc79Fetch(url, timeout = 15000, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal, method: opts.method || 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0', ...(opts.headers || {}) },
      body: opts.body
    });
    clearTimeout(t);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) { clearTimeout(t); throw e; }
}

async function lc79Login(username, password) {
  const md5 = crypto.createHash('md5').update(password).digest('hex');
  const r1 = await lc79Fetch(`https://apifo88daigia.tele68.com/api?c=3&un=${encodeURIComponent(username)}&pw=${md5}&cp=R&cl=R&pf=web&at=`);
  if (!r1 || !r1.success) throw new Error('Sai tài khoản / mật khẩu');
  const sk = r1.sessionKey + '='.repeat((4 - r1.sessionKey.length % 4) % 4);
  const nickname = JSON.parse(Buffer.from(sk, 'base64').toString()).nickname;
  const r2 = await lc79Fetch('https://wlb.tele68.com/v1/lobby/auth/login?cp=R&cl=R&pf=web&at=', 15000, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickName: nickname, accessToken: r1.accessToken })
  });
  if (!r2 || !r2.token) throw new Error('Không nhận được token');
  return { token: r2.token, nickname, money: (r2.remoteLoginResp && r2.remoteLoginResp.money) || 0 };
}

async function lc79LoadHistory(limit = 100) {
  try {
    const r = await lc79Fetch('https://wtxmd52.tele68.com/v1/txmd5/sessions', 12000);
    if (!r || !Array.isArray(r.list)) return [];
    const arr = r.list.slice().sort((a, b) => a.id - b.id);
    const out = [];
    for (const it of arr) {
      const kq = it.resultTruyenThong;
      if (kq !== 'TAI' && kq !== 'XIU') continue;
      const dice = Array.isArray(it.dices) ? it.dices : [0, 0, 0];
      out.push({ session: String(it.id), side: kq === 'TAI' ? 'T' : 'X', sum: Number(it.point) || dice.reduce((a, b) => a + b, 0), dice });
    }
    return out.slice(-limit);
  } catch { return []; }
}

function lc79BetAmount(uid) {
  const s = LC79.sessions[uid];
  if (!s) return 0;
  if (!s.martingale) return s.baseBet;
  return s.baseBet * Math.pow(LC79.MARTINGALE_MULT, Math.min(s.martingaleLevel, LC79.MAX_MARTINGALE));
}

function lc79Stop(uid, silent) {
  const s = LC79.sessions[uid];
  if (!s) return;
  try { s.socket && s.socket.disconnect(); } catch {}
  delete LC79.sessions[uid];
  if (!silent && s.chatId) {
    send(s.chatId, '⏹ <b>Đã ngắt kết nối LC79 & đăng xuất</b>', { reply_markup: { inline_keyboard: [[{ text: '🏠 VỀ MENU', callback_data: 'menu' }]] } });
  }
}

async function lc79Connect(uid, chatId, data) {
  lc79Stop(uid, true);
  const engine = new Engine('lc79_' + uid);
  const history = await lc79LoadHistory(100);
  for (const h of history) engine.push(h.side, h.sum, h.dice, h.session);
  engine.pending = null; engine.pendingMeta = null;

  const s = { uid, chatId, token: data.token, nickname: data.nickname, balance: data.money, engine, socket: null, autoBet: false, martingale: false, martingaleLevel: 0, baseBet: 10000, stopLoss: 0, stopWin: 0, profit: 0, wins: 0, losses: 0, currentPred: null, currentConf: 0, currentSession: null, hasBet: false, history: [] };
  LC79.sessions[uid] = s;

  const socket = io('https://wtxmd52.tele68.com', {
    path: '/txmd5/', transports: ['websocket'], auth: { token: data.token },
    extraHeaders: { 'User-Agent': 'Mozilla/5.0', 'Origin': 'https://lc79b.bet' },
    reconnection: true, reconnectionAttempts: 99999, reconnectionDelay: 3000
  });
  s.socket = socket;

  socket.on('connect', () => {
    send(chatId, `✅ <b>KẾT NỐI LC79 THÀNH CÔNG</b>\n📛 TK: <b>${esc(s.nickname)}</b>\n💰 Dư: <b>${fmt(s.balance)}</b>`, { reply_markup: { inline_keyboard: [[{ text: '⚙️ MỞ BẢNG ĐIỀU KHIỂN', callback_data: 'lc79:menu' }]] } });
  });

  socket.on('new-session', (d) => {
    const st = LC79.sessions[uid]; if (!st) return;
    st.currentSession = String(d.id); st.hasBet = false; st.currentPred = null; st.currentConf = 0;
    const p = st.engine.predict();
    st.currentPred = p.side; st.currentConf = p.conf;
    send(chatId, `💎 <b>PHIÊN #${esc(d.id)}</b>\n${p.side === 'T' ? '🔴 TÀI' : '🔵 XỈU'} • Độ tin: ${p.conf}%`, { reply_markup: { inline_keyboard: [[{ text: '⚙️ ĐIỀU KHIỂN', callback_data: 'lc79:menu' }]] } });
  });

  socket.on('tick-update', (d) => {
    const st = LC79.sessions[uid]; if (!st) return;
    if (d.state !== 'BETTING' || !st.autoBet || !st.currentPred || st.hasBet || st.currentConf < LC79.MIN_CONF) return;
    const amount = lc79BetAmount(uid);
    try {
      const betType = st.currentPred === 'T' ? 'TAI' : 'XIU';
      socket.emit('bet', { type: betType, amount });
      st.hasBet = true;
      send(chatId, `🚀 <b>ĐẶT CƯỢC</b> • ${betType} • ${fmt(amount)}`);
    } catch {}
  });

  socket.on('session-result', (d) => {
    const st = LC79.sessions[uid]; if (!st) return;
    const kq = d.resultTruyenThong; if (kq !== 'TAI' && kq !== 'XIU') return;
    const side = kq === 'TAI' ? 'T' : 'X'; const dice = Array.isArray(d.dices) ? d.dices : [];
    st.engine.push(side, dice.reduce((a, b) => a + b, 0), dice, String(d.id));

    if (st.currentPred) {
      const win = st.currentPred === side; const bet = lc79BetAmount(uid);
      if (win) { st.wins++; st.profit += bet; st.martingaleLevel = 0; }
      else { st.losses++; st.profit -= bet; if (st.martingale && st.martingaleLevel < LC79.MAX_MARTINGALE) st.martingaleLevel++; }
      
      send(chatId, `🎲 KQ: ${kq} • ${win ? '✅ THẮNG' : '❌ THUA'}\n💵 Lợi nhuận: <b>${st.profit >= 0 ? '+' : ''}${fmt(st.profit)}</b>`);

      if (st.autoBet && st.stopLoss > 0 && st.profit <= -st.stopLoss) { st.autoBet = false; send(chatId, '🛑 <b>CHẠM STOP LOSS!</b> Auto TẮT.'); }
      else if (st.autoBet && st.stopWin > 0 && st.profit >= st.stopWin) { st.autoBet = false; send(chatId, '🏆 <b>CHẠM STOP WIN!</b> Auto TẮT.'); }
    }
  });
}

/* ═══════════════ HASH PREDICTOR ═══════════════ */
function predictHash(hashStr) {
  const str = hashStr.toLowerCase();
  let sum = 0;
  for (let i = 0; i < str.length; i++) sum += str.charCodeAt(i) * (i + 1);
  const pseudo = (sum * 9301 + 49297) % 233280 / 233280;
  const side = pseudo >= 0.5 ? 'T' : 'X';
  const conf = Math.round(55 + Math.abs(pseudo - 0.5) * 80);
  const reason = pseudo >= 0.5 ? '🔴 Hash nghiêng Tài' : '🔵 Hash nghiêng Xỉu';
  return { side, conf, reason };
}

/* ═══════════════ EXPORT HISTORY (TELEGRAM) ═══════════════ */
async function exportHistory(chatId, gameId) {
  const g = games.find(x => x.id === gameId);
  const f = FEEDS[gameId];
  if (!g || !f) return send(chatId, '❌ Không tìm thấy bàn.');
  const eng = f.engine;
  // Chỉ lấy phiên đã có dự đoán (có pred + đã có kết quả)
  let logs = eng.log.filter(l => l.pred != null && (l.ok === true || l.ok === false)).slice(-20).reverse();

  if (!logs.length) return send(chatId, `📭 <b>Chưa có phiên nào đã dự đoán</b>\n⏳ Đợi tool dự đoán thêm vài phiên.`);

  const lines = [];
  lines.push(`📜 <b>LỊCH SỬ ĐÃ DỰ ĐOÁN — ${esc(g.brandLabel)}</b>`);
  lines.push(`━━━━━━━━━━━━━━━`);
  lines.push(`⏰ ${nowVN()}`);
  lines.push(`📈 Độ chuẩn: <b>${eng.accuracy()}%</b> (${eng.correct}/${eng.total})`);
  lines.push(`━━━━━━━━━━━━━━━`);

  for (const log of logs) {
    const sess = String(log.session || '—').slice(-6);
    const predSide = log.pred === 'T' ? 'TÀI' : 'XỈU';
    const actSide = log.actual === 'T' ? 'TÀI' : 'XỈU';
    const okStr = log.ok ? '✅ ĐÚNG' : '❌ SAI';
    lines.push(`<code>#${esc(sess)}</code> Dự <b>${predSide}</b> → KQ <b>${actSide}</b> ${okStr}`);
  }

  await send(chatId, lines.join('\n'), kb([
    [btn('🔄 LÀM MỚI', 'predhist:' + gameId, 'success')],
    [btn('◀️ QUAY LẠI', 'pred:' + gameId, 'primary'), btn('🏠 VỀ MENU', 'menu', 'danger')]
  ]));
}

/* ═══════════════ BOT TELEGRAM UI ═══════════════ */
function kb(rows) { return { reply_markup: { inline_keyboard: rows } }; }
function btn(text, data, style) { return { text, callback_data: data, style }; }
function btnUrl(text, url, style) { return { text, url, style }; }

async function showUserMenu(chatId, from) {
  const uid = uidOf(from);
  const v = vipText(uid);
  const text = `🔥 <b>TOOL HTUNGG v15.8</b>\n<i>Soi cầu Tài Xỉu real-time</i>\n\n👤 <b>${esc(displayName(from))}</b>\n🆔 <code>${uid}</code>\n💎 ${v.line}\n⏳ ${v.expire}\n\n👇 Chọn chức năng:`;

  const rows = [
    [btn('🎯 VÀO SOI CẦU NGAY', 'pred:brands', 'primary')],
    [btn('🧩 TOOL HASH MD5/SHA256', 'hash:start', 'success')],
    [btnUrl('🙋 GỌI ADMIN XIN QUYỀN', 'https://t.me/SunNetWin', 'success')]
  ];
  if (isAdmin(uid)) rows.push([btn('🛠 BẢNG ĐIỀU KHIỂN ADMIN', 'adm:home', 'danger')]);
  return send(chatId, text, kb(rows));
}

async function showBrandMenu(chatId) {
  const brands = [
    ['sunwin', 'Sunwin'], ['789club', '789 Club'], ['b52', 'B52'], ['hitclub', 'Hitclub'],
    ['xocdia88', 'Xóc Đĩa 88'], ['max789', 'Max789'], ['lc79', 'LC79'], ['betvip', 'Betvip'],
    ['sumclub', 'Sumclub'], ['luck8', 'Luck8'], ['tik88', 'TIK88'], ['68gb', '68GB Bàn Xanh']
  ];
  const rows = []; let row = [];
  for (let i = 0; i < brands.length; i++) {
    row.push(btn(`🎲 ${brands[i][1]}`, 'predbrand:' + brands[i][0], 'primary'));
    if (row.length === 2) { rows.push(row); row = []; }
  }
  if (row.length) rows.push(row);
  rows.push([btn('🏠 VỀ MENU', 'menu', 'danger')]);
  return send(chatId, '📊 <b>TX • DANH SÁCH SÀNH</b>\n\n👇 Chọn sàn muốn xem phiên:', kb(rows));
}

async function showTables(chatId, brand, uid) {
  if (!isVip(uid)) return send(chatId, '🔒 Cần VIP để xem.');
  const list = games.filter(g => String(g.brand).toLowerCase() === String(brand).toLowerCase());
  if (!list.length) return send(chatId, '📭 Sòng này éo có bàn nào.', kb([[btn('◀️ QUAY LẠI', 'pred:brands', 'primary')]]));

  const rows = []; let row = []; let t = true;
  for (const g of list) {
    const f = FEEDS[g.id], bad = !g.url || g.enabled === false || (f && f.lastError);
    row.push(btn(`${bad ? '🔴' : '🟢'} ${g.variant}`, bad ? 'pred:off:' + g.id : 'pred:' + g.id, bad ? 'danger' : (t ? 'success' : 'primary')));
    t = !t;
    if (row.length === 2) { rows.push(row); row = []; }
  }
  if (row.length) rows.push(row);
  rows.push([btn('◀️ CHỌN SÀNH KHÁC', 'pred:brands', 'primary'), btn('🏠 VỀ MENU', 'menu', 'danger')]);
  return send(chatId, `🎰 <b>SÀNH ${esc(brand.toUpperCase())}</b>\n👇 Chọn bàn mà cày:`, kb(rows));
}

async function pushPredCard(chatId, gameId, uid, fromAuto) {
  if (!isVip(uid)) return send(chatId, '🔒 Cần VIP.');
  const g = games.find(x => x.id === gameId), f = FEEDS[gameId];
  if (!g || !f || !f.lastPred) return;
  const p = f.lastPred;
  const live = f.lastLive || {};
  const acc = f.engine.accuracy();
  const nextSess = live.session ? String(Number(live.session) + 1) : '—';
  const prevSess = live.session ? String(live.session) : '—';

  // Kết quả phiên trước
  let prevLine = '';
  const lastLog = f.engine.log.length ? f.engine.log[f.engine.log.length - 1] : null;
  if (lastLog) {
    const prevPred = lastLog.pred === 'T' ? 'TÀI' : 'XỈU';
    const prevActual = lastLog.actual === 'T' ? 'TÀI' : 'XỈU';
    const prevIcon = lastLog.ok ? '✅ ĐÚNG' : '❌ SAI';
    prevLine = `📋 Phiên #${esc(String(lastLog.session || prevSess).slice(-6))}: Dự <b>${prevPred}</b> → KQ <b>${prevActual}</b> ${prevIcon}\n`;
  }

  const sideTxt = p.side === 'T' ? '🔴 TÀI' : '🔵 XỈU';
  const viTxt = (p.vi && Array.isArray(p.vi)) ? p.vi.join('-') : '—';
  const text = `${fromAuto ? '🔄 <i>Auto update...</i>\n' : ''}<b>${g.brandLabel} • ${g.variant}</b>\n━━━━━━━━━━━━━━━\n${prevLine}📦 Phiên mới: <code>#${nextSess}</code>\n🎯 Dự đoán: <b>${sideTxt}</b>\n🎲 Vị: <b>${viTxt}</b>\n📊 Độ tin: <b>${p.conf}%</b>\n━━━━━━━━━━━━━━━\n📊 Cầu: ${cauStr(f.engine.history, 20, g) || '—'}\n📈 Chuẩn: <b>${acc}%</b> (${f.engine.correct}/${f.engine.total})`;

  const rows = [
    [btn('🔄 LÀM MỚI', 'pred:' + gameId, 'success'), btn('📜 LỊCH SỬ', 'predhist:' + gameId, 'primary')],
    [btn('⏹ DỪNG', 'pred:stop:' + g.id, 'danger')],
    [btn('🎲 ĐỔI GAME', 'pred:brands', 'primary')]
  ];

  const key = uid + ':' + gameId;
  if (predMsg[key]) await delMsg(chatId, predMsg[key]);
  const sent = await send(chatId, text, kb(rows));
  if (sent && sent.result) predMsg[key] = sent.result.message_id;
}

// TX / MD5: ● đen = Tài, ○ trắng = Xỉu
// Sicbo: 🔴 đỏ = Tài, 🔵 xanh = Xỉu
function cauStr(h, n = 20, g = null) {
  const isSicbo = g && (g.group === 'sicbo' || String(g.variant || '').toLowerCase().includes('sicbo'));
  return h.slice(-n).map(x => {
    if (isSicbo) return x === 'T' ? '🔴' : '🔵';
    return x === 'T' ? '●' : '○';
  }).join('');
}
function isSicboGame(g) { return g.group === 'sicbo' || String(g.variant).includes('Sicbo'); }

function stopAuto(uid) { if (autoWatch[uid]) { clearInterval(autoWatch[uid]); delete autoWatch[uid]; } }
function startAuto(uid, chatId, gameId) {
  stopAuto(uid);
  autoWatch[uid] = setInterval(async () => {
    const g = games.find(x => x.id === gameId), f = FEEDS[gameId];
    if (!g || !f) return;
    await pollGame(g);
    if (f.lastLive && f.lastLive.session !== f.lastShown) {
      f.lastShown = f.lastLive.session;
      await pushPredCard(chatId, gameId, uid, true);
    }
  }, 5000);
}

async function showLc79Menu(chatId, uid) {
  const s = LC79.sessions[uid];
  if (!s) return send(chatId, '🤖 AUTO CƯỢC LC79\n🔐 Chưa đăng nhập\nGõ /login hoặc bấm nút:', kb([[btn('🔐 ĐĂNG NHẬP', 'lc79:login', 'success')]]));
  return send(chatId, `🤖 <b>AUTO CƯỢC LC79</b>\n📛 ${s.nickname} • 💰 ${fmt(s.balance)}\n⚡ Auto: ${s.autoBet ? '🟢 BẬT' : '🔴 TẮT'}`, kb([
    [btn(s.autoBet ? '🔴 TẮT AUTO' : '🟢 BẬT AUTO', 'lc79:auto', s.autoBet ? 'danger' : 'success')],
    [btn('⏹ THOÁT', 'lc79:stop', 'danger')]
  ]));
}

async function showHashTool(chatId) {
  return send(chatId, `🧩 <b>TOOL HASH MD5/SHA256</b> 🧩\n\n😎 Bố mày sẽ đọc mã Hash của mày và phân tích xem nên đập Tài hay Xỉu.\n\n👉 <i>Hãy nhắn (gửi) mã Hash vào đây:</i>\n(MD5 dài 32 ký tự, SHA256 dài 64 ký tự)\n\n💡 Gửi liên tục nhiều mã đều được, không cần bấm nút!`,
  kb([[btn('🏠 THOÁT TOOL HASH', 'menu', 'danger')]]));
}

async function showAdmin(chatId) {
  const activeVip = Object.values(users).filter(u => u.vipUntil > Date.now()).length;
  return send(chatId, `🛠 <b>BẢNG ĐIỀU KHIỂN ADMIN</b>\n\n👥 <b>Tổng users:</b> ${Object.keys(users).length}\n💎 <b>VIP active:</b> ${activeVip}\n🤖 <b>LC79 active:</b> ${Object.keys(LC79.sessions).length}\n\n💡 <i>Cấp quyền:</i> <code>/grant ID Số_Giờ</code>`,
  kb([[btn('👤 VỀ MENU USER', 'menu', 'danger')]]));
}

/* ═══════════════ CALLBACKS & MESSAGES ═══════════════ */
async function onCallback(cq) {
  const chatId = cq.message.chat.id, msgId = cq.message.message_id;
  const from = cq.from, uid = uidOf(from), data = String(cq.data || '');
  await delMsg(chatId, msgId);
  await answerCb(cq.id);

  if (data === 'menu') { stopAuto(uid); delete sessions[uid]; return showUserMenu(chatId, from); }
  if (data === 'hash:start') { sessions[uid] = { await: 'hash_input' }; return showHashTool(chatId); }
  if (data === 'adm:home' && isAdmin(uid)) return showAdmin(chatId);
  if (data === 'pred:brands') { stopAuto(uid); return showBrandMenu(chatId); }
  if (data.startsWith('predbrand:')) { stopAuto(uid); return showTables(chatId, data.slice(10), uid); }
  if (data.startsWith('predhist:')) return exportHistory(chatId, data.slice(9));
  
  if (data.startsWith('pred:')) {
    const gameId = data.slice(5);
    if (gameId === 'brands') return;
    if (gameId.startsWith('stop:')) { stopAuto(uid); return send(chatId, '⏹ Đã dừng cập nhật.'); }
    const g = games.find(x => x.id === gameId);
    if (!g) return;
    const load = await send(chatId, '⏳ Đang lấy dữ liệu...');
    await pollGame(g);
    await delMsg(chatId, load.result.message_id);
    startAuto(uid, chatId, gameId);
    return pushPredCard(chatId, gameId, uid, true);
  }
  
  if (data.startsWith('lc79:')) {
    return send(chatId, '⏹ Tính năng Auto cược LC79 đã được tắt.');
  }
}

async function onMessage(msg) {
  if (!msg || !msg.chat) return;
  const chatId = msg.chat.id, from = msg.from, uid = uidOf(from), text = (msg.text || '').trim();

  if (text === '/start' || text === '/menu') {
    ensureUser(uid); saveUsers(); delete sessions[uid];
    return showUserMenu(chatId, from);
  }
  if (text === '/admin' && isAdmin(uid)) return showAdmin(chatId);
  if (text === '/stop') {
    stopAuto(uid);
    return send(chatId, '⏹ <b>Đã dừng tất cả hoạt động.</b>');
  }
  if (text.startsWith('/grant ') && isAdmin(uid)) {
    const parts = text.split(/\s+/);
    if (parts.length >= 3) {
      const targetUid = parts[1], hours = Number(parts[2]);
      if (hours > 0) {
        grantVip(targetUid, hours);
        send(chatId, `✅ Đã cấp <b>${hours}h</b> cho user <code>${targetUid}</code>`);
        send(targetUid, `🎉 <b>CHÚC MỪNG!</b>\nBố mày đã ban phát <b>${hours} giờ VIP</b>.\nHạn dùng: <b>${vipText(targetUid).expire}</b>`);
      }
    } else send(chatId, '⚠️ Cú pháp: <code>/grant ID Số_Giờ</code>');
    return;
  }

  const st = sessions[uid];
  if (st) {
    if (st.await === 'hash_input') {
      const hashStr = text.toLowerCase();
      if (!/^[a-f0-9]{32}$/.test(hashStr) && !/^[a-f0-9]{64}$/.test(hashStr)) {
        return send(chatId, '❌ <b>MÃ HASH ĐÉO HỢP LỆ!</b>\nYêu cầu MD5 (32) hoặc SHA256 (64).');
      }
      const type = hashStr.length === 32 ? 'MD5' : 'SHA256';
      const pred = predictHash(hashStr);
      const sideTxt = pred.side === 'T' ? 'TÀI' : 'XỈU';
      const sideIcon = pred.side === 'T' ? '🔴' : '🔵';
      const filled = Math.max(0, Math.min(10, Math.round((pred.conf || 52) / 10)));
      const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
      return send(chatId, `🧩 <b>KẾT QUẢ PHÂN TÍCH ${type}</b>\n\n🔑 <b>Hash:</b> <code>${esc(hashStr)}</code>\n\n🎯 <b>DỰ ĐOÁN:</b> ${sideIcon} <b>${sideTxt}</b>\n⚡ <b>Tỉ lệ nổ:</b> <b>${pred.conf}%</b>\n<code>${bar}</code>\n💡 <b>Phân tích:</b> ${esc(pred.reason)}\n\n👇 <i>Gửi tiếp mã mới để phân tích tiếp:</i>`,
      kb([[btn('🏠 THOÁT TOOL HASH', 'menu', 'danger')]]));
    }

    if (st.await === 'lc79_user' || st.await === 'lc79_pass') {
      delete sessions[uid];
      return send(chatId, '⏹ Tính năng Auto cược LC79 đã được tắt.');
    }
  }
}

/* ═══════════════ WEB SERVER (INDEX Ở NGOÀI) ═══════════════ */
const app = express();
app.use(cors());
app.use(express.json());

// Trả file index.html ở thư mục gốc
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Các API cho Web
app.get('/api/games', (req, res) => {
  const list = games.map(g => {
    const f = FEEDS[g.id], p = f.lastPred || {};
    return { id: g.id, name: `${g.brandLabel} - ${g.variant}`, group: g.group, pred: p.side ? (p.side === 'T' ? 'TÀI' : 'XỈU') : 'Đang lấy...', conf: p.conf || 0, acc: f.engine.accuracy() };
  });
  res.json({ games: list });
});

app.post('/api/data', (req, res) => {
  const { apiId } = req.body;
  const g = games.find(x => x.id === apiId), feed = FEEDS[apiId];
  if (!g || !feed) return res.json({ rows: [] });
  const eng = feed.engine, rows = [];
  // Phiên đang chờ (có dự đoán, chưa có KQ)
  if (eng.pending && feed.lastLive) {
    const predTxt = eng.pending === 'T' ? 'Tài' : 'Xỉu';
    rows.push({ isNext: true, game: g.brandLabel, phien: String(Number(feed.lastLive.session) + 1), time: nowVN(), prediction: predTxt, result: 'Chờ...', verify: '...' });
  }
  // Chỉ lấy phiên đã có dự đoán + đã có kết quả ĐÚNG/SAI
  const logs = eng.log
    .filter(l => l.pred != null && (l.ok === true || l.ok === false))
    .slice(-20)
    .reverse();
  for (const log of logs) {
    const predTxt = log.pred === 'T' ? 'Tài' : 'Xỉu';
    const resTxt = log.actual === 'T' ? 'Tài' : 'Xỉu';
    const verifyTxt = log.ok ? 'ĐÚNG' : 'SAI';
    rows.push({ game: g.brandLabel, phien: log.session || '---', time: log.time, prediction: predTxt, result: resTxt, verify: verifyTxt, isCorrect: log.ok });
  }
  res.json({ rows });
});

app.post('/reset-learn', (req, res) => {
  const { apiId } = req.body;
  if (FEEDS[apiId]) { FEEDS[apiId].engine = new Engine(apiId); FEEDS[apiId].lastSession = null; }
  res.json({ ok: true });
});

app.get('/health', (_, res) => res.json({ ok: true, bot: 'HTUNGG v15.8 TX', games: games.length }));

app.listen(PORT, '0.0.0.0', () => {
  console.log('🔥 TOOL HTUNGG FULL running on port', PORT);
});

/* ═══════════════ TELEGRAM POLLING ═══════════════ */
let offset = 0;
async function loop() {
  if (!BOT_TOKEN) return;
  try {
    const j = await tg('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
    if (j && j.result) {
      for (const u of j.result) {
        offset = u.update_id + 1;
        try {
          if (u.callback_query) await onCallback(u.callback_query);
          else if (u.message) await onMessage(u.message);
        } catch (e) { console.error(e); }
      }
    }
  } catch (e) { await new Promise(r => setTimeout(r, 2000)); }
  setImmediate(loop);
}
loop();