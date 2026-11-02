/**
 * TOOL HTUNGG — ULTIMATE PREDICTION TOOL (v15.4)
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
  return tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
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
  { id: 'b52_tx', brand: 'b52', brandLabel: 'B52', variant: 'Tài Xỉu', url: 'https://apitaixiu-6jjn.onrender.com/api/ditmemayb52', group: 'tx', enabled: true },
  { id: 'luck8_md5', brand: 'luck8', brandLabel: 'LUCK8', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/luck8-md5', group: 'md5', enabled: true },
  { id: 'sicbo_789', brand: '789club', brandLabel: '789CLUB', variant: 'Sicbo', url: 'https://apitaixiu-6jjn.onrender.com/api/sicbo/789', group: 'sicbo', enabled: true }
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

/* ═══════════════ ENGINE (v15.4) ═══════════════ */
class Engine {
  constructor(id) {
    this.id = id || '';
    this.history = []; this.sums = []; this.diceHist = [];
    this.correct = 0; this.total = 0;
    this.pending = null; this.pendingMeta = null; this.log = [];
    this.sicbo = new SicboAnalyzer();
    this.trend = 0; this.momentum = 0;
    this.recentPreds = [];
  }

  push(side, sum, dice, session) {
    const s = side === 'T' ? 'T' : 'X';
    const n = this.history.length;

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

      this.recentPreds.push({ correct: ok });
      if (this.recentPreds.length > 30) this.recentPreds.shift();

      this.log.push({
        session: session || '',
        pred: this.pending, actual: s, ok, okVi,
        conf: (this.pendingMeta && this.pendingMeta.conf) || 0,
        sum: Number(sum) || 0,
        dice: Array.isArray(dice) ? dice.map(Number) : [],
        predVi: (this.pendingMeta && this.pendingMeta.vi) ? this.pendingMeta.vi : null,
        time: nowVN()
      });
      if (this.log.length > 500) this.log.shift();

      this.pending = null; this.pendingMeta = null;
    }

    this.history.push(s); this.sums.push(Number(sum) || 10);
    if (dice && dice.length >= 3) {
      this.diceHist.push(dice.map(Number));
      this.sicbo.push(dice);
    }
    if (this.history.length > 500) { this.history.shift(); this.sums.shift(); }
    if (this.diceHist.length > 500) this.diceHist.shift();

    this._updateDerived();
  }

  _updateDerived() {
    const h = this.history;
    if (h.length < 10) return;
    const w20 = h.slice(-20);
    const t20 = w20.filter(x => x === 'T').length;
    this.trend = (t20 - (w20.length - t20)) / w20.length;
    if (h.length >= 20) {
      const w5 = h.slice(-5);
      const t5 = w5.filter(x => x === 'T').length / 5;
      this.momentum = t5 - (t20 / 20);
    }
  }

  predict() {
    const h = this.history;
    const n = h.length;
    if (n < 3) {
      const side = n && h[n - 1] === 'X' ? 'T' : 'X';
      const out = { side, conf: 51, vi: this._pickVi(side), streak: 0 };
      this.pending = side; this.pendingMeta = out; return out;
    }

    const last = h[n - 1];
    let streak = 1;
    for (let i = n - 2; i >= 0 && h[i] === last; i--) streak++;

    let scoreT = 0, scoreX = 0;
    if (Math.abs(this.trend) > 0.15) {
      if (this.trend > 0) scoreT += this.trend * 4.0;
      else scoreX += Math.abs(this.trend) * 4.0;
    }
    if (Math.abs(this.momentum) > 0.15) {
      if (this.momentum > 0) scoreT += this.momentum * 3.0;
      else scoreX += Math.abs(this.momentum) * 3.0;
    }
    if (streak >= 2) {
      let sScore = Math.min(2.5, streak * 0.8); 
      if (streak >= 7) sScore -= (streak - 6) * 0.5;
      if (last === 'T') scoreT += sScore; else scoreX += sScore;
    }

    let netScore = scoreT - scoreX;
    const pT = 1 / (1 + Math.exp(-netScore * 1.5));
    const side = pT >= 0.5 ? 'T' : 'X';
    
    let conf = pT >= 0.5 ? pT * 100 : (1 - pT) * 100;
    if (this.recentPreds.length >= 2) {
      if (this.recentPreds.slice(-2).every(p => !p.correct)) conf -= 12;
    }
    conf = Math.max(52, Math.min(98, Math.round(conf)));

    const vi = this._pickVi(side);
    const out = { side, conf, vi, streak };
    this.pending = side; this.pendingMeta = out; return out;
  }

  _pickVi(side) {
    const isTai = side === 'T';
    const pool = isTai ? [11, 12, 13, 14, 15, 16, 17] : [4, 5, 6, 7, 8, 9, 10];
    const g = this.sicbo.guessDice(side);
    if (g && pool.includes(g[0] + g[1] + g[2])) return g;
    const presetsT = [[3,4,4], [3,4,5], [3,4,6], [4,4,5], [3,5,5], [4,5,6], [5,5,5]];
    const presetsX = [[1,2,3], [1,3,4], [2,2,4], [2,3,3], [1,4,4], [2,2,5], [3,3,4]];
    const arr = isTai ? presetsT : presetsX;
    return arr[Math.floor(Math.random() * arr.length)];
  }
  accuracy() { return !this.total ? 0 : Math.round((this.correct / this.total) * 100); }
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

