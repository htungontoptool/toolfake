/**
 * DUDOANTX — TOOL SOI CẦU CHIẾN THẦN (v10 - Hash & Probability)
 */
'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const dns = require('dns');

// Fix IPv6
try { dns.setDefaultResultOrder('ipv4first'); } catch (e) {}

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

const PORT = Number(process.env.PORT) || 10000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_IDS = String(process.env.TELEGRAM_ADMIN_IDS || process.env.ADMIN_IDS || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.WEB_URL || '').replace(/\/$/, '');
const POLL_MS = Number(process.env.POLL_MS || 5000);

const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

/* ───────── Helpers ───────── */
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
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
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
    const options = {
      hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      family: 4, timeout: 15000
    };
    const req = https.request(options, (res) => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => { try { resolve(JSON.parse(chunks)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
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

/* ───────── Store ───────── */
const DEFAULT_CFG = { supportUrl: 'https://t.me/SunNetWin' };
let cfg = Object.assign({}, DEFAULT_CFG, loadJSON('config.json', {}));

let users = loadJSON('users.json', {});
let sessions = {};
let predMsg = {};
let autoWatch = {};
let hashFeedback = loadJSON('hashfeedback.json', {});

function saveUsers() { saveJSON('users.json', users); }
function saveFeedback() { saveJSON('hashfeedback.json', hashFeedback); }
function ensureUser(uid) {
  if (!users[uid]) users[uid] = { vipUntil: 0 };
  return users[uid];
}
function isVip(uid) {
  if (isAdmin(uid)) return true;
  const u = ensureUser(uid);
  return Number(u.vipUntil || 0) > Date.now();
}
function vipText(uid) {
  if (isAdmin(uid)) return { active: true, line: '👑 BỐ MÀY LÀ ADMIN (Vĩnh viễn)', expire: 'Không giới hạn' };
  const u = ensureUser(uid);
  if (Number(u.vipUntil || 0) > Date.now()) {
    return { active: true, line: '💎 ĐÃ CÓ QUYỀN', expire: new Date(u.vipUntil).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) };
  }
  return { active: false, line: '🔒 ĐÉO CÓ QUYỀN DÙNG', expire: '—' };
}
function grantVip(uid, hours) {
  const u = ensureUser(uid);
  const base = Math.max(Date.now(), Number(u.vipUntil || 0));
  u.vipUntil = base + hours * 3600 * 1000;
  saveUsers();
  return u.vipUntil;
}

/* ───────── Games (Thêm TIK88, update SUNWIN) ───────── */
const DEFAULT_GAMES = [
  { id: 'sunwin_tx', brand: 'sunwin', brandLabel: 'SUNWIN', variant: 'Tài Xỉu', url: 'https://well-summary-oclc-invisible.trycloudflare.com/api/tx', group: 'tx', enabled: true },
  { id: 'sicbo_sunwin', brand: 'sunwin', brandLabel: 'SUNWIN', variant: 'Sicbo', url: 'https://apitaixiu-6jjn.onrender.com/api/sicbo/sunwin', group: 'sicbo', enabled: true },
  
  { id: 'tik88_tx', brand: 'tik88', brandLabel: 'TIK88', variant: 'Tài Xỉu', url: 'https://get-enemies-got-copper.trycloudflare.com/api/txmd5', group: 'tx', enabled: true },
  
  { id: 'hitclub_tx', brand: 'hitclub', brandLabel: 'HITCLUB', variant: 'Tài Xỉu', url: 'https://apihitclubhihi.onrender.com/api/hitclub/hu', group: 'tx', enabled: true },
  { id: 'sicbo_hitclub', brand: 'hitclub', brandLabel: 'HITCLUB', variant: 'Sicbo', url: 'https://apitaixiu-6jjn.onrender.com/api/sicbo/hitclub', group: 'sicbo', enabled: true },
  
  { id: 'max789_tx', brand: 'max789', brandLabel: 'MAX789', variant: 'Tài Xỉu', url: 'https://apitaixiu-6jjn.onrender.com/max789/tx', group: 'tx', enabled: true },
  { id: 'max789_md5', brand: 'max789', brandLabel: 'MAX789', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/max789/md5', group: 'md5', enabled: true },
  { id: 'max789_kubet', brand: 'max789', brandLabel: 'MAX789', variant: 'Kubet Live', url: 'https://apitaixiu-6jjn.onrender.com/max789/kubet', group: 'tx', enabled: true },
  
  { id: 'lc79_tx', brand: 'lc79', brandLabel: 'LC79', variant: 'Tài Xỉu', url: 'https://apitaixiu-6jjn.onrender.com/lc79/tx', group: 'tx', enabled: true },
  { id: 'lc79_md5', brand: 'lc79', brandLabel: 'LC79', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/lc79/md5', group: 'md5', enabled: true },
  
  { id: 'betvip_tx', brand: 'betvip', brandLabel: 'BETVIP', variant: 'Tài Xỉu', url: 'https://apitaixiu-6jjn.onrender.com/betvip/tx', group: 'tx', enabled: true },
  { id: 'betvip_md5', brand: 'betvip', brandLabel: 'BETVIP', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/betvip/md5', group: 'md5', enabled: true },
  
  { id: 'b52_tx', brand: 'b52', brandLabel: 'B52', variant: 'Tài Xỉu', url: 'https://apitaixiu-6jjn.onrender.com/api/ditmemayb52', group: 'tx', enabled: true },
  
  { id: 'luck8_tx', brand: 'luck8', brandLabel: 'LUCK8', variant: 'Hũ', url: 'https://apitaixiu-6jjn.onrender.com/luck8-hu', group: 'tx', enabled: true },
  { id: 'luck8_md5', brand: 'luck8', brandLabel: 'LUCK8', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/luck8-md5', group: 'md5', enabled: true },
  
  { id: 'sicbo_789', brand: '789club', brandLabel: '789CLUB', variant: 'Sicbo', url: 'https://apitaixiu-6jjn.onrender.com/api/sicbo/789', group: 'sicbo', enabled: true },
  
  { id: 'xocdia88_tx', brand: 'xocdia88', brandLabel: 'XOCDIA88', variant: 'Tài Xỉu', url: 'https://apitaixiu-6jjn.onrender.com/xocdia88/tx', group: 'tx', enabled: true },
  { id: 'xocdia88_md5', brand: 'xocdia88', brandLabel: 'XOCDIA88', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/xocdia88/md5', group: 'md5', enabled: true },
  
  { id: 'sumclub_tx', brand: 'sumclub', brandLabel: 'SUMCLUB', variant: 'Tài Xỉu', url: 'https://apitaixiu-6jjn.onrender.com/sumclub/tx', group: 'tx', enabled: true },
  { id: 'sumclub_md5', brand: 'sumclub', brandLabel: 'SUMCLUB', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/sumclub/md5', group: 'md5', enabled: true },
  
  { id: 'gb68_md5', brand: '68gb', brandLabel: '68GB', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/68gb/md5', group: 'md5', enabled: true }
];

let games = loadJSON('games.json', null);
if (!Array.isArray(games) || !games.length) games = DEFAULT_GAMES.map(g => ({ ...g }));
else {
  for (const d of DEFAULT_GAMES) if (!games.some(g => g.id === d.id)) games.push({ ...d });
}

/* ───────── PATTERN DATABASE ───────── */
const PATTERN_DB = {
  "TXXTTXTX":"X","XXTTXTXX":"X","XTTXTXXT":"X","TTXTXXTT":"X","TXTXXTTT":"X","XTXXTTTX":"T","TXXTTTXX":"X","XXTTTXXT":"T","XTTTXXTX":"T","TTTXXTXX":"X","TTXXTXXX":"X","TXXTXXXX":"X","XXTXXXXX":"X","XTXXXXXT":"T","TXXXXXTX":"T","XXXXXTXX":"X","XXXXTXXX":"T","XXXTXXXT":"T","XXTXXXTX":"X","XTXXXTXX":"T","TXXXTXXX":"T","XXXTXXXX":"X","XXTXXXXT":"X","XTXXXXTT":"X","TXXXXTTX":"X","XXXXTTXX":"X","XXXTTXXX":"T","XXTTXXXT":"T","XTTXXXTX":"T","TTXXXTXT":"T","TXXXTXTX":"T","XXXTXTXT":"X","XXTXTXTT":"T","XTXTXTTT":"X","TXTXTTTT":"T","XTXTTTTT":"X","TXTTTTTT":"X","XTTTTTTX":"X","TTTTTTXT":"X","TTTTTXTX":"X","TTTTXTXT":"X","TTTXTXTT":"X","TTXTXTTX":"X","TXTXTTXT":"X","XTXTTXTX":"T","TXTTXTXT":"T","XTTXTXTT":"X","TXTTXTXX":"X","XTTXTXXX":"X","TTXTXXXT":"T","TXTXXXTT":"X","XTXXXTTX":"T","TXXXTTXX":"T","XXXTTXXT":"X","XXTTXXTX":"T","XTTXXTXX":"X","TXXTXXXT":"X","XXTXXXTT":"T","XTXXXTTT":"T","TXXXTTTT":"X","XXXTTTTT":"T","XXTTTTTT":"X","TTTTTTXX":"X","TTTTTXXX":"T","TTTTXXXT":"X","TTTXXXTX":"X","TXXXTXTT":"X","XXXTXTTX":"X","XXTXTTXX":"T","XTXTTXXT":"T","TXTTXXTT":"T","XTTXXTTT":"X","TTXXTTTX":"T","TXXTTTXT":"X","XXTTTXTX":"T","XTTTXTXX":"X","TTTXTXXX":"X","XTXTTXXX":"X","TXTTXXXT":"X","TTXXXTXX":"X","TXXXTXXT":"T","XXXTXXTX":"X","XXTXXTXT":"X","XTXXTXTX":"T","TXXTXTXT":"X","XTXTXTTX":"X","XTXTTXTT":"T","TXTTXTTT":"T","XTTXTTTX":"X","TTXTTTXT":"X","TXTTTXTT":"X","XTTTXTTX":"T","TTTXTTXT":"X","TTXTTXTX":"T","TTXTXXTX":"T","TXTXXTXT":"X","XTXXTXTT":"T","TXXTXTTT":"T","XXTXTTTT":"X","TXTTTTTX":"T","XTTTTTXX":"T","TTTTXXXX":"T","TTTXXXXX":"X","TTXXXXXX":"X","TXXXXXXT":"T","XXXXXXTT":"X","XXXXXTTX":"X","XTTXXTXT":"X","TTXXTXTT":"T","XTXTTTTX":"T","TXTTTTXT":"X","XTTTTXTX":"T","TTTTXTXX":"X","TTTXTXXT":"T","TXTXTTTX":"T","XTXTTTXX":"T","TXTTTXXT":"T","XTTTXXTT":"T","TTTXXTTT":"T","TTXXTTTT":"X","TXXTTTTX":"T","XXTTTTXT":"X","TXTXTTXX":"X","TXTTXXXX":"T","XTTXXXXT":"X","TTXXXXTX":"X","TXXXXTXT":"X","XXXXTXTX":"T","TXTTTTXX":"T","XTTTTXXT":"T","TTTTXXTX":"T","XXXTXXTT":"T","XXTXXTTT":"X","XXTTTXTT":"X","TTTXTTXX":"T","TTXTTXXX":"X","XTTXXXXX":"T","TTXXXXXT":"T","TXXXXXTT":"T","XXXXXTTT":"X","XXXXTTTT":"T","XXXTTTTX":"T","XTTXTXTX":"T","TTXTXTXT":"X","TXTXTXTX":"X","XTXTXTXT":"X","XTXTXTXX":"X","TXTXTXXT":"X","XTXTXXTX":"T","XXTXTXTX":"X","TXTXTXTT":"X","TXTTTXXX":"T","XTTTXXXX":"X","TTTXXXXT":"X","TTXXXXTT":"X","XXXTXTXX":"T","XXTXTXXX":"X","XTXTXXXT":"X","XXTTXXTT":"T","TXXTTTTT":"X","TTTTTXTT":"X","TTTTXTTT":"T","TTTXTTTT":"X","TTXTTTTX":"X","XTXXTTTT":"T","XTTTTXTT":"T","XTTTTXXX":"X","TXXXXTTT":"X","XXXXTTTX":"T","XXXTTTXX":"X","TXTXTXXX":"X","XXTTTTXX":"X","TTTXXXTT":"T","TTXXXTTX":"T","TXXXTTXT":"X","XXXTTXTT":"T","XXTTXTTX":"X","XTTXTTXX":"X","TTXTTXXT":"T","TTTXXTXT":"X","TTXXTXTX":"X","TXTXXXTX":"X","TTTTXXTT":"T","XTTTTTTT":"T","TTTTTTTT":"X","TTTTTTTX":"T","TTTTTXXT":"T","TTTXXTTX":"T","TTXXTTXX":"T","TXXTTXXT":"X","TTXXTXXT":"T","TXXTXXTX":"T","XXTXXTXX":"X","XTXXTXXX":"X","XTXXXXTX":"T","XXXXTXTT":"T","XXXTXTTT":"X","TXXTXXTT":"T","XXXXXTXT":"T","XTTXXXTT":"T","XXTTXXXX":"X","TXTTXTTX":"T","XTTXTTXT":"X","TTXTTXTT":"T","XTTXTTTT":"X","TTXTTTTT":"X","TTTTXTTX":"X","TTXTXXXX":"T","TXTXXXXT":"T","XXTTTTTX":"X","XTTTTTXT":"T","TTTXTXTX":"X","TXTXXTXX":"X","XTXXTXXT":"T","XTXTXXXX":"T","TXXXXTXX":"T","TTXTXTXX":"X","XTXTXXTT":"T","TXXXTTTX":"X","XXXTTTXT":"X","XXTTTXXX":"T","XTTTXXXT":"X","TTXXXTTT":"X","TXXTXTTX":"T","TXTTXXTX":"X","XXTXTTTX":"X","XTXXXXXX":"T","TXXXXXXX":"X","XXXXXXXT":"X","XXXXTTXT":"T","XXXTTXTX":"X","TXTXXXXX":"X","XXXXTXXT":"X","TXXTXTXX":"T","XXTXTXXT":"T","TXTXXTTX":"X","XTXXTTXX":"X","TXXTTXXX":"X","XXTTXTTT":"T","TTXTTTXX":"T","XXXXXXTX":"X","TTTXTTTX":"X","XTTTXTTT":"T","TXTTTXTX":"X","XTXXXTXT":"X","XTTXXTTX":"T","TTXXTTXT":"X","XXTTXTXT":"X","XXTXXTTX":"X","TXTT":"X","TXTTT":"X","TXTTTX":"X","TXTTTXX":"X","XXTXTTXT":"X","TTXTXTTT":"X","XTXTTTXT":"T","XTTTXTXT":"X","XTXXTTXT":"X","TXXTTXTT":"X","XXTT":"T","XXTTT":"T","XXTTTT":"X","XXTTTTX":"X","XTXX":"T","XTXXT":"T","XTXXTT":"T","XTXXTTT":"T","XXXXXXXX":"T","TXXT":"T","TXXTT":"T","TXXTTT":"X","TXXTTTX":"T","XTTT":"X","XTTTX":"X","XTTTXX":"T","XTTTXXX":"T","TTXT":"X","TTXTX":"X","TTXTXX":"X","TTXTXXX":"X","XTTTXXT":"T","TXTTX":"T","TXTTXT":"T","TXTTXTT":"T","TXXX":"T","TXXXT":"T","TXXXTT":"T","TXXXTTT":"X","XXTX":"T","XXTXT":"X","XXTXTX":"X","XXTXTXX":"X"
};

/* ───────── Sicbo Analyzer ───────── */
class SicboAnalyzer {
  constructor() { this.reset(); }
  reset() {
    this.dice = [[0,0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0]];
    this.sums = {}; this.triples = 0; this.pairs = 0; this.total = 0;
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
    return true;
  }
  biasScore() {
    if (this.total < 30) return { chi: 0, biased: false, strength: 0 };
    const exp = this.total / 6;
    let chi = 0;
    for (const arr of this.dice) for (const c of arr) chi += ((c - exp) ** 2) / exp;
    const biased = chi > 25;
    return { chi: Math.round(chi * 10) / 10, biased, strength: biased ? Math.min(1, (chi - 25) / 75) : 0 };
  }
  hotDice() {
    if (this.total < 20) return null;
    return this.dice.map(arr => arr.indexOf(Math.max(...arr)) + 1);
  }
  guessDice(side) {
    const pool = side === 'T' ? [11,12,13,14,15,16,17] : [4,5,6,7,8,9,10];
    const hot = this.hotDice() || [3, 4, 5];
    const cand = this.dice.map(arr => arr.map((c, i) => ({ v: i + 1, c })).sort((a, b) => b.c - a.c).slice(0, 3).map(x => x.v));
    const tries = [hot, [cand[0][0], cand[1][0], cand[2][0]]];
    for (const t of tries) {
      if (pool.includes(t.reduce((a, b) => a + b, 0))) return t.sort((a, b) => a - b);
    }
    return hot;
  }
  confBoost() { return this.biasScore().biased ? Math.round(this.biasScore().strength * 8) : 0; }
  anomalyRate() { return this.total < 20 ? 0 : ((this.triples + this.pairs) / this.total) * 100; }
}

/* ───────── ENGINE (Nâng cấp tính xác suất) ───────── */
class Engine {
  constructor(id) {
    this.id = id || '';
    this.history = []; this.sums = []; this.diceHist = [];
    this.correct = 0; this.total = 0;
    this.pending = null; this.pendingMeta = null; this.log = [];
    this.sicbo = new SicboAnalyzer();
    this.marketState = { regime: 'normal', volatility: 0.5 };
  }
  
  push(side, sum, dice, session) {
    const s = side === 'T' ? 'T' : 'X';
    if (this.pending) {
      this.total++;
      const ok = this.pending === s;
      if (ok) this.correct++;
      this.log.push({ session: session || '', pred: this.pending, actual: s, ok, conf: (this.pendingMeta && this.pendingMeta.conf) || 0, sum: Number(sum) || 0 });
      if (this.log.length > 500) this.log.shift();
      this.pending = null; this.pendingMeta = null;
    }
    this.history.push(s);
    this.sums.push(Number(sum) || 10);
    if (dice && dice.length >= 3) this.diceHist.push(dice.map(Number));
    if (this.history.length > 400) { this.history.shift(); this.sums.shift(); }
    if (this.diceHist.length > 400) this.diceHist.shift();
    if (dice && dice.length >= 3) this.sicbo.push(dice);
    this._updateMarketState();
  }

  _updateMarketState() {
    const h = this.history;
    if (h.length < 10) return;
    let changes = 0;
    for (let i = 1; i < 10; i++) if (h[h.length-i] !== h[h.length-i-1]) changes++;
    this.marketState.volatility = changes / 9;
    if (this.marketState.volatility > 0.7) this.marketState.regime = 'volatile';
    else if (this.marketState.volatility < 0.3) this.marketState.regime = 'trending';
    else this.marketState.regime = 'normal';
  }

  predict() {
    const h = this.history;
    const n = h.length;
    
    if (n < 3) {
      const side = n && h[n - 1] === 'X' ? 'T' : 'X';
      const out = { side, conf: 51, reason: 'Đang lấy dữ liệu', vi: pickVi(side, this.sums, this.diceHist, this.sicbo), streak: 0, isAlt: false, trend: 0, anomaly: 0, sicboBias: null };
      this.pending = side; this.pendingMeta = out; return out;
    }

    const last = h[n - 1];
    const last2 = n >= 2 ? h[n - 2] : null;
    const last3 = n >= 3 ? h[n - 3] : null;

    let streak = 1;
    for (let i = n - 2; i >= 0 && h[i] === last; i--) streak++;

    let alt = 0;
    const takeAlt = Math.min(10, n);
    for (let i = n - takeAlt + 1; i < n; i++) if (h[i] !== h[i - 1]) alt++;
    const isAlt = alt >= takeAlt - 1;

    let is22 = false;
    if (n >= 6) {
      let pairCount = 0;
      for (let i = n - 6; i <= n - 2; i += 2) if (h[i] === h[i + 1]) pairCount++;
      is22 = pairCount >= 2;
    }

    let m3T = 0, m3n = 0;
    const key3 = (last2 && last3) ? last3 + last2 + last : null;
    if (key3) for (let i = 3; i < n; i++) if (h[i - 3] + h[i - 2] + h[i - 1] === key3) { m3n++; if (h[i] === 'T') m3T++; }

    let scoreT = 0;
    const reasons = [];
    let confExtra = 0;

    // 1. Dò Pattern DB
    let patternMatched = false;
    for (let len = Math.min(n, 8); len >= 2; len--) {
      const pat = h.slice(-len).join('');
      if (PATTERN_DB[pat]) {
        const pred = PATTERN_DB[pat];
        if (pred === 'T') scoreT += 2.5; else scoreT -= 2.5;
        reasons.push(`Mẫu ${len} (${pred})`);
        confExtra += 12;
        patternMatched = true;
        break;
      }
    }

    // 2. Xác suất & Markov (Nếu không dính mẫu)
    if (!patternMatched) {
      let tCount = 0, xCount = 0;
      // Lấy 30 phiên gần nhất để tính xác suất
      const recent30 = h.slice(-30);
      for (const side of recent30) { if (side === 'T') tCount++; else xCount++; }
      const pT = (tCount + 1) / (recent30.length + 2); // Laplace smoothing
      
      // Cân bằng xác suất (Nếu lệch quá cao thì đánh bên ngược lại - Mean Reversion)
      if (pT > 0.65) { scoreT -= 1.5; reasons.push('Lệch Tài, bắt Xỉu'); }
      else if (pT < 0.35) { scoreT += 1.5; reasons.push('Lệch Xỉu, bắt Tài'); }
      else {
        // Nếu cân bằng thì dựa vào Markov
        if (m3n >= 3) {
          const p = (m3T + 1) / (m3n + 2);
          scoreT += 1.2 * Math.log(p / (1 - p));
          reasons.push(`Nhịp 3 tay`);
        } else {
          scoreT += (pT - 0.5) * 2;
          reasons.push('Cầu ổn định');
        }
      }
      confExtra += 5;
    }

    // 3. Z-Score (Tổng điểm)
    const sums = this.sums.slice(-20);
    let zBoost = 0;
    if (sums.length >= 10) {
      const mean = sums.reduce((a, b) => a + b, 0) / sums.length;
      const std = Math.sqrt(sums.reduce((a, b) => a + (b - mean) ** 2, 0) / sums.length) || 1;
      const z = (sums[sums.length - 1] - mean) / std;
      if (z >= 1.5) zBoost = -0.6; else if (z <= -1.5) zBoost = 0.6;
    }
    scoreT += zBoost;

    // 4. Anti
    if (isAlt && !patternMatched) { scoreT = 0; reasons.length = 0; reasons.push('Cầu đan 1-1, bỏ qua'); confExtra -= 10; }
    if (is22 && !isAlt) { if (last === 'T') scoreT -= 0.5; else scoreT += 0.5; reasons.push('Cầu đôi 2-2'); }

    // 5. Bệt
    if (streak >= 6) { if (last === 'T') scoreT -= 1.2; else scoreT += 1.2; reasons.push(`Bệt ${streak}, bẻ`); confExtra += 5; }
    else if (streak >= 4) { if (last === 'T') scoreT -= 0.6; else scoreT += 0.6; reasons.push(`Chuỗi ${streak}`); confExtra += 2; }

    // 6. Volatility
    if (this.marketState.regime === 'volatile') { confExtra -= 5; scoreT *= 0.9; }

    // Chốt
    const pT = 1 / (1 + Math.exp(-Math.max(-5, Math.min(5, scoreT))));
    let conf = Math.round(55 + Math.abs(pT - 0.5) * 160 + confExtra);
    conf = Math.min(96, Math.max(52, conf));

    const side = pT >= 0.5 ? 'T' : 'X';
    const out = {
      side, conf, reason: reasons.slice(0, 2).join(' · ') || 'Cầu đang chạy', 
      vi: pickVi(side, this.sums, this.diceHist, this.sicbo),
      streak, isAlt, trend: Math.round((pT - 0.5) * 200), 
      anomaly: this.sicbo.anomalyRate(),
      sicboBias: this.sicbo.total >= 30 ? this.sicbo.biasScore() : null
    };
    this.pending = side; this.pendingMeta = out; return out;
  }
  accuracy() { return !this.total ? 0 : Math.round((this.correct / this.total) * 100); }
}

function pickVi(side, sums, diceHist, sicboAnalyzer) {
  const isTai = side === 'T';
  const pool = isTai ? [11, 12, 13, 14, 15, 16, 17] : [4, 5, 6, 7, 8, 9, 10];
  if (sicboAnalyzer && sicboAnalyzer.total >= 30) {
    const g = sicboAnalyzer.guessDice(side);
    if (g && g.every(v => v >= 1 && v <= 6) && pool.includes(g[0] + g[1] + g[2])) return g.sort((a, b) => a - b);
  }
  if (!pickVi._seq) pickVi._seq = 0;
  pickVi._seq = (pickVi._seq + 1) % 1000;
  const presetsT = [[11,13,16],[12,14,17],[11,14,15],[12,15,16],[13,14,17],[11,12,16],[12,13,15],[14,15,17],[11,15,17],[12,14,16],[13,15,16],[11,14,17]];
  const presetsX = [[4,6,9],[5,7,10],[4,7,8],[5,8,9],[6,7,10],[4,5,9],[5,6,8],[7,9,10],[4,8,10],[5,7,9],[6,8,10],[4,6,7]];
  const presets = isTai ? presetsT : presetsX;
  let mix = (pickVi._seq * 7) + (Date.now() % 97);
  let base = presets[mix % presets.length].slice();
  return base.slice(0, 3).sort((a, b) => a - b);
}

function isSicboGame(g) {
  return g && (String(g.group || '').toLowerCase() === 'sicbo' || String(g.variant || '').toLowerCase().includes('sicbo'));
}

const FEEDS = {};
for (const g of games) FEEDS[g.id] = { id: g.id, engine: new Engine(g.id), lastSession: null, lastLive: null, lastError: null, lastPred: null };

function parseLive(json) {
  if (!json) return null;
  let item = json;

  if (json.Lich_su && Array.isArray(json.Lich_su) && json.Lich_su.length > 0) item = json.Lich_su[0];
  else if (json.history && Array.isArray(json.history) && json.history.length > 0) item = json.history[0];
  else if (Array.isArray(json) && json.length > 0) item = json[0];
  else if (json.data && Array.isArray(json.data) && json.data.length > 0) item = json.data[0];
  else if (json.data && typeof json.data === 'object') item = json.data;

  if (!item || typeof item !== 'object') return null;

  const getVal = (obj, keys) => {
    for (const k of keys) {
      if (obj[k] !== undefined && obj[k] !== null) return obj[k];
    }
    const lowerKeys = keys.map(k => k.toLowerCase());
    for (const key of Object.keys(obj)) {
      if (lowerKeys.includes(key.toLowerCase())) return obj[key];
    }
    return null;
  };

  const phien = getVal(item, ['Phien', 'phien', 'session', 'id', 'Phien_hien_tai']);
  if (phien == null) return null;

  let ket = getVal(item, ['Ket_qua', 'ket_qua', 'result', 'KetQua', 'kq']) || '';
  try { ket = decodeURIComponent(ket); } catch {}
  
  const xucxacArr = getVal(item, ['xuc_xac', 'Xuc_xac', 'dice']);
  let d1 = 0, d2 = 0, d3 = 0;
  if (Array.isArray(xucxacArr) && xucxacArr.length >= 3) {
    d1 = Number(xucxacArr[0]) || 0;
    d2 = Number(xucxacArr[1]) || 0;
    d3 = Number(xucxacArr[2]) || 0;
  } else {
    d1 = Number(getVal(item, ['Xuc_xac_1', 'xuc_xac_1', 'dice1'])) || 0;
    d2 = Number(getVal(item, ['Xuc_xac_2', 'xuc_xac_2', 'dice2'])) || 0;
    d3 = Number(getVal(item, ['Xuc_xac_3', 'xuc_xac_3', 'dice3'])) || 0;
  }
  
  let tong = getVal(item, ['Tong', 'tong', 'total', 'sum']);
  let sum = Number(tong);
  if (!Number.isFinite(sum) || sum <= 0) sum = d1 + d2 + d3;

  const k = String(ket).toLowerCase();
  let side = 'X';
  if (k.includes('tài') || k.includes('tai') || k === 't' || k.includes('t\\u00e0i')) side = 'T';
  else if (k.includes('xỉu') || k.includes('xiu') || k === 'x' || k.includes('x\\u1ec9u')) side = 'X';
  else if (sum > 0) {
    if (sum >= 11) side = 'T';
    else if (sum <= 10) side = 'X';
  }

  return { session: String(phien), side, sum, dice: [d1, d2, d3] };
}

async function fetchJson(url, timeout = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 DUDOANTX/10' } });
    clearTimeout(t);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) { clearTimeout(t); throw e; }
}

const health = {};
async function pollGame(g) {
  const f = FEEDS[g.id];
  if (!f || !g.enabled || !g.url) return;
  const h = health[g.id] || (health[g.id] = { fails: 0, next: 0 });
  if (h.next && Date.now() < h.next) return;

  try {
    const raw = await fetchJson(g.url, 8000);
    const live = parseLive(raw);
    if (!live) throw new Error('parse_failed');
    
    if (live.session && live.session !== f.lastSession) {
      f.engine.push(live.side, live.sum, live.dice, live.session);
      f.lastSession = live.session;
      f.lastPred = f.engine.predict();
      saveLearningSnapshot();
    } else if (!f.lastSession) {
      f.engine.push(live.side, live.sum, live.dice, live.session);
      f.lastSession = live.session || ('t' + Date.now());
      f.lastPred = f.engine.predict();
    } else if (!f.lastPred) f.lastPred = f.engine.predict();
    
    f.lastLive = live; f.lastError = null; h.fails = 0; h.next = 0;
  } catch (e) {
    h.fails++;
    h.next = Date.now() + Math.min(300000, 5000 * Math.pow(2, Math.min(5, h.fails - 1)));
    f.lastError = String(e.message || e).slice(0, 80);
  }
}

async function pollAll() { await Promise.all(games.map(g => (g.enabled === false ? Promise.resolve() : pollGame(g).catch(() => {})))); }
setInterval(pollAll, POLL_MS);
setTimeout(pollAll, 1500);

function saveLearningSnapshot() {
  try {
    const snap = {};
    for (const id of Object.keys(FEEDS)) {
      const e = FEEDS[id].engine;
      snap[id] = { history: e.history.slice(-200), sums: e.sums.slice(-200), correct: e.correct, total: e.total, log: e.log.slice(-200) };
    }
    saveJSON('learning.json', snap);
  } catch (e) {}
}
function loadLearningSnapshot() {
  const snap = loadJSON('learning.json', null);
  if (!snap) return;
  for (const id of Object.keys(snap)) {
    if (!FEEDS[id]) continue;
    const e = FEEDS[id].engine, s = snap[id];
    if (Array.isArray(s.history)) e.history = s.history.slice();
    if (Array.isArray(s.sums)) e.sums = s.sums.slice();
    if (Array.isArray(s.log)) e.log = s.log.slice();
    e.correct = Number(s.correct) || 0; e.total = Number(s.total) || 0;
  }
}
loadLearningSnapshot();

/* ───────── Hash Predictor ───────── */
function predictHash(hashStr) {
  const str = hashStr.toLowerCase();
  let sum = 0;
  for (let i = 0; i < str.length; i++) {
    sum += str.charCodeAt(i) * (i + 1);
  }
  const pseudo = (sum * 9301 + 49297) % 233280 / 233280;
  const side = pseudo >= 0.5 ? 'T' : 'X';
  const conf = Math.round(55 + Math.abs(pseudo - 0.5) * 80);
  const reason = pseudo >= 0.5 ? 'Hash nghiêng Tài' : 'Hash nghiêng Xỉu';
  return { side, conf, reason };
}

/* ───────── UI & TEXTS ───────── */
function kb(rows) { return { reply_markup: { inline_keyboard: rows } }; }
function btn(text, data, style) { return { text, callback_data: data, style }; }
function btnUrl(text, url, style) { return { text, url, style }; }

async function showUserMenu(chatId, from) {
  const uid = uidOf(from);
  const v = vipText(uid);
  const text =
`💥 <b>DUDOANTX - SOI CẦU ĐỈNH CAO</b> 💥
<i>Chuyên trị Tài Xỉu & Sicbo. Bám phiên 24/7.</i>

👤 <b>Đại Ca:</b> ${esc(displayName(from))}
🆔 <b>ID:</b> <code>${uid}</code>
💎 <b>Trạng thái:</b> ${v.line}
⏳ <b>Hạn dùng:</b> <b>${v.expire}</b>

👇 <i>Chọn chức năng:</i>`;

  const rows = [
    [btn('🎯 VÀO SOI CẦU NGAY', 'pred:brands', 'primary')],
    [btn('🧩 TOOL HASH MD5/SHA256', 'hash:start', 'success')],
    [btnUrl('🙋 GỌI ADMIN XIN QUYỀN', cfg.supportUrl, 'success')]
  ];
  if (isAdmin(uid)) rows.push([btn('🛠 BẢNG ĐIỀU KHIỂN CỦA BỐ MÀY', 'adm:home', 'danger')]);
  return send(chatId, text, kb(rows));
}

async function showBrandMenu(chatId) {
  const brands = [
    ['sunwin', 'SUNWIN'], ['tik88', 'TIK88'], ['hitclub', 'HITCLUB'], ['max789', 'MAX789'], ['lc79', 'LC79'],
    ['betvip', 'BETVIP'], ['b52', 'B52'], ['luck8', 'LUCK8'], ['789club', '789CLUB'],
    ['xocdia88', 'XOCDIA88'], ['sumclub', 'SUMCLUB'], ['68gb', '68GB']
  ];
  const rows = []; let row = []; let t = true;
  for (const [id, label] of brands) {
    row.push(btn(label, 'predbrand:' + id, t ? 'primary' : 'success'));
    t = !t; if (row.length === 2) { rows.push(row); row = []; }
  }
  if (row.length) rows.push(row);
  rows.push([btn('🏠 QUAY LẠI', 'menu', 'danger')]);
  return send(chatId, '🎰 <b>CHỌN SÒNG BÀI ĐỂ SOI</b>\n\n👇 Bấm chọn sòng bên dưới (Hệ thống tự động bám phiên):', kb(rows));
}

function stopAuto(uid, silent) {
  const w = autoWatch[uid]; if (!w) return;
  if (w.timer) clearInterval(w.timer);
  delete autoWatch[uid];
  if (!silent && w.chatId) send(w.chatId, '⏹ <b>Đã tắt bám phiên.</b> Muốn cày tiếp thì vào lại.', kb([[btn('🏠 VỀ MENU', 'menu', 'danger')]])).catch(() => {});
}

function startAuto(uid, chatId, gameId) {
  stopAuto(uid, true);
  const tick = async () => {
    const w = autoWatch[uid]; if (!w || w.gameId !== gameId) return;
    const g = games.find(x => x.id === gameId), f = FEEDS[gameId];
    if (!g || !f) return;
    await pollGame(g).catch(() => {});
    const sess = f.lastLive?.session ? String(f.lastLive.session) : null;
    if (sess && sess !== w.lastSession) {
      w.lastSession = sess;
      await pushPredCard(chatId, gameId, uid, true).catch(() => {});
    }
  };
  autoWatch[uid] = { gameId, chatId, lastSession: null, timer: setInterval(tick, 5000) };
  tick();
}

async function pushPredCard(chatId, gameId, uid, fromAuto) {
  if (!isVip(uid)) {
    return send(chatId, 
`🤬 <b>ĐỊT CỤ MÀY!</b> 🤬

😡 <b>XIN BỐ MÀY ĐI MỚI DÙNG ĐƯỢC BOT!</b> 💩
🖕 Đừng có bấm bấm nữa, muốn soi cầu thì nạp tiền hoặc xin Admin mở quyền! 🚫
🔞 Mày tưởng tool này free chắc? Mơ đi con! 🖕

👇 <i>Bấm vào đây để xin xỏ:</i>`, 
    kb([[btnUrl('🙋 XIN BỐ MÀY ĐI', cfg.supportUrl, 'danger')], [btn('🏠 VỀ MENU', 'menu', 'primary')]]));
  }

  const g = games.find(x => x.id === gameId), f = FEEDS[gameId];
  if (!g || !f) return;
  if (!f.lastPred) f.lastPred = f.engine.predict();
  const p = f.lastPred;
  const sicbo = isSicboGame(g);

  if (sicbo) {
    const pool = p.side === 'T' ? [11, 12, 13, 14, 15, 16, 17] : [4, 5, 6, 7, 8, 9, 10];
    if (!Array.isArray(p.vi) || p.vi.length !== 3 || !p.vi.every(v => pool.includes(v))) p.vi = pickVi(p.side, f.engine.sums, f.engine.diceHist, f.engine.sicbo);
  }

  const live = f.lastLive || {};
  const sideTxt = p.side === 'T' ? 'TÀI' : 'XỈU';
  const sideIcon = p.side === 'T' ? '🔴' : '🔵';
  const acc = f.engine.accuracy();
  
  const lastLog = f.engine.log.slice(-1)[0];
  let lastResult = '⏳ Chưa có';
  if (lastLog) {
    const okStr = lastLog.ok ? '✅ NỔ' : '❌ XỊT';
    const predTxt = lastLog.pred === 'T' ? 'TÀI' : 'XỈU';
    const actTxt = lastLog.actual === 'T' ? 'TÀI' : 'XỈU';
    lastResult = `${okStr} <i>(Đoán: ${predTxt} - Ra: ${actTxt})</i>`;
  }

  const filled = Math.max(0, Math.min(10, Math.round((p.conf || 52) / 10)));
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

  let nextSession = '—';
  if (live.session != null && live.session !== '') {
    const num = Number(live.session);
    nextSession = Number.isFinite(num) ? String(num + 1) : String(live.session);
  }

  let prevLine = '📡 Đang lấy dữ liệu...';
  if (live.session) {
    const prevSide = live.side === 'T' ? 'TÀI' : 'XỈU';
    const sideE = live.side === 'T' ? '🔴' : '🔵';
    prevLine = `⏮ <b>Vừa ra:</b> <code>#${esc(live.session)}</code> - ${sideE} ${prevSide} (${live.sum}) 🎲 ${live.dice.join('-')}`;
  }

  let spec = '';
  if (sicbo) {
    const vi = (p.vi || []).join(' · ');
    spec = `🎲 <b>Vị gợi ý:</b> ${esc(vi)}\n<i>(Khung ${p.side === 'T' ? '11–17' : '4–10'} · tránh 3/18)</i>\n\n`;
  }

  const text =
`${fromAuto ? '🔄 <b>[BÁM PHIÊN]</b> <i>Tao đang canh me...</i>\n' : ''}🎰 <b>${esc(g.brandLabel)} · ${esc(g.variant)}</b>
━━━━━━━━━━━━━━━
🔮 <b>Phiên kế:</b> <code>#${esc(nextSession)}</code>
${prevLine}
⚖️ <b>Phiên trước:</b> ${lastResult}
━━━━━━━━━━━━━━━
${spec}🎯 <b>CHỐT KÈO:</b> ${sideIcon} <b>${sideTxt}</b>
⚡ <b>Tỉ lệ nổ:</b> <b>${p.conf}%</b>
<code>${bar}</code>
💡 <b>Phân tích:</b> ${esc(p.reason)}${p.streak ? ' · Bệt ' + p.streak : ''}
━━━━━━━━━━━━━━━
📈 <b>Độ chuẩn:</b> ${acc}% (${f.engine.correct}/${f.engine.total})
🕐 <i>${esc(nowVN())}</i>`;

  const rows = [[btn('🔄 CẬP NHẬT', 'pred:' + gameId, 'success')]];
  if (g.playUrl) rows.push([btnUrl('🎮 VÀO BÀN CÀY', g.playUrl, 'success')]);
  rows.push([btn('⏹ NGHỈ CHƠI', 'pred:stop:' + g.id, 'danger'), btn('🏠 VỀ MENU', 'menu', 'primary')]);

  const key = uid + ':' + gameId;
  if (predMsg[key]) await delMsg(chatId, predMsg[key]);
  const sent = await send(chatId, text, kb(rows));
  if (sent && sent.result) predMsg[key] = sent.result.message_id;
}

async function showTables(chatId, brand, uid) {
  if (!isVip(uid)) {
    return send(chatId, 
`🤬 <b>ĐỊT CỤ MÀY!</b> 🤬

😡 <b>XIN BỐ MÀY ĐI MỚI DÙNG ĐƯỢC BOT!</b> 💩
🖕 Đừng có bấm bấm nữa, muốn soi cầu thì nạp tiền hoặc xin Admin mở quyền! 🚫
🔞 Mày tưởng tool này free chắc? Mơ đi con! 🖕

👇 <i>Bấm vào đây để xin xỏ:</i>`, 
    kb([[btnUrl('🙋 XIN BỐ MÀY ĐI', cfg.supportUrl, 'danger')], [btn('🏠 VỀ MENU', 'menu', 'primary')]]));
  }

  const list = games.filter(g => String(g.brand).toLowerCase() === String(brand).toLowerCase());
  if (!list.length) return send(chatId, '📭 Sòng này éo có bàn nào.', kb([[btn('◀️', 'pred:brands', 'primary')]]));
  
  const rows = []; let row = []; let t = true;
  for (const g of list) {
    const f = FEEDS[g.id], bad = !g.url || g.enabled === false || (f && f.lastError);
    row.push(btn(`${bad ? '🔴' : '🟢'} ${g.variant}`, bad ? 'pred:off:' + g.id : 'pred:' + g.id, bad ? 'danger' : (t ? 'success' : 'primary')));
    t = !t; if (row.length === 2) { rows.push(row); row = []; }
  }
  if (row.length) rows.push(row);
  rows.push([btn('◀️ CHỌN SÒNG KHÁC', 'pred:brands', 'primary'), btn('🏠 VỀ MENU', 'menu', 'danger')]);
  
  return send(chatId, `🎰 <b>SÒNG ${esc(brand.toUpperCase())}</b>\n👇 Chọn bàn mà cày:`, kb(rows));
}

async function sendPredCard(chatId, gameId, uid) {
  if (!isVip(uid)) {
    return send(chatId, 
`🤬 <b>ĐỊT CỤ MÀY!</b> 🤬

😡 <b>XIN BỐ MÀY ĐI MỚI DÙNG ĐƯỢC BOT!</b> 💩
🖕 Đừng có bấm bấm nữa, muốn soi cầu thì nạp tiền hoặc xin Admin mở quyền! 🚫
🔞 Mày tưởng tool này free chắc? Mơ đi con! 🖕

👇 <i>Bấm vào đây để xin xỏ:</i>`, 
    kb([[btnUrl('🙋 XIN BỐ MÀY ĐI', cfg.supportUrl, 'danger')], [btn('🏠 VỀ MENU', 'menu', 'primary')]]));
  }

  const g = games.find(x => x.id === gameId), f = FEEDS[gameId];
  if (!g || !f) return send(chatId, '❌ Éo tìm thấy bàn.');
  if (!g.url || g.enabled === false) return send(chatId, '🔴 Bàn này đang bảo trì, kiếm bàn khác đi.', kb([[btn('◀️', 'predbrand:' + g.brand, 'primary')]]));
  
  const loading = await send(chatId, '⏳ <i>Đang kết nối API lấy phiên mới...</i>');
  await pollGame(g).catch(() => {});
  if (!f.lastPred) f.lastPred = f.engine.predict();
  if (loading && loading.result) await delMsg(chatId, loading.result.message_id);
  
  startAuto(uid, chatId, gameId);
  await pushPredCard(chatId, gameId, uid, true);
}

/* ───────── Tool Hash ───────── */
async function showHashTool(chatId) {
  const text =
`🧩 <b>TOOL HASH MD5/SHA256</b> 🧩

😎 Bố mày sẽ đọc mã Hash của mày và phân tích xem nên đập Tài hay Xỉu.

👉 <i>Hãy nhắn (gửi) mã Hash vào đây:</i>
(MD5 dài 32 ký tự, SHA256 dài 64 ký tự)`;

  return send(chatId, text, kb([[btn('🏠 VỀ MENU', 'menu', 'danger')]]));
}

/* ───────── Admin ───────── */
async function showAdmin(chatId, from) {
  const activeVip = Object.values(users).filter(u => u.vipUntil > Date.now()).length;
  const text =
`🛠 <b>BẢNG ĐIỀU KHIỂN CỦA BỐ MÀY</b>

👥 Tổng Đàn Em: <b>${Object.keys(users).length}</b>
💎 Đang Có Quyền: <b>${activeVip}</b>

💡 <i>Cấp quyền: Nhắn lệnh</i> <code>/grant ID Số_Giờ</code>`;

  const rows = [
    [btn('🎮 QUẢN LÝ GAME', 'adm:games', 'primary'), btn('📣 BẮN THÔNG BÁO', 'adm:bc', 'success')],
    [btn('👤 RA MENU USER', 'menu', 'danger')]
  ];
  return send(chatId, text, kb(rows));
}

/* ───────── Callbacks ───────── */
async function onCallback(cq) {
  const chatId = cq.message.chat.id;
  const msgId = cq.message.message_id;
  const from = cq.from;
  const uid = uidOf(from);
  const data = String(cq.data || '');
  
  await delMsg(chatId, msgId);
  await answerCb(cq.id);

  if (data === 'menu') { stopAuto(uid, true); return showUserMenu(chatId, from); }
  
  // Hash feedback (Không cần VIP để bấm đúng sai, nhưng phải là người dùng tool hash)
  if (data.startsWith('hash_fb:')) {
    const choice = data.split(':')[1]; // 'ok' or 'no'
    hashFeedback[uid] = { choice, at: Date.now() };
    saveFeedback();
    return send(chatId, '✅ Đã ghi nhận phản hồi của mày để bố chỉnh lại thuật toán!', kb([[btn('🏠 VỀ MENU', 'menu', 'danger')]]));
  }
  
  // Hash Tool
  if (data === 'hash:start') {
    if (!isVip(uid)) {
      return send(chatId, 
`🤬 <b>ĐỊT CỤ MÀY!</b> 🤬

😡 <b>XIN BỐ MÀY ĐI MỚI DÙNG ĐƯỢC BOT!</b> 💩
🖕 Đừng có bấm bấm nữa, muốn soi cầu thì nạp tiền hoặc xin Admin mở quyền! 🚫
🔞 Mày tưởng tool này free chắc? Mơ đi con! 🖕

👇 <i>Bấm vào đây để xin xỏ:</i>`, 
    kb([[btnUrl('🙋 XIN BỐ MÀY ĐI', cfg.supportUrl, 'danger')], [btn('🏠 VỀ MENU', 'menu', 'primary')]]));
    }
    sessions[uid] = { await: 'hash_input' };
    return showHashTool(chatId);
  }

  // Chặn các lệnh khác nếu không có VIP
  if (!isVip(uid) && !isAdmin(uid) && data !== 'adm:home') {
    return send(chatId, 
`🤬 <b>ĐỊT CỤ MÀY!</b> 🤬

😡 <b>XIN BỐ MÀY ĐI MỚI DÙNG ĐƯỢC BOT!</b> 💩
🖕 Đừng có bấm bấm nữa, muốn soi cầu thì nạp tiền hoặc xin Admin mở quyền! 🚫
🔞 Mày tưởng tool này free chắc? Mơ đi con! 🖕

👇 <i>Bấm vào đây để xin xỏ:</i>`, 
    kb([[btnUrl('🙋 XIN BỐ MÀY ĐI', cfg.supportUrl, 'danger')], [btn('🏠 VỀ MENU', 'menu', 'primary')]]));
  }

  if (data === 'pred:brands') { stopAuto(uid, true); return showBrandMenu(chatId); }
  if (data.startsWith('predbrand:')) { stopAuto(uid, true); return showTables(chatId, data.slice(10), uid); }
  
  if (data.startsWith('pred:stop:')) {
    stopAuto(uid, true);
    return send(chatId, '⏹ <b>Đã nghỉ chơi.</b>', kb([[btn('🏠 VỀ MENU', 'menu', 'danger')]]));
  }
  if (data.startsWith('pred:off:')) return send(chatId, '🔴 Bàn này đéo chạy được, chọn bàn khác.', kb([[btn('◀️', 'pred:brands', 'primary')]]));
  if (data.startsWith('pred:') && data !== 'pred:brands') return sendPredCard(chatId, data.slice(5), uid);

  if (data === 'adm:home' && isAdmin(uid)) return showAdmin(chatId, from);
  if (data === 'adm:games' && isAdmin(uid)) {
    const lines = games.map(g => `${g.enabled === false || !g.url ? '🔴' : '🟢'} <code>${g.id}</code> ${g.brandLabel} ${g.variant}`);
    return send(chatId, '🎮 <b>DANH SÁCH GAME</b>\n\n' + lines.join('\n'), kb([[btn('◀️', 'adm:home', 'primary')]]));
  }
  if (data === 'adm:bc' && isAdmin(uid)) {
    sessions[uid] = { await: 'adm_bc' };
    return send(chatId, '📣 <b>BẮN THÔNG BÁO</b>\nNhập nội dung mày muốn gửi tới toàn bộ đàn em:');
  }
}

/* ───────── Messages ───────── */
async function onMessage(msg) {
  if (!msg || !msg.chat) return;
  const chatId = msg.chat.id;
  const from = msg.from;
  const uid = uidOf(from);
  const text = (msg.text || '').trim();

  if (text === '/start' || text === '/menu') {
    ensureUser(uid); saveUsers();
    return showUserMenu(chatId, from);
  }
  if (text === '/admin' && isAdmin(uid)) return showAdmin(chatId, from);

  if (text.startsWith('/grant ') && isAdmin(uid)) {
    const parts = text.split(/\s+/);
    if (parts.length >= 3) {
      const targetUid = parts[1];
      const hours = Number(parts[2]);
      if (hours > 0) {
        grantVip(targetUid, hours);
        send(chatId, `✅ Đã ban phát <b>${hours}h</b> cho đàn em <code>${targetUid}</code>`);
        send(targetUid, `🎉 <b>CHÚC MỪNG CON TRAI!</b> 🎉\n\nBố mày đã ban phát <b>${hours} giờ VIP</b> cho mày.\nHạn sử dụng: <b>${vipText(targetUid).expire}</b>\n\n🔥 Vào cày cuốc đi!`, kb([[btn('🎯 SOI CẦU NGAY', 'pred:brands', 'success')]]));
      }
    } else {
      send(chatId, '⚠️ Cú pháp: <code>/grant ID_User Số_Giờ</code>');
    }
    return;
  }

  const st = sessions[uid];
  if (st) {
    if (st.await === 'hash_input') {
      delete sessions[uid];
      const hashStr = text.toLowerCase();
      
      // Check MD5 (32) or SHA256 (64)
      if (!/^[a-f0-9]{32}$/.test(hashStr) && !/^[a-f0-9]{64}$/.test(hashStr)) {
        return send(chatId, '❌ <b>MÃ HASH ĐÉO HỢP LỆ!</b>\n\nYêu cầu nhập đúng MD5 (32 ký tự) hoặc SHA256 (64 ký tự).', kb([[btn('🧩 THỬ LẠI', 'hash:start', 'primary')], [btn('🏠 VỀ MENU', 'menu', 'danger')]]));
      }
      
      const type = hashStr.length === 32 ? 'MD5' : 'SHA256';
      const pred = predictHash(hashStr);
      const sideTxt = pred.side === 'T' ? 'TÀI' : 'XỈU';
      const sideIcon = pred.side === 'T' ? '🔴' : '🔵';
      
      const filled = Math.max(0, Math.min(10, Math.round((pred.conf || 52) / 10)));
      const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

      const textOut =
`🧩 <b>KẾT QUẢ PHÂN TÍCH ${type}</b>

🔑 <b>Hash:</b> <code>${esc(hashStr)}</code>

🎯 <b>DỰ ĐOÁN:</b> ${sideIcon} <b>${sideTxt}</b>
⚡ <b>Tỉ lệ nổ:</b> <b>${pred.conf}%</b>
<code>${bar}</code>
💡 <b>Phân tích:</b> ${esc(pred.reason)}

👇 <i>Nếu phiên vừa rồi đúng, bấm ĐÚNG. Nếu sai, bấm SAI:</i>`;

      return send(chatId, textOut, kb([
        [btn('✅ ĐÚNG', 'hash_fb:ok', 'success'), btn('❌ SAI', 'hash_fb:no', 'danger')],
        [btn('🏠 VỀ MENU', 'menu', 'primary')]
      ]));
    }

    if (st.await === 'adm_bc' && isAdmin(uid)) {
      delete sessions[uid];
      let count = 0;
      for (const id of Object.keys(users)) {
        try { await send(id, `📣 <b>THÔNG BÁO TỪ BỐ MÀY</b>\n\n${esc(text)}`); count++; } catch {}
      }
      return send(chatId, `✅ Đã bắn thành công tới <b>${count}</b> đàn em.`);
    }
  }
}

/* ───────── Polling Loop ───────── */
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
        } catch (e) { console.error('update_err', e.message); }
      }
    }
  } catch (e) {
    await new Promise(r => setTimeout(r, 2000));
  }
  setImmediate(loop);
}

/* ───────── HTTP Server ───────── */
const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_, res) => res.json({ ok: true, bot: 'DUDOANTX', time: nowVN(), games: games.length }));

app.listen(PORT, '0.0.0.0', () => {
  console.log('DUDOANTX running on port', PORT);
  if (BOT_TOKEN) {
    tg('getMe').then(j => console.log('Bot auth:', j?.result?.username));
    loop();
  }
  pollAll().catch(() => {});

  if (PUBLIC_URL) {
    const ping = () => {
      try {
        const u = new URL(PUBLIC_URL + '/health');
        const mod = u.protocol === 'https:' ? https : http;
        const req = mod.get(u, res => res.on('data', () => {}).on('end', () => {}));
        req.on('error', () => {});
        req.setTimeout(10000, () => req.destroy());
      } catch {}
    };
    setInterval(ping, 10 * 60 * 1000);
    setTimeout(ping, 30000);
  }
});