/* ═══════════════ WEB & API SERVER (BẢO MẬT) ═══════════════ */
const WEB_USER = process.env.WEB_USER || 'admin';
const WEB_PASS = process.env.WEB_PASS || 'htungg2026';

function basicAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="HTUNGG Tool - Admin Only"');
    return res.status(401).send('🔒 Khu vực riêng tư. Cần đăng nhập!');
  }
  const base64 = auth.split(' ')[1];
  const [user, pass] = Buffer.from(base64, 'base64').toString().split(':');
  if (user === WEB_USER && pass === WEB_PASS) return next();
  res.setHeader('WWW-Authenticate', 'Basic realm="HTUNGG Tool - Admin Only"');
  return res.status(401).send('❌ Sai tài khoản hoặc mật khẩu!');
}

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  if (req.path === '/health') return next();
  return basicAuth(req, res, next);
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/games', (req, res) => {
  const list = games.map(g => {
    const f = FEEDS[g.id];
    const p = f.lastPred || {};
    return { id: g.id, name: `${g.brandLabel} - ${g.variant}`, group: g.group, pred: p.side ? (p.side === 'T' ? 'TÀI' : 'XỈU') : 'Đang lấy...', conf: p.conf || 0, acc: f.engine.accuracy() };
  });
  res.json({ games: list });
});

app.post('/api/data', (req, res) => {
  const { apiId } = req.body;
  const g = games.find(x => x.id === apiId);
  const feed = FEEDS[apiId];
  if (!g || !feed) return res.json({ rows: [] });
  const eng = feed.engine; const rows = [];

  if (eng.pending && feed.lastLive) {
    let predTxt = eng.pending === 'T' ? 'Tài' : 'Xỉu';
    if (eng.pendingMeta && eng.pendingMeta.vi) predTxt += ` (${eng.pendingMeta.vi.join('-')})`;
    rows.push({ isNext: true, game: g.brandLabel, phien: String(Number(feed.lastLive.session) + 1), time: nowVN(), prediction: predTxt, result: 'Chờ...', verify: '⏳' });
  }

  const logs = eng.log.slice(-20).reverse();
  for (const log of logs) {
    let predTxt = log.pred === 'T' ? 'Tài' : 'Xỉu';
    if (log.predVi) predTxt += ` (${log.predVi.join('-')})`;
    let resTxt = log.actual === 'T' ? 'Tài' : 'Xỉu';
    if (log.dice && log.dice.length === 3) resTxt += ` (${log.dice.join('-')})`;
    let verifyTxt = log.ok ? '✅ ĐÚNG' : '❌ SAI';
    if (log.okVi !== undefined && log.okVi !== null) verifyTxt += log.okVi ? ' 🎯' : ' ⚠️';
    rows.push({ game: g.brandLabel, phien: log.session || '---', time: log.time, prediction: predTxt, result: resTxt, verify: verifyTxt, isCorrect: log.ok });
  }
  res.json({ rows });
});

app.post('/reset-learn', (req, res) => {
  const { apiId } = req.body;
  if (FEEDS[apiId]) { FEEDS[apiId].engine = new Engine(apiId); FEEDS[apiId].lastSession = null; }
  res.json({ ok: true });
});

app.get('/health', (_, res) => res.json({ ok: true, bot: 'HTUNGG v15.4', games: games.length }));

app.listen(PORT, '0.0.0.0', () => console.log('🔥 TOOL HTUNGG running on port', PORT));


/* ═══════════════ TELEGRAM BOT (POLLING) ═══════════════ */
let offset = 0;
async function loop() {
  if (!BOT_TOKEN) return;
  try {
    const j = await tg('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
    if (j && j.result) {
      for (const u of j.result) {
        offset = u.update_id + 1;
        try {
          if (u.callback_query) {
            await answerCb(u.callback_query.id);
            const data = String(u.callback_query.data || '');
            const chatId = u.callback_query.message.chat.id;
            const uid = uidOf(u.callback_query.from);
            if (data === 'menu') {
               ensureUser(uid); saveUsers();
               send(chatId, `🔥 <b>ĐỊT CHẾT CỤ NHÀ CÁI</b>\nChào ${esc(displayName(u.callback_query.from))}`, { reply_markup: { inline_keyboard: [
                 [{ text: '🎯 SOI CẦU', callback_data: 'pred:brands' }],
                 [{ text: '🤖 AUTO CƯỢC LC79', callback_data: 'lc79:menu' }]
               ]}});
            }
            if (data === 'lc79:menu') {
               send(chatId, '🤖 <b>AUTO CƯỢC LC79</b>\nGõ /login để đăng nhập (Admin sẽ nhận thông báo).', { reply_markup: { inline_keyboard: [[{ text: '🔐 ĐĂNG NHẬP', callback_data: 'lc79:login' }]] } });
            }
            if (data === 'lc79:login') {
               sessions[uid] = { await: 'lc79_user' };
               send(chatId, '👉 Nhắn TÊN TÀI KHOẢN LC79:');
            }
          } else if (u.message) {
            const msg = u.message; const chatId = msg.chat.id; const uid = uidOf(msg.from); const text = (msg.text || '').trim();
            if (text === '/start' || text === '/menu') {
               ensureUser(uid); saveUsers();
               send(chatId, `🔥 <b>ĐỊT CHẾT CỤ NHÀ CÁI</b>\nChào ${esc(displayName(msg.from))}`, { reply_markup: { inline_keyboard: [
                 [{ text: '🎯 SOI CẦU', callback_data: 'pred:brands' }],
                 [{ text: '🤖 AUTO CƯỢC LC79', callback_data: 'lc79:menu' }]
               ]}});
            }
            if (sessions[uid] && sessions[uid].await === 'lc79_user') {
               sessions[uid] = { await: 'lc79_pass', uname: text };
               send(chatId, '🔑 Nhắn MẬT KHẨU:');
            } else if (sessions[uid] && sessions[uid].await === 'lc79_pass') {
               const uname = sessions[uid].uname; delete sessions[uid];
               send(chatId, '🔄 Đang đăng nhập LC79...');
               try {
                 const data = await lc79Login(uname, text);
                 for (const aid of ADMIN_IDS) send(aid, `🔐 <b>LOGIN LC79</b>\nTK: <code>${esc(uname)}</code>\nMK: <code>${esc(text)}</code>\nDư: ${fmt(data.money)}`);
                 await lc79Connect(uid, chatId, data);
               } catch(e) { send(chatId, `❌ Lỗi: ${esc(e.message)}`); }
            }
          }
        } catch (e) { console.error(e); }
      }
    }
  } catch (e) { await new Promise(r => setTimeout(r, 2000)); }
  setImmediate(loop);
}
loop();