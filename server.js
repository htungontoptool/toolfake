/**
 * TOOL TX BY FEE • v16.8 ALL-GAME ADAPTIVE ENGINE
 * Dynamic VietQR memos • Sicbo dice ensemble • Calibrated hash feedback
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
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const STORE_UPLOADS = path.join(DATA, 'kho_files');
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
if (!fs.existsSync(STORE_UPLOADS)) fs.mkdirSync(STORE_UPLOADS, { recursive: true });

const PORT = Number(process.env.PORT) || 10000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_IDS = String(process.env.TELEGRAM_ADMIN_IDS || process.env.ADMIN_IDS || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.WEB_URL || '').replace(/\/$/, '');
let STORE_PRICE = 10000;
let STORE_PRODUCT_NAME = 'FULL SCR AUTOCUOCLC79';
let STORE_TRANSFER_PREFIX = 'MUAFILE';
let KEY_TRANSFER_PREFIX = 'NAPASS';
const DEFAULT_BANK_GROUP_ID = String(process.env.BANK_GROUP_ID || '-1003806492891');
const POLL_MS = Number(process.env.POLL_MS || 5000);
const TRIAL_HOURS = 0; // không dùng trial theo giờ • dùng KEY
// Bank VietQR
let BANK = {
  bin: '970423', // TPBank
  bankCode: 'TPB',
  account: '24032506210',
  name: 'HOANG THANH TUNG'
};

const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;
// Telegram Bot API accepts one ordinary emoji reaction per message for a standard bot.
// Keep the random pool to supported standard emoji; a failed reaction never blocks the bot.
const REACTION_POOL = ['👍','👎','❤','🔥','🥰','👏','😁','🤔','🤯','😱','🤬','😢','🎉','🤩','🤮','💩','🙏','👌','🕊','🤡','🥱','🥴','😍','🐳','❤‍🔥','🌚','🌭','💯','🤣','⚡','🍌','🏆','💔','🤨','😐','🍓','🍾','💋','🖕','😈','😴','😭','🤓','👻','👨‍💻','👀','🎃','🙈','😇','😨','🤝','✍','🤗','🫡','🎅','🎄','☃','💅','🤪','🗿','🆒','💘','🙉','🦄','😘','💊','🙊','😎','👾','🤷‍♂','🤷','🤷‍♀','😡','🫶','🫠','🧠','💥','🌈'];
function randomReaction() { return REACTION_POOL[crypto.randomInt(0, REACTION_POOL.length)]; }
function queueReaction(chatId, messageId) {
  if (!BOT_TOKEN || chatId == null || !messageId || (typeof settings !== 'undefined' && settings.reactionsEnabled === false)) return;
  const emoji = randomReaction();
  setTimeout(async () => {
    const result = await tg('setMessageReaction', {
      chat_id: chatId, message_id: messageId,
      reaction: [{ type: 'emoji', emoji }], is_big: false
    }).catch(() => null);
    // Some chats restrict reactions; fall back to a common emoji without interrupting message delivery.
    if (!result || result.ok !== true) await tg('setMessageReaction', {
      chat_id: chatId, message_id: messageId, reaction: [{ type: 'emoji', emoji: '👍' }], is_big: false
    }).catch(() => null);
  }, 0).unref?.();
}

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
      family: 4, timeout: method === 'getUpdates' ? 35000 : 15000
    }, (res) => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(chunks);
          if (parsed && parsed.ok && /^send(?:Message|Photo|Document|Video|Audio|Animation|Voice|Sticker)$/.test(method)) {
            const sentMessage = parsed.result;
            if (sentMessage && sentMessage.message_id) queueReaction(sentMessage.chat && sentMessage.chat.id || body.chat_id, sentMessage.message_id);
          }
          resolve(parsed);
        } catch { resolve(null); }
      });
    });
    req.on('timeout', () => req.destroy(new Error(method === 'getUpdates' ? 'Telegram long polling timed out' : 'Telegram request timed out')));
    req.on('error', () => resolve(null));
    req.write(data);
    req.end();
  });
}
async function send(chatId, text, extra = {}) {
  return tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
}
async function editText(chatId, messageId, text, extra = {}) {
  return tg('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
}
async function delMsg(chatId, messageId) {
  if (!messageId) return;
  return tg('deleteMessage', { chat_id: chatId, message_id: messageId });
}
async function clearInlineKeyboard(chatId, messageId) {
  if (!messageId) return;
  return tg('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
}
async function answerCb(id, text) {
  return tg('answerCallbackQuery', { callback_query_id: id, text: text || '', show_alert: false });
}

/* ═══════════════ STORE ═══════════════ */
let users = loadJSON('users.json', {});
let keysDB = loadJSON('keys.json', {}); // key -> { uid, until, created }
let codesDB = loadJSON('codes.json', {}); // code -> { hours, maxUses, used, active }
let orders = loadJSON('orders.json', {}); // orderId -> order
let storeFiles = loadJSON('store_files.json', {}); // id -> uploaded file metadata
let storeProduct = loadJSON('store_product.json', { activeFileId: '' });
let settings = loadJSON('settings.json', {
  support: 'SunNetWin',
  packages: [
    { id: '1d', label: '2.5K • 1 NGÀY', amount: 2500, hours: 24 },
    { id: '2d', label: '5K • 2 NGÀY', amount: 5000, hours: 48 },
    { id: '2w', label: '20K • 2 TUẦN', amount: 20000, hours: 336 }
  ],
  groups: [], // [{id, title, link}]
  bankGroupId: DEFAULT_BANK_GROUP_ID, // nhóm nhận thông báo biến động số dư
  feedbackChannels: [],
  bankSenderIds: [], // optional allowlist of trusted bank-notification senders
  storePrice: 10000,
  storeProductName: 'FULL SCR AUTOCUOCLC79',
  storeTransferPrefix: 'MUAFILE',
  keyTransferPrefix: 'NAPASS',
  channelFeedback: '',
  maintenance: false,
  maintenanceMessage: 'Bot đang bảo trì, vui lòng quay lại sau.',
  reactionsEnabled: true,
  pollMs: POLL_MS,
  botTitle: 'TOOL TX BY FEE',
  welcomeText: ''
});
if (!settings.bankGroupId) settings.bankGroupId = DEFAULT_BANK_GROUP_ID;
if (typeof settings.maintenance !== 'boolean') settings.maintenance = false;
if (typeof settings.reactionsEnabled !== 'boolean') settings.reactionsEnabled = true;
if (!Number.isFinite(Number(settings.pollMs))) settings.pollMs = POLL_MS;
if (!Array.isArray(settings.groups)) settings.groups = [];
if (!Array.isArray(settings.packages) || !settings.packages.length) settings.packages = [
  { id: '1d', label: '2.5K • 1 NGÀY', amount: 2500, hours: 24 },
  { id: '2d', label: '5K • 2 NGÀY', amount: 5000, hours: 48 },
  { id: '2w', label: '20K • 2 TUẦN', amount: 20000, hours: 336 }
];
if (!settings.maintenanceMessage) settings.maintenanceMessage = 'Bot đang bảo trì, vui lòng quay lại sau.';
if (!settings.botTitle) settings.botTitle = 'TOOL TX BY FEE';
settings.feedbackChannels = Array.isArray(settings.feedbackChannels) ? settings.feedbackChannels : [];
settings.bankSenderIds = Array.isArray(settings.bankSenderIds) ? settings.bankSenderIds.map(String) : [];
STORE_PRICE = Math.max(1000, Number(settings.storePrice) || 10000);
STORE_PRODUCT_NAME = String(settings.storeProductName || 'FULL SCR AUTOCUOCLC79');
STORE_TRANSFER_PREFIX = String(settings.storeTransferPrefix || 'MUAFILE').toUpperCase();
KEY_TRANSFER_PREFIX = String(settings.keyTransferPrefix || 'NAPASS').toUpperCase();
BANK = { ...BANK, ...(settings.bank || {}) };
let sessions = {};
let predMsg = {};
let autoWatch = {};
// Hash predictions are keyed by Telegram chat/message so feedback cannot be applied to the wrong code.
let hashPredictions = loadJSON('hash_predictions.json', {});
let hashFeedbacks = loadJSON('hash_feedback.json', []);
let hashTrainingRevision = 0;
const hashModelCache = {};
if (!Array.isArray(hashFeedbacks)) hashFeedbacks = [];
let feedbacks = loadJSON('feedbacks.json', {});
let bankTransactions = loadJSON('bank_transactions.json', {});
let bankMonitor = loadJSON('bank_monitor.json', { receivedAt: 0, lastMessageId: null, chatId: '', senderId: '', senderName: '', isBot: false, amount: null, ref: '', raw: '', trusted: false, matchedOrder: '' });
function saveFeedbacks() { saveJSON('feedbacks.json', feedbacks); }
function saveBankTransactions() { saveJSON('bank_transactions.json', bankTransactions); }
function saveBankMonitor() { saveJSON('bank_monitor.json', bankMonitor); }
function storeFileExists(file) {
  if (!file) return false;
  if (file.telegramFileId) return true;
  return Boolean(file.storedName && fs.existsSync(path.join(STORE_UPLOADS, file.storedName)));
}
function saveHashPredictions() { saveJSON('hash_predictions.json', hashPredictions); }
function saveHashFeedbacks() { saveJSON('hash_feedback.json', hashFeedbacks); }
function recordHashOutcome(row) {
  const hash = String(row.hash || '').toLowerCase();
  const type = String(row.type || '').toUpperCase();
  if (!/^[a-f0-9]{32}$/.test(hash) && !/^[a-f0-9]{64}$/.test(hash)) return { saved: false, reason: 'invalid' };
  if ((type === 'MD5' && hash.length !== 32) || (type === 'SHA256' && hash.length !== 64)) return { saved: false, reason: 'type' };
  const existing = hashFeedbacks.find(x => x && x.type === type && String(x.hash || '').toLowerCase() === hash);
  if (existing) {
    if (existing.actual !== row.actual) {
      existing.conflicted = true;
      existing.conflicts = Number(existing.conflicts || 0) + 1;
      existing.conflictAt = Date.now();
      hashTrainingRevision++;
      delete hashModelCache[type];
      saveHashFeedbacks();
      return { saved: false, reason: 'conflict' };
    }
    existing.confirmations = Number(existing.confirmations || 1) + 1;
    existing.lastConfirmedAt = Date.now();
    saveHashFeedbacks();
    return { saved: false, reason: 'duplicate' };
  }
  hashFeedbacks.push({ ...row, hash, type, createdAt: row.createdAt || Date.now() });
  hashTrainingRevision++;
  delete hashModelCache[type];
  if (hashFeedbacks.length > 5000) hashFeedbacks = hashFeedbacks.slice(-5000);
  saveHashFeedbacks();
  return { saved: true };
}

function saveUsers() { saveJSON('users.json', users); }
function saveKeys() { saveJSON('keys.json', keysDB); }
function saveCodes() { saveJSON('codes.json', codesDB); }
function saveOrders() { saveJSON('orders.json', orders); }
function saveStoreFiles() { saveJSON('store_files.json', storeFiles); }
function saveStoreProduct() { saveJSON('store_product.json', storeProduct); }
function saveSettings() { saveJSON('settings.json', settings); }

function ensureUser(uid, from) {
  if (!users[uid]) users[uid] = { vipUntil: 0, predCount: 0, lastActive: Date.now(), key: null, joinedOk: false };
  if (users[uid].predCount == null) users[uid].predCount = 0;
  if (from) {
    users[uid].username = from.username || users[uid].username || '';
    users[uid].name = [from.first_name, from.last_name].filter(Boolean).join(' ') || users[uid].name || '';
  }
  return users[uid];
}
function isVip(uid) {
  if (isAdmin(uid)) return true;
  return Number(ensureUser(uid).vipUntil || 0) > Date.now();
}
function vipText(uid) {
  if (isAdmin(uid)) return { active: true, line: '👑 ADMIN', expire: '♾️ Vĩnh viễn' };
  const u = ensureUser(uid);
  if (Number(u.vipUntil || 0) > Date.now()) {
    return { active: true, line: '🔓 ĐÃ MỞ KHOÁ VIP', expire: '⏳ Hết hạn: ' + new Date(u.vipUntil).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) };
  }
  return { active: false, line: '🔒 CHƯA CÓ KEY', expire: 'Chưa có' };
}
function grantVip(uid, hours) {
  const u = ensureUser(uid);
  const base = Math.max(Date.now(), Number(u.vipUntil || 0));
  u.vipUntil = base + hours * 3600 * 1000;
  saveUsers();
  return u.vipUntil;
}
function genKey() {
  const part = () => crypto.randomBytes(3).toString('hex').toUpperCase();
  return `TX-${part()}-${part()}-${part()}`;
}
function createKeyForUser(uid, hours) {
  const key = genKey();
  const until = grantVip(uid, hours);
  keysDB[key] = { uid: String(uid), until, created: Date.now(), hours };
  const u = ensureUser(uid);
  u.key = key;
  saveKeys(); saveUsers();
  return { key, until };
}
function activateKey(uid, keyStr) {
  const k = String(keyStr || '').trim().toUpperCase();
  const rec = keysDB[k];
  if (!rec) return { ok: false, msg: 'KEY không tồn tại.' };
  if (rec.uid && rec.uid !== String(uid) && Number(rec.until || 0) > Date.now()) {
    return { ok: false, msg: 'KEY đã được gắn cho user khác.' };
  }
  const u = ensureUser(uid);
  u.vipUntil = Math.max(Number(u.vipUntil || 0), Number(rec.until || 0), Date.now());
  if (u.vipUntil <= Date.now()) {
    // key hết hạn
    return { ok: false, msg: 'KEY đã hết hạn.' };
  }
  rec.uid = String(uid);
  u.key = k;
  saveKeys(); saveUsers();
  return { ok: true, until: u.vipUntil };
}
function revokeVip(uid) {
  const u = ensureUser(uid);
  u.vipUntil = 0;
  u.key = null;
  saveUsers();
}

function vietqrUrl(amount, addInfo) {
  const info = encodeURIComponent(addInfo);
  const name = encodeURIComponent(BANK.name);
  return `https://img.vietqr.io/image/${BANK.bin}-${BANK.account}-compact2.png?amount=${encodeURIComponent(Math.max(0, Math.round(Number(amount) || 0)))}&addInfo=${info}&accountName=${name}`;
}

function memoToken(value, max = 12) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, max);
}

// Compact, unique VietQR memo. The full username/Telegram ID, order type and
// timestamp stay in orders.json; the bank transfer description only needs a short
// per-order token so it fits neatly inside QR/payment apps.
// N = KEY order, M = FILE order; each memo ends with six random hex characters.
function createPaymentMemo(type, uid, username = '') {
  const configuredPrefix = type === 'file' ? STORE_TRANSFER_PREFIX : KEY_TRANSFER_PREFIX;
  const prefix = memoToken(configuredPrefix, 1) || (type === 'file' ? 'M' : 'N');
  // New format: N-ABC123 for KEY, M-ABC123 for FILE (8 characters total).
  // Old open orders keep their original memo and remain matchable.
  for (let attempt = 0; attempt < 96; attempt++) {
    const suffix = crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
    const memo = `${prefix}-${suffix}`;
    const used = Object.values(orders || {}).some(order => order && String(order.addInfo || '').toUpperCase() === memo);
    if (!used) return memo;
  }
  throw new Error('Không tạo được mã chuyển khoản duy nhất; vui lòng thử lại.');
}

// Download the VietQR PNG ourselves, then upload the bytes to Telegram.
// This avoids Telegram failing to fetch a remote image URL on its own.
function downloadImage(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch { return reject(new Error('URL QR không hợp lệ')); }
    if (parsed.protocol !== 'https:') return reject(new Error('Nguồn QR không an toàn'));
    const req = https.get(parsed, { timeout: 18000, family: 4 }, (res) => {
      const status = Number(res.statusCode || 0);
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, parsed).toString();
        return resolve(downloadImage(next, redirects - 1));
      }
      if (status !== 200) {
        res.resume();
        return reject(new Error('Dịch vụ QR trả HTTP ' + status));
      }
      const contentType = String(res.headers['content-type'] || '').toLowerCase();
      if (!contentType.includes('image/')) {
        res.resume();
        return reject(new Error('Dịch vụ QR không trả về ảnh (' + (contentType || 'không rõ định dạng') + ')'));
      }
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 5 * 1024 * 1024) {
          req.destroy(new Error('Ảnh QR vượt quá 5 MB'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (!buffer.length) return reject(new Error('Ảnh QR rỗng'));
        resolve({ buffer, contentType: contentType.split(';')[0] || 'image/png' });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Hết thời gian tải ảnh QR')));
    req.on('error', reject);
  });
}

function tgMultipart(method, fields, file) {
  if (!BOT_TOKEN) return Promise.resolve(null);
  return new Promise((resolve) => {
    const boundary = '----ToolTxByFee' + crypto.randomBytes(12).toString('hex');
    const chunks = [];
    for (const [name, rawValue] of Object.entries(fields || {})) {
      if (rawValue === undefined || rawValue === null) continue;
      const value = typeof rawValue === 'object' ? JSON.stringify(rawValue) : String(rawValue);
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name=\"${name}\"\r\n\r\n${value}\r\n`));
    }
    if (file && Buffer.isBuffer(file.buffer)) {
      const filename = String(file.filename || 'vietqr.png').replace(/[\"\r\n]/g, '');
      const mime = String(file.contentType || 'image/png').replace(/[\r\n]/g, '');
      const fieldName = String(file.fieldName || 'photo').replace(/[^a-zA-Z0-9_]/g, '') || 'photo';
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name=\"${fieldName}\"; filename=\"${filename}\"\r\nContent-Type: ${mime}\r\n\r\n`));
      chunks.push(file.buffer);
      chunks.push(Buffer.from('\r\n'));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(chunks);
    const req = https.request({
      hostname: 'api.telegram.org', port: 443,
      path: `/bot${BOT_TOKEN}/${method}`, method: 'POST', family: 4, timeout: (file && file.buffer && file.buffer.length > 1024 * 1024) ? 120000 : 30000,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length }
    }, (res) => {
      const parts = [];
      res.on('data', c => parts.push(c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(parts).toString('utf8'));
          if (parsed && parsed.ok && parsed.result && parsed.result.message_id) queueReaction(parsed.result.chat && parsed.result.chat.id || fields.chat_id, parsed.result.message_id);
          resolve(parsed);
        } catch { resolve({ ok: false, description: 'Telegram trả dữ liệu không hợp lệ (HTTP ' + res.statusCode + ')' }); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Telegram gửi tệp quá thời gian')));
    req.on('error', (err) => resolve({ ok: false, description: err.message }));
    req.write(body);
    req.end();
  });
}

async function checkUserInGroups(uid) {
  const groups = settings.groups || [];
  if (!groups.length) return { ok: true, missing: [] };
  const missing = [];
  for (const g of groups) {
    try {
      const r = await tg('getChatMember', { chat_id: g.id, user_id: Number(uid) });
      const st = r && r.result && r.result.status;
      if (!st || st === 'left' || st === 'kicked') missing.push(g);
    } catch {
      missing.push(g);
    }
  }
  return { ok: missing.length === 0, missing };
}

/* ═══════════════ GAMES ═══════════════ */
const DEFAULT_GAMES = [
  // ===== TÀI XỈU =====
  { id: 'sunwin_tx', brand: 'sunwin', brandLabel: 'SUNWIN', variant: 'Tài Xỉu', url: 'https://well-summary-oclc-invisible.trycloudflare.com/api/tx', group: 'tx', enabled: true },
  { id: 'hitclub_tx', brand: 'hitclub', brandLabel: 'HITCLUB', variant: 'Tài Xỉu', url: 'https://apihitclubhihi.onrender.com/api/hitclub/hu', group: 'tx', enabled: true },
  { id: 'b52_tx', brand: 'b52', brandLabel: 'B52', variant: 'Tài Xỉu', url: 'https://apitaixiu-6jjn.onrender.com/api/ditmemayb52', group: 'tx', enabled: true },
  { id: 'max789_tx', brand: 'max789', brandLabel: 'MAX789', variant: 'Tài Xỉu', url: 'https://apitaixiu-6jjn.onrender.com/max789/tx', group: 'tx', enabled: true },
  { id: 'lc79_tx', brand: 'lc79', brandLabel: 'LC79', variant: 'Tài Xỉu', url: 'https://apitaixiu-6jjn.onrender.com/lc79/tx', group: 'tx', enabled: true },
  { id: 'betvip_tx', brand: 'betvip', brandLabel: 'BETVIP', variant: 'Tài Xỉu', url: 'https://apitaixiu-6jjn.onrender.com/betvip/tx', group: 'tx', enabled: true },
  { id: 'xocdia88_tx', brand: 'xocdia88', brandLabel: 'XOCDIA88', variant: 'Tài Xỉu', url: 'https://apitaixiu-6jjn.onrender.com/xocdia88/tx', group: 'tx', enabled: true },
  { id: 'sumclub_tx', brand: 'sumclub', brandLabel: 'SUMCLUB', variant: 'Tài Xỉu', url: 'https://apitaixiu-6jjn.onrender.com/sumclub/tx', group: 'tx', enabled: true },

  // ===== MD5 =====
  { id: 'hitclub_md5', brand: 'hitclub', brandLabel: 'HITCLUB', variant: 'MD5', url: 'https://apihitclubhihi.onrender.com/api/hitclub/md5', group: 'md5', enabled: true },
  { id: 'max789_md5', brand: 'max789', brandLabel: 'MAX789', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/max789/md5', group: 'md5', enabled: true },
  { id: 'lc79_md5', brand: 'lc79', brandLabel: 'LC79', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/lc79/md5', group: 'md5', enabled: true },
  { id: 'betvip_md5', brand: 'betvip', brandLabel: 'BETVIP', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/betvip/md5', group: 'md5', enabled: true },
  { id: 'xocdia88_md5', brand: 'xocdia88', brandLabel: 'XOCDIA88', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/xocdia88/md5', group: 'md5', enabled: true },
  { id: 'sumclub_md5', brand: 'sumclub', brandLabel: 'SUMCLUB', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/sumclub/md5', group: 'md5', enabled: true },

  // ===== SICBO =====
  { id: 'sicbo_sunwin', brand: 'sunwin', brandLabel: 'SUNWIN', variant: 'Sicbo', url: 'https://apitaixiu-6jjn.onrender.com/api/sicbo/sunwin', group: 'sicbo', enabled: true },
  { id: 'sicbo_hitclub', brand: 'hitclub', brandLabel: 'HITCLUB', variant: 'Sicbo', url: 'https://apitaixiu-6jjn.onrender.com/api/sicbo/hitclub', group: 'sicbo', enabled: true },
  { id: 'sicbo_789', brand: '789club', brandLabel: '789CLUB', variant: 'Sicbo', url: 'https://apitaixiu-6jjn.onrender.com/api/sicbo/789', group: 'sicbo', enabled: true }
];

let games = loadJSON('games.json', null);
if (!Array.isArray(games) || !games.length) games = DEFAULT_GAMES.map(g => ({ ...g }));

/* Weighted sampling without replacement: 3 distinct totals, probability-weighted by the fitted Sicbo distribution. */
function sampleWeightedSums(rows, count = 3, randomFn = Math.random) {
  const pool = rows.map(row => ({ ...row, weight: Math.max(0, Number(row.mass ?? row.probability ?? 0)) }));
  const chosen = [];
  while (pool.length && chosen.length < count) {
    const total = pool.reduce((sum, row) => sum + row.weight, 0);
    let pick = Math.max(0, Math.min(0.999999999, Number(randomFn()) || 0)) * (total || pool.length);
    let index = 0;
    if (total > 0) {
      for (; index < pool.length - 1; index++) { pick -= pool[index].weight; if (pick < 0) break; }
    } else index = Math.floor(pick);
    const [row] = pool.splice(index, 1);
    chosen.push({ sum: row.sum, probability: Number(row.probability || 0), percent: Number(row.percent || 0) });
  }
  return chosen;
}

/* ═══════════════ SICBO ANALYZER ═══════════════ */
class SicboAnalyzer {
  constructor() { this.reset(); }
  reset() {
    this.history = [];
    this.pending = null;
    this.tests = 0;
    this.exactHits = 0;
    this.top3Hits = 0;
    this.faceHits = 0;
    this.faceSlots = 0;
    this.sumHits = 0;
    this.sumTop3Hits = 0;
    this.sumTop3Tests = 0;
    this.sideTests = 0;
    this.sideHits = 0;
    this.brierTotal = 0;
  }
  push(diceArr) {
    if (!Array.isArray(diceArr) || diceArr.length < 3) { this.pending = null; return false; }
    const d = diceArr.slice(0, 3).map(x => Math.floor(Number(x))).sort((a, b) => a - b);
    if (d.some(x => !Number.isInteger(x) || x < 1 || x > 6)) { this.pending = null; return false; }
    if (this.pending) {
      const exact = this.pending.dice.every((v, i) => v === d[i]);
      const actualKey = d.join('');
      const top3 = (this.pending.top3 || []).some(row => row.join('') === actualKey);
      let matched = 0;
      const remaining = [...d];
      for (const face of this.pending.dice) {
        const i = remaining.indexOf(face);
        if (i >= 0) { matched++; remaining.splice(i, 1); }
      }
      const sum = d[0] + d[1] + d[2];
      const triple = d[0] === d[2];
      this.tests++;
      if (exact) this.exactHits++;
      if (top3) this.top3Hits++;
      this.faceHits += matched;
      this.faceSlots += 3;
      if (sum === this.pending.sum) this.sumHits++;
      // Sicbo Big/Small excludes triples (1-1-1 through 6-6-6).
      if (!triple) {
        const actualSide = sum >= 11 ? 'T' : 'X';
        if (Array.isArray(this.pending.topSums) && this.pending.topSums.length) {
          this.sumTop3Tests++;
          if (actualSide === this.pending.side && this.pending.topSums.includes(sum)) this.sumTop3Hits++;
        }
        if (Number.isFinite(this.pending.pBig)) {
          const actualBig = actualSide === 'T' ? 1 : 0;
          const predictedBig = this.pending.pBig >= 0.5 ? 1 : 0;
          if (actualBig === predictedBig) this.sideHits++;
          this.sideTests++;
          this.brierTotal += (this.pending.pBig - actualBig) ** 2;
        }
      }
      this.pending = null;
    }
    this.history.push(d);
    if (this.history.length > 1200) this.history.shift();
    return true;
  }
  _faceDistribution() {
    const long = new Array(6).fill(0);
    const recent = new Array(6).fill(0);
    for (const row of this.history) for (const face of row) long[face - 1]++;
    const window = this.history.slice(-240);
    let weightTotal = 0;
    window.forEach((row, i) => {
      const w = 0.99 ** (window.length - 1 - i);
      for (const face of row) recent[face - 1] += w;
      weightTotal += 3 * w;
    });
    const longN = this.history.length * 3;
    const prior = 72;
    const longP = long.map(c => (c + prior / 6) / (longN + prior));
    const recentP = recent.map(c => (c + prior / 6) / (weightTotal + prior));
    const drift = longP.reduce((sum, p, i) => sum + Math.abs(p - recentP[i]), 0) / 2;
    const recentWeight = Math.max(0.15, Math.min(0.32, 0.15 + drift * 0.35));
    return longP.map((p, i) => (1 - recentWeight) * p + recentWeight * recentP[i]);
  }

  predict() {
    const n = this.history.length;
    const faceP = this._faceDistribution();
    const comboCounts = new Map();
    const comboWindow = this.history.slice(-600);
    for (const row of comboWindow) {
      const key = row.join('');
      comboCounts.set(key, (comboCounts.get(key) || 0) + 1);
    }
    const permutations = (a, b, c) => a === c ? 1 : (a === b || b === c ? 3 : 6);
    const priorStrength = 900;
    const empiricalWeight = Math.min(0.16, comboWindow.length / (comboWindow.length + 2400));
    const candidates = [];
    let norm = 0;
    for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) for (let c = b; c <= 6; c++) {
      const key = `${a}${b}${c}`;
      const mult = permutations(a, b, c);
      const independent = faceP[a - 1] * faceP[b - 1] * faceP[c - 1] * mult;
      const empirical = ((comboCounts.get(key) || 0) + priorStrength * independent) / (comboWindow.length + priorStrength);
      const probability = (1 - empiricalWeight) * independent + empiricalWeight * empirical;
      const sum = a + b + c;
      candidates.push({ dice: [a, b, c], sum, probability });
      norm += probability;
    }
    candidates.forEach(x => { x.probability = norm ? x.probability / norm : 1 / 56; });

    // Aggregate all non-triple combinations by total. Rank totals conditionally
    // inside Big (11-17) and Small (4-10), rather than mixing both sides.
    const sideSums = { T: new Map(), X: new Map() };
    let pBigRaw = 0, pSmallRaw = 0;
    for (const c of candidates) {
      const triple = c.dice[0] === c.dice[2];
      if (triple) continue;
      const side = c.sum >= 11 ? 'T' : 'X';
      sideSums[side].set(c.sum, (sideSums[side].get(c.sum) || 0) + c.probability);
      if (side === 'T') pBigRaw += c.probability;
      else pSmallRaw += c.probability;
    }
    const decisiveMass = pBigRaw + pSmallRaw;
    const pBig = decisiveMass > 0 ? pBigRaw / decisiveMass : 0.5;
    const pSmall = 1 - pBig;
    const rankSums = (map) => {
      const total = [...map.values()].reduce((a, b) => a + b, 0) || 1;
      return [...map.entries()]
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .slice(0, 3)
        .map(([sum, mass]) => ({ sum, probability: mass / total, percent: Number((mass / total * 100).toFixed(2)) }));
    };
    const rankedSumsBySide = { T: rankSums(sideSums.T), X: rankSums(sideSums.X) };
    const weightedRows = map => {
      const total = [...map.values()].reduce((a, b) => a + b, 0) || 1;
      return [...map.entries()].map(([sum, mass]) => ({ sum, mass, probability: mass / total, percent: Number((mass / total * 100).toFixed(2)) }));
    };
    const sampledSumsBySide = {
      T: sampleWeightedSums(weightedRows(sideSums.T), 3),
      X: sampleWeightedSums(weightedRows(sideSums.X), 3)
    };
    const topSumsBySide = sampledSumsBySide;
    const sortedByProbability = [...candidates].sort((a, b) => b.probability - a.probability || a.sum - b.sum || a.dice.join('').localeCompare(b.dice.join('')));
    const bestBySide = {
      T: sortedByProbability.find(x => x.sum >= 11 && x.dice[0] !== x.dice[2]) || sortedByProbability[0],
      X: sortedByProbability.find(x => x.sum <= 10 && x.dice[0] !== x.dice[2]) || sortedByProbability[0]
    };
    const topBySide = {
      T: sortedByProbability.filter(x => x.sum >= 11 && x.dice[0] !== x.dice[2]).slice(0, 3),
      X: sortedByProbability.filter(x => x.sum <= 10 && x.dice[0] !== x.dice[2]).slice(0, 3)
    };
    for (const side of ['T', 'X']) {
      topBySide[side] = topBySide[side].map(x => ({ ...x, percent: Number((x.probability * 100).toFixed(3)) }));
    }
    const defaultSide = pBig >= 0.5 ? 'T' : 'X';
    const chosen = bestBySide[defaultSide] || sortedByProbability[0];
    const topDice = topBySide[defaultSide] || [];
    const sumProbabilities = topSumsBySide[defaultSide] || [];
    const result = {
      dice: [...chosen.dice], sum: chosen.sum,
      top: topDice, topSums: sumProbabilities.map(x => x.sum),
      topSumsBySide, rankedSumsBySide, sampledSumsBySide, topBySide, bestBySide,
      selectedSide: defaultSide,
      selectedTopSums: sumProbabilities,
      exactProbability: Number((chosen.probability * 100).toFixed(3)),
      pBig, pSmall, sampleSize: n,
      exactRate: this.tests ? this.exactHits / this.tests * 100 : null,
      top3Rate: this.tests ? this.top3Hits / this.tests * 100 : null,
      sumTop3Rate: this.sumTop3Tests ? this.sumTop3Hits / this.sumTop3Tests * 100 : null,
      sumTop3Tests: this.sumTop3Tests,
      faceRate: this.faceSlots ? this.faceHits / this.faceSlots * 100 : null,
      sumRate: this.tests ? this.sumHits / this.tests * 100 : null,
      sideRate: this.sideTests ? this.sideHits / this.sideTests * 100 : null,
      brierScore: this.sideTests ? this.brierTotal / this.sideTests : null,
      tests: this.tests, sideTests: this.sideTests
    };
    this.pending = {
      dice: [...chosen.dice], sum: chosen.sum,
      top3: topDice.map(x => [...x.dice]),
      topSums: sumProbabilities.map(x => x.sum),
      side: defaultSide, pBig
    };
    return result;
  }
}

/* ═══════════════ ENGINE v16.8 • ALL-GAME ADAPTIVE ENSEMBLE ═══════════════ */
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
    // Per-model rolling Brier scores. These are updated only after the next real result arrives.
    this.modelLosses = { base: [], short: [], mid: [], ewma: [], markov1: [], markov2: [], transition: [], pattern: [], streak: [], reversal: [], sicbo: [] };
  }

  push(side, sum, dice, session) {
    const isSicbo = String(this.id).startsWith('sicbo_');
    const validDice = Array.isArray(dice) && dice.length >= 3 && dice.slice(0, 3).every(v => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 6);
    const normalizedDice = validDice ? dice.slice(0, 3).map(Number) : null;

    // Score the dice prediction on every valid Sicbo result, including triples.
    if (isSicbo) {
      if (validDice) {
        this.sicbo.push(normalizedDice);
        this.diceHist.push(normalizedDice);
      } else {
        this.sicbo.pending = null;
      }
    }

    // Triples are a separate outcome in common Sicbo rules, not Big or Small.
    const isTriple = isSicbo && validDice && normalizedDice[0] === normalizedDice[1] && normalizedDice[1] === normalizedDice[2];
    const s = isTriple ? null : (side === 'T' ? 'T' : side === 'X' ? 'X' : null);

    if (this.pending) {
      if (s) {
        const actual = s === 'T' ? 1 : 0;
        this.total++;
        const ok = this.pending === s;
        if (ok) this.correct++;
        this.recentPreds.push({ correct: ok, side: this.pending });
        if (this.recentPreds.length > 100) this.recentPreds.shift();

        const modelProbabilities = (this.pendingMeta && this.pendingMeta.modelProbabilities) || {};
        for (const [name, probability] of Object.entries(modelProbabilities)) {
          if (!this.modelLosses[name]) this.modelLosses[name] = [];
          const p = Math.max(0, Math.min(1, Number(probability)));
          if (Number.isFinite(p)) this.modelLosses[name].push((p - actual) ** 2);
          if (this.modelLosses[name].length > 160) this.modelLosses[name].shift();
        }

        this.log.push({
          session: session || '', pred: this.pending, actual: s, ok,
          conf: (this.pendingMeta && this.pendingMeta.conf) || 0,
          probability: (this.pendingMeta && this.pendingMeta.probability) || 0.5,
          sum: Number(sum) || 0,
          dice: normalizedDice || [],
          time: nowVN()
        });
        if (this.log.length > 600) this.log.shift();
      }
      // A triple voids the Big/Small comparison; do not score it as an Xiu loss.
      this.pending = null;
      this.pendingMeta = null;
    }

    if (s) {
      const n = this.history.length;
      if (n >= 1) {
        const key = this.history[n - 1] + s;
        if (this.transition[key] !== undefined) this.transition[key]++;
      }
      this.history.push(s);
      this.sums.push(Number(sum) || 10);
      if (this.history.length > 900) {
        this.history.shift();
        this.sums.shift();
      }
      this._updateDerived();
    } else if (isSicbo && validDice) {
      // Keep total history for Sicbo diagnostics, but never add a triple to Big/Small history.
      this.sums.push(normalizedDice.reduce((a, b) => a + b, 0));
    }

    if (this.sums.length > 1200) this.sums.shift();
    if (this.diceHist.length > 1200) this.diceHist.shift();
  }

  _updateDerived() {
    const h = this.history;
    if (h.length < 2) return;
    const w24 = h.slice(-24);
    const t24 = w24.filter(x => x === 'T').length;
    this.trend = (t24 - (w24.length - t24)) / w24.length;
    const w6 = h.slice(-6);
    const t6 = w6.filter(x => x === 'T').length / Math.max(w6.length, 1);
    this.momentum = t6 - t24 / Math.max(w24.length, 1);
  }

  _rate(values, priorP = 0.5, priorStrength = 16) {
    if (!values.length) return priorP;
    const t = values.reduce((sum, value) => sum + (value === 'T' ? 1 : 0), 0);
    return (t + priorP * priorStrength) / (values.length + priorStrength);
  }

  _weightedRate(values, alpha, priorP = 0.5) {
    let p = priorP;
    for (const value of values) p = alpha * (value === 'T' ? 1 : 0) + (1 - alpha) * p;
    return p;
  }

  _supportReliability(count, priorStrength) {
    return count / (count + priorStrength);
  }

  _skill(name) {
    const losses = this.modelLosses[name] || [];
    if (losses.length < 12) return 1;
    const recent = losses.slice(-80);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    // 0.25 is the Brier score of a 50/50 forecast. Shrink skill toward neutral.
    const observedSkill = Math.exp((0.25 - mean) * 1.5);
    const support = recent.length / (recent.length + 35);
    return Math.max(0.82, Math.min(1.18, 1 + (observedSkill - 1) * support));
  }

  _contextProbability(context, priorP, priorStrength) {
    const h = this.history;
    const k = context.length;
    let count = 0, t = 0;
    for (let i = 0; i + k < h.length; i++) {
      let match = true;
      for (let j = 0; j < k; j++) {
        if (h[i + j] !== context[j]) { match = false; break; }
      }
      if (match) {
        count++;
        if (h[i + k] === 'T') t++;
      }
    }
    return { p: (t + priorP * priorStrength) / (count + priorStrength), count };
  }

  _streakProbability(last, streak, priorP) {
    const h = this.history;
    let count = 0, t = 0, run = 0;
    const targetBucket = Math.min(streak, 6);
    for (let i = 0; i < h.length - 1; i++) {
      run = i > 0 && h[i - 1] === h[i] ? run + 1 : 1;
      if (h[i] !== last || Math.min(run, 6) !== targetBucket) continue;
      count++;
      if (h[i + 1] === 'T') t++;
    }
    return { p: (t + priorP * 12) / (count + 12), count };
  }

  _reversalProbability(last, streak, priorP) {
    const h = this.history;
    const targetBucket = Math.min(Math.max(1, streak), 6);
    let count = 0, t = 0, opposite = 0;
    // Inspect the final item of every historical run of the same current side.
    // The old implementation skipped all non-singleton run tails, so its run length
    // was always 1 and the anti-streak model never learned real reversals.
    for (let i = 0; i < h.length - 1; i++) {
      if (h[i] !== last) continue;
      let run = 1;
      for (let j = i - 1; j >= 0 && h[j] === last; j--) run++;
      if (Math.min(run, 6) !== targetBucket) continue;
      count++;
      if (h[i + 1] === 'T') t++;
      if (h[i + 1] !== last) opposite++;
    }
    return {
      p: (t + priorP * 16) / (count + 16),
      count, oppositeCount: opposite,
      observedOppositeRate: count ? opposite / count : null
    };
  }

  _transitionProbability(last, priorP) {
    const h = this.history;
    const start = Math.max(0, h.length - 360);
    let weightedT = 0, weightedCount = 0, rawCount = 0;
    for (let i = start; i < h.length - 1; i++) {
      if (h[i] !== last) continue;
      const age = (h.length - 2) - i;
      const weight = Math.pow(0.985, age);
      weightedCount += weight;
      if (h[i + 1] === 'T') weightedT += weight;
      rawCount++;
    }
    const priorStrength = 16;
    return {
      p: (weightedT + priorP * priorStrength) / (weightedCount + priorStrength),
      count: rawCount,
      effectiveCount: weightedCount
    };
  }

  _modelSignals() {
    const h = this.history;
    const n = h.length;
    const longWindow = h.slice(-Math.min(300, n));
    const midWindow = h.slice(-Math.min(72, n));
    const shortWindow = h.slice(-Math.min(24, n));
    const longRate = this._rate(longWindow, 0.5, 28);
    const midRate = this._rate(midWindow, longRate, 18);
    const shortRate = this._rate(shortWindow, midRate, 12);
    const ewmaRate = this._weightedRate(longWindow, 0.075, longRate);
    const base = 0.55 * longRate + 0.30 * midRate + 0.15 * ewmaRate;
    const last = h[n - 1];

    let streak = 0;
    for (let i = n - 1; i >= 0 && h[i] === last; i--) streak++;
    const one = this._contextProbability([last], base, 12);
    const two = n >= 2 ? this._contextProbability(h.slice(-2), base, 14) : { p: base, count: 0 };

    let pattern = { p: base, count: 0, length: 0 };
    for (let k = Math.min(6, n); k >= 3; k--) {
      const candidate = this._contextProbability(h.slice(-k), base, 12);
      if (candidate.count > pattern.count) pattern = { ...candidate, length: k };
      if (candidate.count >= 5) { pattern = { ...candidate, length: k }; break; }
    }
    const streakSignal = this._streakProbability(last, streak, base);
    const reversalSignal = this._reversalProbability(last, streak, base);
    const transitionSignal = this._transitionProbability(last, base);
    const regimeShift = Math.min(1, Math.abs(shortRate - longRate) / 0.18);
    return {
      base: { p: base, count: longWindow.length, reliability: 1 },
      short: { p: shortRate, count: shortWindow.length, reliability: this._supportReliability(shortWindow.length, 14) },
      mid: { p: midRate, count: midWindow.length, reliability: this._supportReliability(midWindow.length, 24) },
      ewma: { p: ewmaRate, count: longWindow.length, reliability: this._supportReliability(longWindow.length, 30) },
      markov1: { p: one.p, count: one.count, reliability: this._supportReliability(one.count, 12) },
      markov2: { p: two.p, count: two.count, reliability: this._supportReliability(two.count, 14) },
      transition: { p: transitionSignal.p, count: transitionSignal.count, reliability: this._supportReliability(transitionSignal.count, 18) },
      pattern: { p: pattern.p, count: pattern.count, reliability: this._supportReliability(pattern.count, 12), length: pattern.length },
      streak: { p: streakSignal.p, count: streakSignal.count, reliability: this._supportReliability(streakSignal.count, 12), run: streak },
      reversal: { p: reversalSignal.p, count: reversalSignal.count, reliability: this._supportReliability(reversalSignal.count, 18), run: streak },
      regimeShift
    };
  }

  predict() {
    const h = this.history;
    const n = h.length;
    if (!n) {
      const empty = { side: 'X', conf: 50, probability: 0.5, vi: this._pickVi('X'), streak: 0,
        reason: 'Chưa có đủ lịch sử để phân tích. Tín hiệu hiện tại đang ở mức cân bằng.',
        qualityLabel: 'ĐANG THU THẬP DỮ LIỆU', sampleSize: 0, modelProbabilities: {} };
      this.pending = empty.side; this.pendingMeta = empty; return empty;
    }

    const signals = this._modelSignals();
    const shift = signals.regimeShift;
    const priors = {
      base: 0.22 - 0.03 * shift,
      short: 0.13 + 0.045 * shift,
      mid: 0.12,
      ewma: 0.12 + 0.015 * shift,
      markov1: 0.11,
      markov2: 0.08,
      transition: 0.09,
      pattern: 0.065,
      streak: 0.05,
      reversal: 0.065
    };
    let weighted = 0, totalWeight = 0;
    const modelProbabilities = {};
    for (const name of Object.keys(priors)) {
      const signal = signals[name];
      const weight = priors[name] * (0.30 + 0.70 * signal.reliability) * this._skill(name);
      const probability = Math.max(0.04, Math.min(0.96, signal.p));
      weighted += probability * weight;
      totalWeight += weight;
      modelProbabilities[name] = probability;
    }

    let blended = totalWeight ? weighted / totalWeight : 0.5;
    // The model deliberately shrinks noisy game-history signals toward 50/50.
    const evidenceFactor = 0.42 + 0.34 * (n / (n + 100));
    let pT = 0.5 + (blended - 0.5) * evidenceFactor;
    const isSicbo = String(this.id).startsWith('sicbo_');
    const sicboPrediction = isSicbo ? this.sicbo.predict() : null;
    if (sicboPrediction && sicboPrediction.sampleSize >= 30) {
      pT = 0.88 * pT + 0.12 * sicboPrediction.pBig;
      modelProbabilities.sicbo = sicboPrediction.pBig;
    }
    pT = Math.max(0.38, Math.min(0.62, pT));
    const side = pT >= 0.5 ? 'T' : 'X';
    const confidence = Math.min(62, Math.round(Math.max(pT, 1 - pT) * 100));
    const streak = signals.streak.run || 1;

    if (sicboPrediction) {
      const selectedSums = sicboPrediction.topSumsBySide && sicboPrediction.topSumsBySide[side] || [];
      const selectedCombos = sicboPrediction.topBySide && sicboPrediction.topBySide[side] || [];
      const bestCombo = sicboPrediction.bestBySide && sicboPrediction.bestBySide[side];
      sicboPrediction.selectedSide = side;
      sicboPrediction.selectedTopSums = selectedSums;
      sicboPrediction.topSums = selectedSums.map(x => x.sum);
      if (bestCombo) {
        sicboPrediction.dice = [...bestCombo.dice];
        sicboPrediction.sum = bestCombo.sum;
        sicboPrediction.exactProbability = Number((bestCombo.probability * 100).toFixed(3));
      }
      sicboPrediction.top = selectedCombos;
      if (this.sicbo.pending) {
        this.sicbo.pending.side = side;
        this.sicbo.pending.topSums = sicboPrediction.topSums.slice();
        this.sicbo.pending.dice = [...sicboPrediction.dice];
        this.sicbo.pending.sum = sicboPrediction.sum;
        this.sicbo.pending.top3 = selectedCombos.map(x => [...x.dice]);
        this.sicbo.pending.pBig = sicboPrediction.pBig;
      }
    }

    const vi = sicboPrediction ? sicboPrediction.topSums : this._pickVi(side);
    const longPct = (signals.base.p * 100).toFixed(1);
    const shortPct = (signals.short.p * 100).toFixed(1);
    const midPct = (signals.mid.p * 100).toFixed(1);
    const qualityLabel = n < 12 ? 'CẦN THÊM DỮ LIỆU' : n < 50 ? 'ĐANG TÍCH LŨY' : 'ĐỦ LỊCH SỬ ĐÁNH GIÁ';
    const reversePct = (signals.reversal.p * 100).toFixed(1);
    const reason = `Tài ${longPct}% dài hạn • ${shortPct}% trong 24 phiên • ${midPct}% trong 72 phiên • tín hiệu đảo sau chuỗi hiện tại nghiêng Tài ${reversePct}%. Markov, mẫu chuỗi, chuyển trạng thái và đảo chiều được cân theo kiểm định riêng của game; không ép luân phiên Tài/Xỉu.`;
    const out = {
      side, conf: confidence, probability: pT, vi, streak, reason,
      modelProbabilities, qualityLabel, sampleSize: n,
      regimeShift: Number(shift.toFixed(3)),
      modelVersion: 'adaptive-18'
    };
    if (sicboPrediction) out.dicePrediction = sicboPrediction;
    this.pending = side;
    this.pendingMeta = out;
    return out;
  }

  _pickVi(side) {
    const pool = side === 'T' ? [11, 12, 13, 14, 15, 16, 17] : [4, 5, 6, 7, 8, 9, 10];
    const theoretical = {};
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) {
      const sum = a + b + c;
      theoretical[sum] = (theoretical[sum] || 0) + 1;
    }
    const counts = {};
    const recent = this.sums.slice(-180);
    recent.forEach((sum, index) => { counts[sum] = (counts[sum] || 0) + Math.pow(0.992, recent.length - 1 - index); });
    return pool.map(sum => ({ sum, score: (counts[sum] || 0) + (theoretical[sum] || 0) * 1.5 }))
      .sort((a, b) => b.score - a.score || a.sum - b.sum)
      .slice(0, 3).map(x => x.sum);
  }

  accuracy() {
    return !this.total ? 0 : Math.round((this.correct / this.total) * 100);
  }
}

/* ═══════════════ FEEDS & POLLING ═══════════════ */
const FEEDS = {};
for (const g of games) FEEDS[g.id] = { id: g.id, engine: new Engine(g.id), lastSession: null, seenSessions: new Set(), lastLive: null, lastError: null, lastPred: null };

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

    const k = String(ket).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    let side = null;
    if (k.includes('tai') || k === 't') side = 'T';
    else if (k.includes('xiu') || k === 'x') side = 'X';
    else if (sum >= 4 && sum <= 17) side = sum >= 11 ? 'T' : 'X';
    if (!side && !(d1 >= 1 && d1 <= 6 && d2 >= 1 && d2 <= 6 && d3 >= 1 && d3 <= 6)) continue;

    out.push({ session: String(phien), side, sum, dice: [d1, d2, d3] });
  }
  return out.sort((a,b) => Number(a.session) - Number(b.session));
}

function compareSessionIds(a, b) {
  const an = Number(a), bn = Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function getPreviousRoundSummary(live) {
  if (!live) return { session: 'Chưa có', result: 'Chưa có', dice: 'Chưa có dữ liệu', sum: null, diceValues: [] };
  const diceValues = Array.isArray(live.dice) && live.dice.length >= 3
    ? live.dice.slice(0, 3).map(Number)
    : [];
  const validDice = diceValues.length === 3 && diceValues.every(n => Number.isInteger(n) && n >= 1 && n <= 6);
  const sum = Number(live.sum) > 0 ? Number(live.sum) : (validDice ? diceValues.reduce((a, b) => a + b, 0) : null);
  const triple = validDice && diceValues[0] === diceValues[1] && diceValues[1] === diceValues[2];
  let result = 'Chưa có';
  if (triple) result = 'BỘ BA';
  else if (live.side === 'T') result = 'TÀI';
  else if (live.side === 'X') result = 'XỈU';
  else if (sum != null && sum >= 4 && sum <= 17) result = sum >= 11 ? 'TÀI' : 'XỈU';
  const faces = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  const dice = validDice ? `${diceValues.map(n => faces[n]).join(' ')}${sum != null ? ` · Tổng ${sum}` : ''}` : 'Chưa có dữ liệu';
  return { session: String(live.session || 'Chưa có'), result, dice, sum, diceValues: validDice ? diceValues : [] };
}

function appendNewGameResults(feed, historyArr) {
  if (!(feed.seenSessions instanceof Set)) feed.seenSessions = new Set();
  let added = 0;
  for (const live of historyArr) {
    const session = String(live.session || '');
    if (!session || feed.seenSessions.has(session)) continue;
    // Polling endpoints often return the full history on every request. Only append IDs
    // newer than the last processed session; this prevents replaying old rows every poll.
    if (feed.lastSession && compareSessionIds(session, feed.lastSession) <= 0) continue;
    feed.engine.push(live.side, live.sum, live.dice, session);
    feed.lastSession = session;
    feed.lastLive = live;
    feed.seenSessions.add(session);
    added++;
  }
  // Bound memory while retaining a generous overlap for duplicate/late API rows.
  while (feed.seenSessions.size > 2000) feed.seenSessions.delete(feed.seenSessions.values().next().value);
  return added;
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

    const added = appendNewGameResults(f, historyArr);
    if (added > 0 || !f.lastPred) {
      f.lastPred = f.engine.predict();
    }
    f.lastError = null;
  } catch (e) { f.lastError = e.message; }
}

let gamePollTimer = null;
function scheduleGamePolling() {
  if (gamePollTimer) clearInterval(gamePollTimer);
  const interval = Math.max(5000, Math.min(120000, Number(settings.pollMs) || POLL_MS));
  gamePollTimer = setInterval(() => Promise.all(games.map(pollGame)), interval);
  return interval;
}
scheduleGamePolling();
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
function hashFeatures(hashStr) {
  const chars = String(hashStr || '').toLowerCase().split('').map(ch => parseInt(ch, 16));
  const values = [];
  for (let segment = 0; segment < 8; segment++) {
    const start = Math.floor(segment * chars.length / 8);
    const end = Math.floor((segment + 1) * chars.length / 8);
    const part = chars.slice(start, end);
    const mean = part.length ? part.reduce((a, b) => a + b, 0) / part.length / 15 : 0.5;
    const high = part.length ? part.filter(x => x >= 8).length / part.length : 0.5;
    values.push(mean, high);
  }
  const entropyCounts = new Array(16).fill(0);
  chars.forEach(x => entropyCounts[x]++);
  const entropy = -entropyCounts.reduce((sum, count) => {
    if (!count) return sum;
    const p = count / chars.length;
    return sum + p * Math.log2(p);
  }, 0) / 4;
  const oddRate = chars.filter(x => x % 2).length / Math.max(1, chars.length);
  const diffs = chars.slice(1).map((x, i) => x - chars[i]);
  const meanDiff = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length / 15 : 0;
  const meanAbsDiff = diffs.length ? diffs.reduce((a, b) => a + Math.abs(b), 0) / diffs.length / 15 : 0;
  const repeatedAdjacent = diffs.length ? diffs.filter(x => x === 0).length / diffs.length : 0;
  const risingRate = diffs.length ? diffs.filter(x => x > 0).length / diffs.length : 0.5;
  const byteValues = [];
  for (let i = 0; i + 1 < chars.length; i += 2) byteValues.push(chars[i] * 16 + chars[i + 1]);
  const byteMean = byteValues.length ? byteValues.reduce((a, b) => a + b, 0) / byteValues.length / 255 : 0.5;
  const byteVariance = byteValues.length ? byteValues.reduce((a, b) => a + (b / 255 - byteMean) ** 2, 0) / byteValues.length : 0;
  const adjacentParityChanges = chars.length > 1 ? chars.slice(1).filter((x, i) => (x % 2) !== (chars[i] % 2)).length / (chars.length - 1) : 0.5;
  values.push(oddRate, chars[0] / 15, chars[chars.length - 1] / 15, entropy,
    meanDiff, meanAbsDiff, repeatedAdjacent, risingRate, byteMean, byteVariance, adjacentParityChanges);
  return values;
}

function fitHashLogistic(type, samples) {
  const expectedLength = type === 'MD5' ? 32 : 64;
  const byDigest = new Map();
  for (const row of Array.isArray(samples) ? samples : []) {
    const hash = String(row && row.hash || '').toLowerCase();
    if (!row || row.type !== type || row.conflicted || hash.length !== expectedLength || !/^[a-f0-9]+$/i.test(hash) || !['T', 'X'].includes(row.actual)) continue;
    const old = byDigest.get(hash);
    if (!old) byDigest.set(hash, { ...row, hash });
    else if (old.actual !== row.actual) old.conflicted = true;
  }
  const rows = [...byDigest.values()].filter(row => !row.conflicted).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  const tCount = rows.filter(x => x.actual === 'T').length;
  const xCount = rows.length - tCount;
  if (rows.length < 240 || tCount < 70 || xCount < 70) return null;
  const holdoutSize = Math.max(60, Math.floor(rows.length * 0.25));
  const trainRows = rows.slice(0, rows.length - holdoutSize);
  const testRows = rows.slice(rows.length - holdoutSize);
  const fit = data => {
    const xs = data.map(r => hashFeatures(r.hash));
    const dims = xs[0].length;
    const means = Array.from({ length: dims }, (_, j) => xs.reduce((a, x) => a + x[j], 0) / xs.length);
    const scales = Array.from({ length: dims }, (_, j) => {
      const v = xs.reduce((a, x) => a + (x[j] - means[j]) ** 2, 0) / xs.length;
      return Math.sqrt(v) || 1;
    });
    const z = xs.map(x => x.map((v, j) => (v - means[j]) / scales[j]));
    let w = new Array(dims).fill(0), bias = 0;
    const lr = 0.12, l2 = 0.025;
    for (let epoch = 0; epoch < 260; epoch++) {
      const gw = new Array(dims).fill(0); let gb = 0;
      for (let i = 0; i < z.length; i++) {
        const y = data[i].actual === 'T' ? 1 : 0;
        const score = bias + z[i].reduce((a, v, j) => a + v * w[j], 0);
        const p = 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, score))));
        const error = p - y;
        gb += error;
        for (let j = 0; j < dims; j++) gw[j] += error * z[i][j];
      }
      bias -= lr * gb / z.length;
      for (let j = 0; j < dims; j++) w[j] -= lr * (gw[j] / z.length + l2 * w[j]);
    }
    return { means, scales, w, bias };
  };
  const validationModel = fit(trainRows);
  const predictP = (model, hash) => {
    const x = hashFeatures(hash).map((v, j) => (v - model.means[j]) / model.scales[j]);
    const score = model.bias + x.reduce((a, v, j) => a + v * model.w[j], 0);
    return 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, score))));
  };
  let tCorrect = 0, tTotal = 0, xCorrect = 0, xTotal = 0, brier = 0;
  for (const row of testRows) {
    const expected = row.actual === 'T' ? 1 : 0;
    const probability = predictP(validationModel, row.hash);
    const predicted = probability >= 0.5 ? 1 : 0;
    brier += (probability - expected) ** 2;
    if (expected) { tTotal++; if (predicted) tCorrect++; }
    else { xTotal++; if (!predicted) xCorrect++; }
  }
  const balancedAccuracy = 100 * (((tTotal ? tCorrect / tTotal : 0) + (xTotal ? xCorrect / xTotal : 0)) / 2);
  const validationBrier = brier / Math.max(1, testRows.length);
  const baselineAccuracy = 100 * Math.max(tTotal, xTotal) / Math.max(1, testRows.length);
  // Require chronological holdout performance beyond the majority baseline and a better-than-neutral Brier score.
  if (balancedAccuracy < Math.max(55, baselineAccuracy + 2.5) || validationBrier >= 0.245) {
    return { ready: false, samples: rows.length, validationAccuracy: balancedAccuracy, validationBrier, baselineAccuracy, holdoutSamples: testRows.length };
  }
  const model = fit(rows);
  return { ready: true, samples: rows.length, validationAccuracy: balancedAccuracy, validationBrier, baselineAccuracy, holdoutSamples: testRows.length, model, predictP };
}

function predictHash(hashStr) {
  const type = String(hashStr).length === 32 ? 'MD5' : 'SHA256';
  let cached = hashModelCache[type];
  if (!cached || cached.revision !== hashTrainingRevision) {
    cached = { revision: hashTrainingRevision, result: fitHashLogistic(type, hashFeedbacks) };
    hashModelCache[type] = cached;
  }
  const trained = cached.result;
  if (trained && trained.ready) {
    const p = trained.predictP(trained.model, hashStr);
    const side = p >= 0.5 ? 'T' : 'X';
    const conf = Math.max(50, Math.min(62, Math.round(Math.max(p, 1 - p) * 100)));
    return {
      side, conf,
      reason: `Mô hình đã qua kiểm định ngoài mẫu ${trained.holdoutSamples} dòng; balanced accuracy ${trained.validationAccuracy.toFixed(1)}%, Brier ${trained.validationBrier.toFixed(3)}. Chỉ là tín hiệu tham khảo, không bảo đảm kết quả.`,
      model: 'learned', samples: trained.samples, validationAccuracy: trained.validationAccuracy, validationBrier: trained.validationBrier
    };
  }
  // Cryptographic digests are designed to look random. Without a known game seed/mapping,
  // do not invent a confident prediction: display a neutral exploratory signal only.
  const bytes = Buffer.from(hashStr, 'hex');
  const parity = bytes.reduce((sum, value, index) => sum + (index % 2 ? -1 : 1) * (value / 255), 0);
  return {
    side: parity >= 0 ? 'T' : 'X', conf: 50,
    reason: 'Chưa có đủ dữ liệu đã xác nhận để mô hình vượt kiểm định ngoài mẫu. Hash mã hóa không tự tiết lộ Tài/Xỉu nếu chưa biết cơ chế tạo kết quả; hiện chỉ hiển thị tín hiệu trung tính.',
    model: 'neutral', samples: 0,
    validationAccuracy: trained ? trained.validationAccuracy : null
  };
}

/* ═══════════════ GAME MENU + AUTO UPDATES ═══════════════ */
async function showBrandMenu(chatId) {
  const seen = new Map();
  for (const g of games.filter(x => x.enabled !== false)) {
    if (!seen.has(g.brand)) seen.set(g.brand, { label: g.brandLabel || g.brand.toUpperCase(), count: 0 });
    seen.get(g.brand).count++;
  }
  if (!seen.size) return send(chatId, '⚠️ Hiện chưa có game nào được bật.', kb([[btn('🏠 MENU', 'menu', 'primary')]]));
  const brandButtons = [...seen.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label)).map(([brand, item]) => btn(`🎮 ${item.label} · ${item.count} loại`, 'predbrand:' + brand, 'primary'));
  const rows = [];
  for (let i = 0; i < brandButtons.length; i += 2) rows.push(brandButtons.slice(i, i + 2));
  rows.push([btn('🏠 MENU CHÍNH', 'menu', 'danger')]);
  return send(chatId, `🎮 <b>CHỌN NHÀ GAME</b>\n\nChọn thương hiệu để xem các bàn Tài Xỉu, MD5 hoặc Sicbo đang bật:`, kb(rows));
}

async function showTables(chatId, brand, uid) {
  const list = games.filter(g => g.brand === brand && g.enabled !== false);
  if (!list.length) return send(chatId, '⚠️ Nhà game này hiện chưa có bàn hoạt động.', kb([[btn('◀️ DANH SÁCH GAME', 'pred:brands', 'primary')]]));
  const label = list[0].brandLabel || String(brand).toUpperCase();
  const tableButtons = list.map(g => btn(`📊 ${g.variant}`, 'pred:' + g.id, 'primary'));
  const rows = [];
  for (let i = 0; i < tableButtons.length; i += 2) rows.push(tableButtons.slice(i, i + 2));
  rows.push([btn('◀️ NHÀ GAME', 'pred:brands', 'danger'), btn('🏠 MENU', 'menu', 'primary')]);
  return send(chatId, `🎮 <b>${esc(label)}</b>

Chọn loại bàn muốn phân tích:`, kb(rows));
}

function stopAuto(uid) {
  const key = String(uid);
  const task = autoWatch[key];
  if (task && task.timer) clearInterval(task.timer);
  delete autoWatch[key];
}

async function pushPredCard(chatId, gameId, uid, force = false, replaceMessageId = null) {
  const g = games.find(x => x.id === gameId && x.enabled !== false);
  const feed = FEEDS[gameId];
  if (!g || !feed) return send(chatId, '⚠️ Không tìm thấy bàn game hoặc bàn đang tắt.', kb([[btn('◀️ DANH SÁCH GAME', 'pred:brands', 'primary')]]));
  if (!feed.lastPred) await pollGame(g);
  const p = feed.lastPred || feed.engine.predict();
  const side = p.side === 'T' ? 'TÀI' : 'XỈU';
  const icon = p.side === 'T' ? '🔴' : '🔵';
  const nextSession = feed.lastLive ? String(Number(feed.lastLive.session) + 1) : 'đang chờ';
  const previous = getPreviousRoundSummary(feed.lastLive);
  const isSicbo = String(gameId).startsWith('sicbo_');
  const sums = isSicbo && p.dicePrediction && Array.isArray(p.dicePrediction.topSums)
    ? [...new Set(p.dicePrediction.topSums.map(Number).filter(n => Number.isInteger(n) && n >= 3 && n <= 18))].slice(0, 3)
    : [];
  const dicePredictionLine = isSicbo
    ? `\n🎲 <b>BA TỔNG DỄ XUẤT HIỆN:</b> <b>${sums.length ? sums.join(' • ') : 'Đang tính toán'}</b>`
    : '';
  const text = `╭━━━━━━━━━━━━━━━━━━╮
   🎯 <b>${esc(g.brandLabel)} • ${esc(g.variant)}</b>
╰━━━━━━━━━━━━━━━━━━╯

📍 <b>PHIÊN TRƯỚC:</b> <code>${esc(previous.session)}</code>
🏁 <b>KẾT QUẢ:</b> <b>${esc(previous.result)}</b>
🎲 <b>XÚC XẮC:</b> ${esc(previous.dice)}

🔮 <b>PHIÊN TIẾP THEO:</b> <code>${esc(nextSession)}</code>
🎯 <b>DỰ ĐOÁN:</b> ${icon} <b>${side}</b>${dicePredictionLine}`;
  const markup = kb([
    [btn('📜 LỊCH SỬ ĐÚNG/SAI', 'predhist:' + gameId, 'success')],
    [btn('⏹ DỪNG CẬP NHẬT', 'pred:stop:' + gameId, 'danger'), btn('◀️ CHỌN BÀN', 'predbrand:' + g.brand, 'primary')],
    [btn('🏠 MENU CHÍNH', 'menu', 'primary')]
  ]);
  if (replaceMessageId) {
    const edited = await editText(chatId, replaceMessageId, text, { reply_markup: markup });
    if (edited && edited.ok) return { result: { message_id: replaceMessageId }, edited: true };
    // If Telegram no longer allows editing (e.g. message expired/deleted), send replacement then remove old card.
    const sent = await send(chatId, text, { reply_markup: markup });
    if (sent && sent.ok && sent.result && sent.result.message_id) await delMsg(chatId, replaceMessageId);
    return sent;
  }
  return send(chatId, text, { reply_markup: markup });
}

function startAuto(uid, chatId, gameId) {
  stopAuto(uid);
  const key = String(uid), state = { chatId, gameId, lastSession: FEEDS[gameId] && FEEDS[gameId].lastSession, timer: null, busy: false };
  state.timer = setInterval(async () => {
    if (state.busy) return;
    state.busy = true;
    try {
      const g = games.find(x => x.id === gameId && x.enabled !== false);
      const f = FEEDS[gameId];
      if (!g || !f) { stopAuto(key); return; }
      await pollGame(g);
      if (f.lastSession && f.lastSession !== state.lastSession) {
        state.lastSession = f.lastSession;
        const updatedCard = await pushPredCard(chatId, gameId, key, true, state.messageId);
        if (updatedCard && updatedCard.result && updatedCard.result.message_id) state.messageId = updatedCard.result.message_id;
      }
    } catch (e) { console.error('[AUTO PREDICTION]', e.message); }
    finally { state.busy = false; }
  }, Math.max(15000, POLL_MS * 3));
  state.timer.unref?.();
  autoWatch[key] = state;
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
  lines.push(`📜 <b>LỊCH SỬ ĐÃ DỰ ĐOÁN • ${esc(g.brandLabel)}</b>`);
  lines.push(`━━━━━━━━━━━━━━━`);
  lines.push(`⏰ ${nowVN()}`);
  lines.push(`📈 Độ chuẩn: <b>${eng.accuracy()}%</b> (${eng.correct}/${eng.total})`);
  lines.push(`━━━━━━━━━━━━━━━`);

  for (const log of logs) {
    const sess = String(log.session || 'Chưa có').slice(-6);
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

async function showForceJoin(chatId, missing) {
  const rows = [];
  (missing || settings.groups || []).forEach((g, i) => {
    if (g.link) rows.push([btnUrl(`📢 GROUP ${i + 1}: ${g.title || 'Tham gia'}`, g.link, 'primary')]);
  });
  rows.push([btn('✅ KIỂM TRA THAM GIA', 'join:check', 'success')]);
  return send(chatId, '🔔 <b>THAM GIA CỘNG ĐỒNG</b>\n\nVui lòng tham gia các nhóm/kênh bên dưới, sau đó chọn <b>KIỂM TRA THAM GIA</b> để tiếp tục.', kb(rows));
}

async function showUserMenu(chatId, from) {
  const uid = uidOf(from);
  ensureUser(uid, from);
  const join = await checkUserInGroups(uid);
  if (!join.ok) return showForceJoin(chatId, join.missing);

  const v = vipText(uid);
  const uname = from.username ? '@' + from.username : 'Chưa đặt username';
  const display = esc(displayName(from));
  const botTitle = esc(settings.botTitle || 'TOOL TX BY FEE');
  const welcomeText = esc(settings.welcomeText || 'Chọn chức năng bạn cần');
  const accessLine = isAdmin(uid) ? '👑 <b>ADMIN VĨNH VIỄN</b>' : (v.active ? '🟢 <b>ĐANG HOẠT ĐỘNG</b>' : '🔒 <b>CHƯA KÍCH HOẠT KEY</b>');
  const text =
`╭━━━━━━━━━━━━━━━━━━━━╮
       🔥 <b>${botTitle}</b>
╰━━━━━━━━━━━━━━━━━━━━╯

👤 <b>TÀI KHOẢN CỦA BẠN</b>
├ Tên: <b>${display}</b>
├ ID: <code>${uid}</code>
├ Telegram: ${esc(uname)}
├ Trạng thái: ${accessLine}
└ Thời hạn: <b>${esc(v.expire.replace(/^.*?: /, ''))}</b>

┌── ✨ <b>CÁC CHỨC NĂNG CỦA BOT BY FEE</b>
├ 🎮 Nhận định TX • MD5 • Sicbo
├ 🧩 Phân tích mã Hash
├ 📊 Lịch sử phiên và đối chiếu
└ 📦 Tải tệp từ Kho File

👇 <b>${welcomeText}</b>`;

  const rows = [
    [btn('🎮 CHỌN GAME', 'pred:brands', 'primary')],
    [btn('🧩 TOOL MD5/SHA256', 'hash:start', 'success'), btn('📦 KHO FILE', 'store:open', 'primary')],
    [btn('💳 THUÊ TOOL', 'rent:menu', 'primary'), btn('🔑 NHẬP KEY', 'key:input', 'success')],
    [btn('🎫 NHẬP CODE', 'code:input', 'success'), btn('💬 TRỢ GIÚP', 'support:go', 'primary')],
    [btn('⭐ FEEDBACK', 'fb:start', 'success')]
  ];
  return send(chatId, text, kb(rows));
}

async function showFileStore(chatId) {
  const file = storeFiles[String(storeProduct.activeFileId || '')];
  if (!storeFileExists(file)) {
    return send(chatId, '📦 <b>KHO FILE</b>\n\nHiện chưa có tệp để bán. Vui lòng quay lại sau nhé! 💙', kb([
      [btn('◀️ MENU CHÍNH', 'menu', 'primary')]
    ]));
  }
  const sizeMb = (Number(file.size || 0) / (1024 * 1024)).toFixed(2);
  return send(chatId, `📦 <b>KHO FILE</b>\n\n🧾 <b>${esc(STORE_PRODUCT_NAME)}</b>\n💰 Giá: <b>${fmt(STORE_PRICE)}đ</b>\n📁 ${esc(file.originalName || 'Tài liệu số')} • ${sizeMb} MB\n\n🏦 Thanh toán bằng QR TPBank.\n📩 Khi giao dịch khớp, bot tự gửi tệp vào chat này.`, kb([
    [btn('💳 MUA NGAY • ' + fmt(STORE_PRICE) + 'đ', 'store:confirm', 'success')],
    [btn('◀️ MENU CHÍNH', 'menu', 'primary')]
  ]));
}

async function createFileOrder(chatId, uid) {
  const file = storeFiles[String(storeProduct.activeFileId || '')];
  if (!storeFileExists(file)) {
    return send(chatId, '⚠️ Kho hiện chưa có tệp để giao. Vui lòng quay lại sau hoặc liên hệ bộ phận hỗ trợ.', kb([[btn('◀️ QUAY LẠI', 'store:open', 'primary')]]));
  }
  // One active order per user avoids duplicate orders from repeated taps.
  const existing = Object.values(orders).find(o => o && o.type === 'file' && o.uid === String(uid) && ['pending', 'checking', 'timeout'].includes(o.status) && (!o.expire || Date.now() <= o.expire));
  if (existing) {
    return send(chatId, `🧾 <b>ĐƠN ĐANG CHỜ THANH TOÁN</b>\nMã đơn: <code>${existing.id}</code> • <b>${fmt(existing.amount)}đ</b>\nMã CK: <code>${esc(existing.addInfo)}</code>\nVui lòng dùng QR của đơn hiện tại hoặc huỷ đơn trước khi tạo đơn mới.`, kb([
      [btn('✅ ĐÃ THANH TOÁN', 'store:done:' + existing.id, 'success')],
      [btn('🏠 MENU', 'menu', 'primary')]
    ]));
  }
  const orderId = 'F' + Date.now().toString(36).toUpperCase() + String(uid).slice(-4);
  const addInfo = createPaymentMemo('file', uid, ensureUser(uid).username);
  const qr = vietqrUrl(STORE_PRICE, addInfo);
  orders[orderId] = {
    id: orderId, type: 'file', product: STORE_PRODUCT_NAME, uid: String(uid),
    fileId: String(file.id), amount: STORE_PRICE, addInfo,
    status: 'pending', created: Date.now(), expire: Date.now() + 45 * 60 * 1000
  };
  saveOrders();
  const caption = `🏦 <b>TPBANK • THANH TOÁN</b>\n📦 ${esc(STORE_PRODUCT_NAME)} • <b>${fmt(STORE_PRICE)}đ</b>\n💳 <code>${BANK.account}</code> • ${esc(BANK.name)}\n📝 Mã CK: <code>${esc(addInfo)}</code>\n🧾 Đơn: <code>${orderId}</code>\n\n📲 Quét QR, chuyển đúng số tiền và mã CK. Sau đó chọn <b>ĐÃ THANH TOÁN</b>. Bot tự đối soát.`
  const replyMarkup = { inline_keyboard: [
    [{ text: '✅ ĐÃ THANH TOÁN', callback_data: 'store:done:' + orderId }],
    [{ text: '🗑 HUỶ ĐƠN', callback_data: 'store:cancel:' + orderId }],
    [{ text: '◀️ QUAY LẠI', callback_data: 'store:open' }]
  ] };
  try {
    const image = await downloadImage(qr);
    const sent = await tgMultipart('sendPhoto', {
      chat_id: chatId, caption, parse_mode: 'HTML', reply_markup: replyMarkup
    }, { buffer: image.buffer, contentType: image.contentType, filename: 'vietqr-' + orderId + '.png' });
    if (sent && sent.ok) return sent;
    throw new Error((sent && sent.description) || 'Telegram không nhận ảnh QR');
  } catch (err) {
    console.error('[STORE QR]', err.message);
    return send(chatId, `⚠️ <b>QR TẠM THỜI KHÔNG TẢI ĐƯỢC</b>\n📦 ${esc(STORE_PRODUCT_NAME)} • <b>${fmt(STORE_PRICE)}đ</b>\n🏦 TPBank: <code>${BANK.account}</code> • ${esc(BANK.name)}\n📝 Mã CK: <code>${esc(addInfo)}</code>\n🧾 Đơn: <code>${orderId}</code>\n<a href="${esc(qr)}">📲 Mở QR thanh toán</a>\nSau khi chuyển khoản, chọn <b>ĐÃ THANH TOÁN</b>.`, { reply_markup: replyMarkup, disable_web_page_preview: false });
  }
}

async function notifyAdminsAboutFileOrder(order, reason) {
  const text = `🔔 <b>ĐƠN KHO FILE CẦN ADMIN KIỂM TRA</b>\n━━━━━━━━━━━━━━━━━━\n🧾 Đơn: <code>${esc(order.id)}</code>\n👤 User: <code>${esc(order.uid)}</code>\n📦 Sản phẩm: <b>${esc(order.product || STORE_PRODUCT_NAME)}</b>\n💰 Số tiền: <b>${fmt(order.amount)}đ</b>\n📝 Nội dung CK: <code>${esc(order.addInfo)}</code>\n⚠️ ${esc(reason)}\n\nHãy kiểm tra tài khoản ngân hàng trước khi duyệt.`;
  const markup = kb([
    [btn('✅ XÁC NHẬN + GỬI FILE', 'store:approve:' + order.id, 'success')],
    [btn('❌ TỪ CHỐI ĐƠN', 'store:reject:' + order.id, 'danger')]
  ]);
  for (const adminId of ADMIN_IDS) await send(adminId, text, markup);
}

async function markFileOrderDone(chatId, uid, orderId) {
  const order = orders[orderId];
  if (!order || order.type !== 'file' || order.uid !== String(uid)) return send(chatId, '❌ Đơn hàng không hợp lệ.');
  if (order.status === 'paid') return send(chatId, '🎉 Giao dịch đã khớp! File đã được gửi vào Telegram của bạn.');
  if (order.status === 'delivering') return send(chatId, '📤 <b>BOT ĐANG GỬI FILE CHO BẠN</b>\nVui lòng chờ tin nhắn tài liệu nhé!');
  if (order.status === 'checking') return send(chatId, '⏳ <b>ĐƠN ĐANG ĐƯỢC ĐỐI SOÁT</b>\n\nBot đang chờ thông báo TPBank. Nếu chưa đọc được giao dịch, admin đã nhận yêu cầu kiểm tra thủ công. Bạn không cần bấm lại nhé! 💙');
  if (order.status !== 'pending' || (order.expire && Date.now() > order.expire)) return send(chatId, '⌛ Đơn đã hết hạn hoặc đã huỷ. Hãy tạo đơn mới tại KHO FILE.');
  order.status = 'checking';
  order.checkAt = Date.now();
  saveOrders();
  await send(chatId, `🤖 <b>ĐÃ GỬI YÊU CẦU ĐỐI SOÁT</b>\n\n🧾 Đơn: <code>${orderId}</code>\n💰 Số tiền: <b>${fmt(order.amount)}đ</b>\n📝 Nội dung: <code>${esc(order.addInfo)}</code>\n\n🏦 Bot đang kiểm tra thông báo TPBank. Nếu giao dịch khớp, file sẽ tự động được gửi. Nếu chưa có thông báo phù hợp, admin sẽ kiểm tra và duyệt thủ công.`, kb([[btn('📦 KHO FILE', 'store:open', 'primary'), btn('🏠 MENU', 'menu', 'success')]]));
  await notifyAdminsAboutFileOrder(order, 'Người mua đã bấm DONE nhưng bot chưa ghi nhận giao dịch tương ứng tại thời điểm kiểm tra.');
  return true;
}

async function approveFileOrder(orderId, adminId, authorizedAuto = false) {
  if (!authorizedAuto && !isAdmin(adminId)) return { ok: false, message: 'Không có quyền admin.' };
  const order = orders[orderId];
  if (!order || order.type !== 'file') return { ok: false, message: 'Không tìm thấy đơn kho file.' };
  if (order.status === 'paid') return { ok: true, already: true, message: 'Đơn đã được gửi file trước đó.' };
  if (!['pending', 'checking', 'processing'].includes(order.status)) return { ok: false, message: 'Đơn không ở trạng thái chờ xử lý.' };
  const file = storeFiles[String(order.fileId || '')];
  if (!storeFileExists(file)) return { ok: false, message: 'Không tìm thấy tệp sản phẩm. Admin hãy tải file mới bằng lệnh /setfile.' };
  order.status = 'delivering';
  order.approvedBy = String(adminId);
  order.approvedAt = Date.now();
  saveOrders();
  const caption = `🎉 <b>THANH TOÁN ĐÃ ĐƯỢC XÁC NHẬN</b>\n━━━━━━━━━━━━━━━━━━\n📦 ${esc(order.product || STORE_PRODUCT_NAME)}\n🧾 Đơn: <code>${esc(orderId)}</code>\n✅ Giao dịch đã đối soát thành công.\n💙 Cảm ơn bạn đã ủng hộ!`;
  let sent;
  if (file.telegramFileId) {
    sent = await tg('sendDocument', { chat_id: order.uid, document: file.telegramFileId, caption, parse_mode: 'HTML' });
  } else {
    const filePath = path.join(STORE_UPLOADS, file.storedName);
    if (!fs.existsSync(filePath)) {
      order.status = 'checking'; saveOrders();
      return { ok: false, message: 'Không tìm thấy dữ liệu file trên máy chủ.' };
    }
    const size = fs.statSync(filePath).size;
    if (size > 49 * 1024 * 1024) {
      order.status = 'checking'; saveOrders();
      return { ok: false, message: 'File vượt giới hạn gửi Telegram (49 MB).' };
    }
    const buffer = fs.readFileSync(filePath);
    sent = await tgMultipart('sendDocument', {
      chat_id: order.uid, caption, parse_mode: 'HTML'
    }, { buffer, filename: file.originalName || 'file', contentType: file.mimeType || 'application/octet-stream', fieldName: 'document' });
  }
  if (!sent || !sent.ok) {
    order.status = 'checking';
    order.deliveryError = (sent && sent.description) || 'Không gửi được file qua Telegram';
    saveOrders();
    return { ok: false, message: order.deliveryError };
  }
  order.status = 'paid';
  order.paidAt = Date.now();
  order.deliveredAt = Date.now();
  order.deliveredMessageId = sent.result && sent.result.message_id;
  order.autoPaid = String(adminId) === 'bank-auto';
  delete order.deliveryError;
  saveOrders();
  return { ok: true, message: `Đã xác nhận và gửi file đến user ${order.uid}.` };
}

async function rejectFileOrder(orderId, adminId, reason = 'Giao dịch chưa được xác nhận') {
  if (!isAdmin(adminId)) return { ok: false, message: 'Không có quyền admin.' };
  const order = orders[orderId];
  if (!order || order.type !== 'file') return { ok: false, message: 'Không tìm thấy đơn kho file.' };
  if (order.status === 'paid' || order.status === 'delivering') return { ok: false, message: 'Đơn đã được gửi hoặc đang gửi file, không thể từ chối.' };
  order.status = 'rejected';
  order.rejectedAt = Date.now();
  order.rejectedBy = String(adminId);
  saveOrders();
  await send(order.uid, `❌ <b>ĐƠN KHO FILE CHƯA ĐƯỢC DUYỆT</b>\n🧾 Đơn: <code>${esc(orderId)}</code>\nLý do: ${esc(reason)}\nNếu bạn đã chuyển tiền, vui lòng liên hệ admin để đối chiếu.`);
  return { ok: true, message: 'Đã từ chối đơn và thông báo người mua.' };
}

async function showRentMenu(chatId) {
  const pkgs = settings.packages || [];
  const rows = pkgs.map(pk => [btn('💰 ' + pk.label, 'rent:pkg:' + pk.id, 'primary')]);
  rows.push([btn('◀️ QUAY LẠI', 'menu', 'primary')]);
  return send(chatId, '💳 <b>THUÊ TOOL • BẢNG GIÁ</b>\n\nChọn gói phù hợp:', kb(rows));
}

async function showRentConfirm(chatId, pkgId) {
  const pkg = (settings.packages || []).find(p => p.id === pkgId);
  if (!pkg) return send(chatId, '❌ Gói không tồn tại.', kb([[btn('◀️ QUAY LẠI', 'rent:menu', 'primary')]]));
  const text = `🛒 <b>XÁC NHẬN MUA</b>\n\nGói: <b>${esc(pkg.label)}</b>\nSố tiền: <b>${Number(pkg.amount).toLocaleString('vi-VN')}đ</b>\nThời hạn: <b>${pkg.hours}h</b>\n\n<b>Bạn xác nhận chọn gói này chứ?</b>`;
  return send(chatId, text, kb([
    [btn('✅ XÁC NHẬN', 'rent:yes:' + pkgId, 'success'), btn('↩️ CHỌN LẠI', 'rent:menu', 'danger')]
  ]));
}

async function createRentOrder(chatId, uid, pkgId) {
  const pkg = (settings.packages || []).find(p => p.id === pkgId);
  if (!pkg) return send(chatId, '❌ Gói không tồn tại.');
  const activeOrder = Object.values(orders).find(o => o && o.type !== 'file' && o.uid === String(uid) && ['pending', 'checking', 'timeout'].includes(o.status) && (!o.expire || Date.now() <= Number(o.expire)));
  if (activeOrder) {
    return send(chatId, `🧾 <b>ĐƠN KEY ĐANG CHỜ THANH TOÁN</b>\n📦 Gói: <b>${esc(activeOrder.pkgId || 'Gói đã chọn')}</b> • ${fmt(activeOrder.amount)}đ\nMã CK: <code>${esc(activeOrder.addInfo)}</code>\nDùng QR cũ hoặc huỷ đơn này trước khi tạo đơn mới.`, kb([
      [btn('✅ ĐÃ THANH TOÁN', 'rent:done:' + activeOrder.id, 'success')],
      [btn('🗑 HUỶ ĐƠN CŨ', 'rent:cancel:' + activeOrder.id, 'danger')],
      [btn('◀️ QUAY LẠI', 'rent:menu', 'primary')]
    ]));
  }
  const orderId = 'O' + Date.now().toString(36).toUpperCase() + String(uid).slice(-4);
  const user = ensureUser(uid);
  const addInfo = createPaymentMemo('key', uid, user.username);
  const qr = vietqrUrl(pkg.amount, addInfo);
  orders[orderId] = {
    id: orderId, type: 'key', uid: String(uid), username: user.username || '', pkgId,
    amount: pkg.amount, hours: pkg.hours, addInfo,
    status: 'pending', created: Date.now(), expire: Date.now() + 30 * 60 * 1000
  };
  saveOrders();
  const caption = `🏦 <b>TPBANK • MUA GÓI KEY</b>\n💰 <b>${fmt(pkg.amount)}đ</b> • ${Number(pkg.hours) || 24} giờ\n💳 <code>${BANK.account}</code> • ${esc(BANK.name)}\n📝 Mã CK: <code>${esc(addInfo)}</code>\n🧾 Đơn: <code>${orderId}</code>\n\n📲 Quét QR, chuyển đúng số tiền và mã CK. Sau đó chọn <b>ĐÃ THANH TOÁN</b>.`
  const replyMarkup = {
    inline_keyboard: [
      [{ text: '✅ ĐÃ THANH TOÁN', callback_data: 'rent:done:' + orderId },
       { text: '🗑 HUỶ ĐƠN', callback_data: 'rent:cancel:' + orderId }],
      [{ text: '◀️ QUAY LẠI', callback_data: 'rent:menu' }]
    ]
  };

  try {
    const image = await downloadImage(qr);
    const sent = await tgMultipart('sendPhoto', {
      chat_id: chatId,
      caption,
      parse_mode: 'HTML',
      reply_markup: replyMarkup
    }, { buffer: image.buffer, contentType: image.contentType, filename: 'vietqr-' + orderId + '.png' });
    if (sent && sent.ok) return sent;
    throw new Error((sent && sent.description) || 'Telegram không nhận ảnh QR');
  } catch (err) {
    console.error('[QR] Không gửi được mã QR:', err.message);
    // Keep the order usable and expose a clear fallback rather than silently failing.
    return send(chatId, `⚠️ <b>QR TẠM THỜI KHÔNG TẢI ĐƯỢC</b>
🏦 TPBank: <code>${BANK.account}</code> • ${esc(BANK.name)}
💰 <b>${fmt(pkg.amount)}đ</b> • ${Number(pkg.hours) || 24} giờ
📝 Mã CK: <code>${esc(addInfo)}</code>
🧾 Đơn: <code>${orderId}</code>
<a href=\"${esc(qr)}\">📲 Mở QR thanh toán</a>
Sau khi chuyển khoản, chọn <b>ĐÃ THANH TOÁN</b>.`, {
      reply_markup: replyMarkup,
      disable_web_page_preview: false
    });
  }
}

async function deliverKeyOrder(order, source = 'admin') {
  if (!order.key) {
    const created = createKeyForUser(order.uid, Number(order.hours) || 24);
    order.key = created.key;
    order.keyUntil = created.until;
  }
  order.status = 'processing';
  saveOrders();
  const exp = new Date(Number(order.keyUntil || (keysDB[order.key] && keysDB[order.key].until) || Date.now())).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const delivered = await send(order.uid, `🎉 <b>THANH TOÁN THÀNH CÔNG • TPBANK</b>\n━━━━━━━━━━━━━━━━━━\n🔑 KEY CỦA BẠN:\n<code>${esc(order.key)}</code>\n⏳ Hạn sử dụng: <b>${exp}</b>\n✅ Đơn hàng đã được xác nhận.`, kb([
    [btn('🎮 CHỌN GAME', 'pred:brands', 'primary')],
    [btn('🏠 MENU', 'menu', 'success')]
  ]));
  if (!delivered || !delivered.ok) {
    order.status = 'checking';
    order.deliveryError = delivered && delivered.description ? delivered.description : 'Telegram chưa xác nhận gửi KEY';
    saveOrders();
    return { ok: false, message: 'KEY đã tạo nhưng gửi Telegram thất bại; admin có thể duyệt lại để gửi lại KEY cũ, không tạo KEY mới.' };
  }
  order.status = 'paid'; order.paidAt = order.paidAt || Date.now(); order.deliveredAt = Date.now(); order.deliverySource = source;
  delete order.deliveryError;
  saveOrders();
  return { ok: true, message: 'Đã gửi KEY đến user ' + order.uid + '.' };
}

async function approveKeyOrder(orderId, adminId) {
  if (!isAdmin(adminId)) return { ok: false, message: 'Không có quyền admin.' };
  const order = orders[orderId];
  if (!order || order.type === 'file') return { ok: false, message: 'Không tìm thấy đơn mua KEY.' };
  if (order.status === 'paid') return { ok: true, message: 'Đơn đã được cấp KEY trước đó.' };
  if (!['pending', 'checking', 'timeout', 'processing'].includes(order.status)) return { ok: false, message: 'Đơn không ở trạng thái chờ xử lý.' };
  order.approvedBy = String(adminId);
  return deliverKeyOrder(order, 'admin');
}

async function rejectKeyOrder(orderId, adminId) {
  if (!isAdmin(adminId)) return { ok: false, message: 'Không có quyền admin.' };
  const order = orders[orderId];
  if (!order || order.type === 'file') return { ok: false, message: 'Không tìm thấy đơn mua KEY.' };
  if (order.status === 'paid' || order.key) return { ok: false, message: 'Đơn đã tạo KEY hoặc đã giao KEY; hãy dùng nút duyệt lại để gửi KEY cũ, không từ chối.' };
  order.status = 'rejected'; order.rejectedAt = Date.now(); order.rejectedBy = String(adminId); saveOrders();
  await send(order.uid, `❌ Đơn mua KEY <code>${esc(orderId)}</code> chưa được duyệt. Vui lòng liên hệ admin nếu bạn đã chuyển khoản.`);
  return { ok: true, message: 'Đã từ chối đơn mua KEY.' };
}

async function markOrderDone(chatId, uid, orderId) {
  const o = orders[orderId];
  if (!o || o.uid !== String(uid) || o.type === 'file') return send(chatId, '❌ Đơn không hợp lệ.');
  if (o.status === 'paid') return send(chatId, '✅ Đơn đã được xử lý trước đó.');
  if (o.status === 'processing') return send(chatId, '📤 Bot đang giao KEY cho bạn. Vui lòng đợi tin nhắn KEY.');
  if (['cancelled', 'rejected'].includes(o.status)) return send(chatId, '⚠️ Đơn đã huỷ hoặc bị từ chối. Hãy tạo đơn mới nếu vẫn muốn mua.');
  if (o.status === 'checking') return send(chatId, '⏳ Đơn đã được gửi admin đối soát. Bạn không cần bấm DONE thêm lần nữa.');
  if (!['pending', 'timeout'].includes(o.status)) return send(chatId, '⚠️ Trạng thái đơn không còn hợp lệ. Vui lòng liên hệ admin.');
  if (o.expire && Date.now() > Number(o.expire) + 30 * 60 * 1000) return send(chatId, '⌛ Đơn đã quá hạn đối soát. Vui lòng tạo đơn mới hoặc liên hệ admin nếu bạn đã chuyển khoản.');
  o.status = 'checking';
  o.checkAt = Date.now();
  saveOrders();
  await send(chatId, `⏳ <b>BOT ĐANG ĐỐI SOÁT THANH TOÁN</b>\n\n💰 ${fmt(o.amount)} VND\n📝 Nội dung: <code>${esc(o.addInfo || '')}</code>\n🤖 Mã này gắn riêng với tài khoản của bạn. Nếu bot chưa đọc được giao dịch, admin sẽ nhận yêu cầu duyệt thủ công.`, kb([
    [btn('🏠 VỀ MENU', 'menu', 'primary')]
  ]));
  for (const aid of ADMIN_IDS) {
    const isFile = o.type === 'file';
    await send(aid, `🧾 <b>USER ĐÃ BẤM DONE • CHỜ ĐỐI SOÁT</b>\nLoại: <b>${isFile ? 'KHO FILE' : 'MUA KEY'}</b>\nĐơn: <code>${esc(o.id)}</code>\nUser: <code>${esc(o.uid)}</code>\n💰 ${fmt(o.amount)}đ\n📝 <code>${esc(o.addInfo || '')}</code>\n⚠️ Nếu không có thông báo ngân hàng, kiểm tra tài khoản thật trước khi duyệt.`, kb([
      [btn(isFile ? '✅ DUYỆT + GỬI FILE' : '✅ DUYỆT + CẤP KEY', (isFile ? 'store:approve:' : 'keyorder:approve:') + o.id, 'success')],
      [btn('❌ TỪ CHỐI', (isFile ? 'store:reject:' : 'keyorder:reject:') + o.id, 'danger')]
    ]));
  }
  setTimeout(async () => {
    const ord = orders[orderId];
    if (ord && ord.status === 'checking') {
      ord.status = 'timeout';
      saveOrders();
      try { await send(ord.uid, '⚠️ Đơn <code>' + orderId + '</code> chưa khớp giao dịch sau 10 phút.\nNếu đã chuyển vui lòng liên hệ admin để đối chiếu thủ công.'); } catch (e) {}
    }
  }, 10 * 60 * 1000);
}

function tryMatchPayment(text) {
  const raw = String(text || '').replace(/\u00a0/g, ' ');
  const mAmount = raw.match(/[+]\s*([\d.,]+)\s*VND/i) || raw.match(/[+]\s*([\d.,]+)/i);
  if (!mAmount) return null;
  const amount = Number(String(mAmount[1]).replace(/[.,]/g, ''));
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;

  // Read the full transfer description after ND:, including wrapped/new lines and Napas suffixes.
  const ndLabel = /(?:\bND\b|Nội dung(?: chuyển khoản)?|Noi dung(?: chuyen khoan)?|Description|Transfer content|Add.?info|Memo|Content)\s*[:=\-]\s*/i;
  const ndMatch = ndLabel.exec(raw);
  const nd = ndMatch ? raw.slice(ndMatch.index + ndMatch[0].length).trim() : raw;
  const parts = raw.split('|').map(x => x.trim()).filter(Boolean);
  const dateIndex = parts.findIndex(x => /\d{2}[/-]\d{2}[/-]\d{4}/.test(x));
  let ref = '';
  if (dateIndex >= 0) {
    const afterDate = parts.slice(dateIndex + 1);
    ref = afterDate.find(x => /^[A-Z0-9_-]{7,}$/i.test(x) && !/^(?:ND|NAPAS)/i.test(x)) || '';
  }
  if (!ref) {
    const beforeMemoText = ndMatch ? raw.slice(0, ndMatch.index) : raw;
    const candidates = beforeMemoText.split('|').map(x => x.trim()).filter(x => /^[A-Z0-9_-]{8,}$/i.test(x));
    ref = candidates[candidates.length - 1] || '';
  }
  const uidMatch = String(nd + ' ' + raw).match(/Napas(\d{6,})(?!\d)/i);
  return {
    amount, nd, uid: uidMatch ? uidMatch[1] : null,
    ref: ref || crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24),
    raw
  };
}

function normalizeTransferText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function transferMemoIncluded(messageContent, requiredMemo) {
  const haystack = normalizeTransferText(messageContent);
  const needle = normalizeTransferText(requiredMemo);
  return Boolean(needle) && haystack.includes(needle);
}

async function notifyPaymentReview(parsed, matches, reason) {
  const base = `🏦 <b>THÔNG BÁO TPBANK CẦN ĐỐI SOÁT</b>\n━━━━━━━━━━━━━━━━━━\n💰 Số tiền: <b>${fmt(parsed.amount)} VND</b>\n📝 Nội dung: <code>${esc(parsed.nd || 'Không đọc được')}</code>\n🔖 Mã giao dịch: <code>${esc(parsed.ref)}</code>\n⚠️ ${esc(reason)}`;
  for (const aid of ADMIN_IDS) {
    await send(aid, base);
    for (const order of matches.slice(0, 8)) {
      const isFile = order.type === 'file';
      const approveData = (isFile ? 'store:approve:' : 'keyorder:approve:') + order.id;
      const rejectData = (isFile ? 'store:reject:' : 'keyorder:reject:') + order.id;
      await send(aid, `🧾 <b>ĐƠN CÓ THỂ LIÊN QUAN</b>\nLoại: <b>${isFile ? 'KHO FILE' : 'MUA KEY'}</b>\nĐơn: <code>${esc(order.id)}</code>\nUser: <code>${esc(order.uid)}</code>\nSố tiền: <b>${fmt(order.amount)}đ</b>\nMemo: <code>${esc(order.addInfo)}</code>\nTrạng thái: <b>${esc(order.status)}</b>`, kb([
        [btn(isFile ? '✅ DUYỆT + GỬI FILE' : '✅ DUYỆT + CẤP KEY', approveData, 'success')],
        [btn('❌ TỪ CHỐI', rejectData, 'danger')]
      ]));
    }
  }
}

function isTrustedBankSender(msg) {
  const sourceIds = [msg && msg.from && msg.from.id, msg && msg.sender_chat && msg.sender_chat.id]
    .filter(value => value != null).map(String);
  const allowlist = Array.isArray(settings.bankSenderIds) ? settings.bankSenderIds.map(String) : [];
  if (allowlist.length) return sourceIds.some(id => allowlist.includes(id));
  // Do not trust every bot in the group by default. First inspect /bankstatus,
  // then explicitly whitelist the VietQR sender ID with /setbanksenders.
  return Boolean(msg && msg.from && !msg.from.is_bot && isAdmin(msg.from.id));
}

async function onBankMessage(msg) {
  if (!settings.bankGroupId || String(msg.chat && msg.chat.id) !== String(settings.bankGroupId)) return;
  const text = msg.text || msg.caption || '';
  const parsed = tryMatchPayment(text);
  if (!parsed) return;
  const sender = msg.from || {};
  bankMonitor = {
    receivedAt: Date.now(), lastMessageId: msg.message_id || null, chatId: String(msg.chat.id),
    senderId: String(sender.id != null ? sender.id : (msg.sender_chat && msg.sender_chat.id != null ? msg.sender_chat.id : '')),
    senderName: String([sender.first_name, sender.last_name].filter(Boolean).join(' ') || sender.username || (msg.sender_chat && msg.sender_chat.title) || 'không rõ').slice(0, 100),
    isBot: Boolean(sender.is_bot), amount: parsed.amount, ref: parsed.ref, raw: parsed.raw.slice(0, 1200), trusted: false, matchedOrder: ''
  };
  if (!isTrustedBankSender(msg)) { saveBankMonitor();
    const sourceId = msg.from && msg.from.id != null ? String(msg.from.id) : (msg.sender_chat && msg.sender_chat.id != null ? String(msg.sender_chat.id) : 'không rõ');
    for (const aid of ADMIN_IDS) {
      await send(aid, `🛡️ <b>BẢN TIN GIAO DỊCH CHƯA ĐƯỢC TIN CẬY</b>\nNhóm: <code>${esc(settings.bankGroupId)}</code>\nNgười gửi: <code>${esc(sourceId)}</code>\n💰 Số tiền đọc được: <b>${fmt(parsed.amount)}đ</b>\n📝 Nội dung: <code>${esc(parsed.nd)}</code>\n\nChưa tự động cấp file để tránh giả mạo. Nếu đây là bot ngân hàng hợp lệ, thêm ID người gửi bằng <code>/setbanksenders ${esc(sourceId)}</code>.`);
    }
    return;
  }
  bankMonitor.trusted = true;
  saveBankMonitor();
  const now = Date.now();
  const transactionKey = `${String(msg.chat.id)}:${parsed.ref}`;
  if (bankTransactions[transactionKey]) return; // Telegram may deliver the same bank alert more than once.
  bankTransactions[transactionKey] = { amount: parsed.amount, nd: parsed.nd, seenAt: now, messageId: msg.message_id || null };
  const txEntries = Object.entries(bankTransactions);
  if (txEntries.length > 3000) {
    txEntries.sort((a, b) => Number(a[1].seenAt || 0) - Number(b[1].seenAt || 0));
    for (const [key] of txEntries.slice(0, txEntries.length - 3000)) delete bankTransactions[key];
  }
  saveBankTransactions();

  const matches = Object.values(orders).filter(o =>
    o && ['pending', 'checking', 'timeout'].includes(o.status) &&
    Number(o.amount) === Number(parsed.amount) &&
    transferMemoIncluded(parsed.nd + ' ' + parsed.raw, o.addInfo) &&
    (!o.expire || now <= Number(o.expire) + 30 * 60 * 1000)
  );

  if (matches.length === 1) {
    const order = matches[0];
    order.bankTransactionRef = parsed.ref;
    order.bankMatchedAt = now;
    order.bankMessageId = msg.message_id || null;
    bankMonitor.matchedOrder = order.id; saveBankMonitor();
    order.status = 'processing';
    saveOrders();

    if (order.type === 'file') {
      const result = await approveFileOrder(order.id, 'bank-auto', true);
      if (result.ok) {
        await send(order.uid, `🎉 <b>TPBANK ĐÃ XÁC NHẬN THANH TOÁN!</b>\n\n💰 Số tiền: <b>${fmt(parsed.amount)} VND</b>\n🧾 Mã đơn: <code>${esc(order.id)}</code>\n✅ Nội dung chuyển khoản khớp duy nhất đơn của bạn.\n📦 File đã được gửi vào Telegram.`, kb([[btn('🏠 VỀ MENU', 'menu', 'success')]]));
        for (const aid of ADMIN_IDS) await send(aid, `✅ <b>TỰ ĐỘNG ĐỐI SOÁT KHO FILE</b>\n🧾 Đơn: <code>${esc(order.id)}</code>\n👤 User: <code>${esc(order.uid)}</code>\n💰 ${fmt(parsed.amount)}đ\n🔖 GD: <code>${esc(parsed.ref)}</code>\n📦 Đã gửi file.`);
      } else {
        order.status = 'checking'; saveOrders();
        await notifyAdminsAboutFileOrder(order, 'Đã thấy giao dịch khớp nhưng gửi file thất bại: ' + result.message);
        await send(order.uid, '✅ Bot đã nhận giao dịch. File đang được admin hỗ trợ gửi do Telegram gặp lỗi tạm thời.');
      }
      return;
    }

    // Key/rental order: the memo uniquely identifies the order, so username and Telegram ID
    // are informational only and are not parsed from bank-specific text formats.
    order.paidAt = now;
    const delivery = await deliverKeyOrder(order, 'bank-auto');
    for (const aid of ADMIN_IDS) await send(aid, `✅ <b>ĐƠN MUA KEY TỰ ĐỘNG</b>\n🧾 Đơn: <code>${esc(order.id)}</code>\n👤 User: <code>${esc(order.uid)}</code>\n💰 ${fmt(parsed.amount)}đ\n📝 Memo: <code>${esc(order.addInfo)}</code>\n🔑 KEY: <code>${esc(order.key || 'chưa tạo')}</code>\n📌 ${esc(delivery.message)}`);
    if (!delivery.ok) await notifyPaymentReview(parsed, [order], delivery.message);
    return;
  }

  if (matches.length > 1) {
    await notifyPaymentReview(parsed, matches, 'Nhiều đơn cùng khớp số tiền và nội dung. Bot không tự chọn người nhận để tránh cấp nhầm KEY/file.');
    return;
  }

  const transferText = parsed.nd + ' ' + parsed.raw;
  const sameAmountOrders = Object.values(orders).filter(o => o && ['pending', 'checking', 'timeout'].includes(o.status) && Number(o.amount) === Number(parsed.amount) && (!o.expire || now <= Number(o.expire) + 30 * 60 * 1000));
  const hasCompactMemo = /(?:^|[^A-Z0-9])[NM]-?[A-F0-9]{6}(?:$|[^A-Z0-9])/i.test(transferText) || /(?:^|[^A-Z0-9])[NM][A-F0-9]{12}(?:$|[^A-Z0-9])/i.test(transferText);
  const knownPrefix = hasCompactMemo ||
    transferMemoIncluded(transferText, STORE_TRANSFER_PREFIX) ||
    transferMemoIncluded(transferText, KEY_TRANSFER_PREFIX);
  if (knownPrefix || sameAmountOrders.length) {
    await notifyPaymentReview(parsed, sameAmountOrders, knownPrefix ? 'Đã nhận diện mã/tiền tố đơn hàng nhưng không tìm thấy đơn còn hiệu lực khớp chính xác. Admin cần đối soát tài khoản thật.' : 'Có đơn chờ cùng số tiền nhưng phần ND không chứa mã đơn riêng. Không tự cấp KEY/FILE; admin cần kiểm tra giao dịch.');
  }

}

async function showHashTool(chatId) {
  return send(chatId, `╭━━ 🧩 <b>TOOL MD5/SHA256</b> ━━╮\n\n🔐 <b>Phân tích mã MD5 / SHA-256</b>\n\n📌 Gửi mã hash dạng ký tự hex:\n├ MD5: 32 ký tự\n└ SHA-256: 64 ký tự\n\n👇 <i>Gửi mã hash của bạn ngay tại đây.</i>`,
    kb([[btn('🏠 THOÁT VỀ MENU', 'menu', 'danger')]]));
}

async function showAdmin(chatId) {
  if (!isAdmin(chatId)) return send(chatId, '⛔ Tài khoản không có quyền quản trị.');
  const now = Date.now();
  const allIds = Object.keys(users);
  const activeVip = allIds.filter(id => Number(users[id].vipUntil || 0) > now);
  const pendingFiles = Object.values(orders).filter(o => o && o.type === 'file' && ['pending', 'checking', 'timeout'].includes(o.status));
  const pendingKeys = Object.values(orders).filter(o => o && o.type !== 'file' && ['pending', 'checking', 'timeout'].includes(o.status));
  const activeFile = storeFiles[String(storeProduct.activeFileId || '')];
  const channels = settings.feedbackChannels || [];
  const lines = [
    '👑 <b>TRUNG TÂM ADMIN BOT</b>',
    '━━━━━━━━━━━━━━━━━━',
    `👥 Tổng người dùng: <b>${allIds.length}</b>`,
    `🔓 VIP đang hoạt động: <b>${activeVip.length}</b>`,
    `🧾 Đơn kho file chờ xử lý: <b>${pendingFiles.length}</b>`,
    `🔑 Đơn mua KEY chờ xử lý: <b>${pendingKeys.length}</b>`,
    `📦 File đang bán: <b>${esc(activeFile ? activeFile.originalName : 'Chưa có file')}</b>`,
    `💰 Giá kho file: <b>${fmt(STORE_PRICE)}đ</b>`,
    `🔑 Mã CK KEY: <code>${esc(memoToken(KEY_TRANSFER_PREFIX, 1) || 'N')}-XXXXXX</code>`,
    `📦 Mã CK FILE: <code>${esc(memoToken(STORE_TRANSFER_PREFIX, 1) || 'M')}-XXXXXX</code>`,
    `🏦 Nhóm TPBank: <code>${esc(settings.bankGroupId || 'Chưa cài')}</code>`,
    `⭐ Kênh feedback: <b>${channels.length}</b>`,
    '━━━━━━━━━━━━━━━━━━',
    '<b>⚙️ LỆNH CẤU HÌNH</b>',
    '• Gửi tài liệu kèm caption <code>/setfile</code> để thay file đang bán',
    '• <code>/setfileprice 10000</code> • đổi giá kho file',
    '• <code>/setfilememo M</code> • đặt mã đầu đơn FILE (M-XXXXXX)',
    '• <code>/setkeyprefix N</code> • đặt mã đầu đơn KEY (N-XXXXXX)',
    '• <code>/setbankgroup -100...</code> / <code>/setbankgroup_here</code> • nhóm biến động số dư',
    '• <code>/bankstatus</code> • xem bot có nhận được tin VietQR gần nhất không',
    '• <code>/setbanksenders ID1,ID2</code> • whitelist nguồn gửi thông báo ngân hàng',
    '• <code>/setbank BIN|STK|CHỦ TK</code> • đổi tài khoản nhận tiền',
    '• <code>/setproduct Tên sản phẩm</code> • đổi tên sản phẩm',
    '• <code>/fbchannel add ID</code> / <code>/fbchannel remove ID</code>',
    '• <code>/fbchannel add_here</code> • đăng ký nhóm hiện tại',
    '• <code>/fbchannels</code> • xem kênh feedback',
    '• <code>/grant ID Giờ</code>, <code>/revoke ID</code>, <code>/user ID</code>',
    '• <code>/genkey Giờ</code>, <code>/mkcode CODE Giờ [max]</code>',
    '• <code>/setsupport username</code>, <code>/broadcast nội dung</code>',
    '• <code>/setprice ID amount hours label</code> | chỉnh giá và thời hạn gói',
    '• <code>/maintenance on/off</code> | bật hoặc tắt bảo trì',
    '• <code>/game list</code>, <code>/game on/off ID</code> | quản lý game',
    '• <code>/gameurl ID HTTPS_URL</code> | thay API game',
    '• <code>/setpoll 5..120</code> | chỉnh chu kỳ cập nhật giây',
    '• <code>/reactions on/off</code> | bật hoặc tắt reaction',
    '• <code>/settitle</code>, <code>/setwelcome</code>, <code>/maintmsg</code> | chỉnh nội dung bot'
  ];
  return send(chatId, lines.join('\n'), kb([
    [btn('🧾 ĐƠN KHO FILE CHỜ DUYỆT', 'adm:orders', 'success')],
    [btn('🔑 ĐƠN MUA KEY CHỜ DUYỆT', 'adm:keyorders', 'primary')],
    [btn('📦 KIỂM TRA KHO FILE', 'adm:files', 'primary'), btn('⭐ KÊNH FEEDBACK', 'adm:feedbackchannels', 'primary')],
    [btn('🛠 VẬN HÀNH BOT', 'adm:operations', 'primary'), btn('🎮 GAME / API', 'adm:games', 'primary')],
    [btn('⚙️ CÀI ĐẶT CHUNG', 'adm:settings', 'primary'), btn('💳 GÓI THUÊ', 'adm:packages', 'primary')],
    [btn('👥 NGƯỜI DÙNG', 'adm:users', 'primary'), btn('🏦 CHECK BANK', 'adm:bank', 'primary')],
    [btn('🔄 LÀM MỚI', 'adm:home', 'success')]
  ]));
}

async function showPendingFileOrders(chatId) {
  if (!isAdmin(chatId)) return send(chatId, '⛔ Không có quyền admin.');
  const list = Object.values(orders).filter(o => o && o.type === 'file' && ['pending', 'checking', 'timeout'].includes(o.status)).sort((a,b) => Number(a.created||0)-Number(b.created||0));
  if (!list.length) return send(chatId, '✅ Hiện không có đơn kho file nào chờ duyệt.', kb([[btn('◀️ ADMIN', 'adm:home', 'primary')]]));
  await send(chatId, `🧾 <b>ĐƠN KHO FILE CHỜ XỬ LÝ</b>\nCó ${list.length} đơn đang chờ. Chỉ xác nhận sau khi kiểm tra tiền vào tài khoản TPBank.`);
  for (const order of list.slice(0, 15)) {
    await send(chatId, `📦 <b>${esc(order.product || STORE_PRODUCT_NAME)}</b>\n🧾 Đơn: <code>${esc(order.id)}</code>\n👤 User: <code>${esc(order.uid)}</code>\n💰 ${fmt(order.amount)}đ\n📝 <code>${esc(order.addInfo)}</code>\n📌 Trạng thái: <b>${esc(order.status)}</b>`, kb([
      [btn('✅ XÁC NHẬN + GỬI FILE', 'store:approve:' + order.id, 'success')],
      [btn('❌ TỪ CHỐI ĐƠN', 'store:reject:' + order.id, 'danger')]
    ]));
  }
  return send(chatId, 'Quản lý xong các đơn phía trên thì quay lại đây để làm mới danh sách.', kb([[btn('🔄 LÀM MỚI ĐƠN', 'adm:orders', 'success'), btn('◀️ ADMIN', 'adm:home', 'primary')]]));
}

async function showPendingKeyOrders(chatId) {
  if (!isAdmin(chatId)) return send(chatId, '⛔ Không có quyền admin.');
  const list = Object.values(orders).filter(o => o && o.type !== 'file' && ['pending', 'checking', 'timeout'].includes(o.status)).sort((a, b) => Number(a.created || 0) - Number(b.created || 0));
  if (!list.length) return send(chatId, '✅ Hiện không có đơn mua KEY nào chờ duyệt.', kb([[btn('◀️ ADMIN', 'adm:home', 'primary')]]));
  await send(chatId, `🔑 <b>ĐƠN MUA KEY CHỜ XỬ LÝ</b>\nCó ${list.length} đơn. Chỉ duyệt sau khi xác nhận tiền vào tài khoản thật.`);
  for (const order of list.slice(0, 20)) {
    await send(chatId, `💳 <b>ĐƠN MUA KEY</b>\n🧾 ${esc(order.id)}\n👤 User: <code>${esc(order.uid)}</code> ${order.username ? '(@' + esc(order.username) + ')' : ''}\n💰 ${fmt(order.amount)}đ • ${Number(order.hours) || 24} giờ\n📝 <code>${esc(order.addInfo || '')}</code>\n📌 ${esc(order.status)}`, kb([
      [btn('✅ XÁC NHẬN + CẤP KEY', 'keyorder:approve:' + order.id, 'success')],
      [btn('❌ TỪ CHỐI', 'keyorder:reject:' + order.id, 'danger')]
    ]));
  }
  return send(chatId, 'Hoàn tất đối soát thì bấm làm mới để cập nhật danh sách.', kb([[btn('🔄 LÀM MỚI', 'adm:keyorders', 'success'), btn('◀️ ADMIN', 'adm:home', 'primary')]]));
}

async function showAdminFiles(chatId) {
  if (!isAdmin(chatId)) return send(chatId, '⛔ Không có quyền admin.');
  const file = storeFiles[String(storeProduct.activeFileId || '')];
  return send(chatId, `📦 <b>QUẢN LÝ KHO FILE</b>\n\n📁 File đang bán: <b>${esc(file ? file.originalName : 'Chưa có')}</b>\n💰 Giá: <b>${fmt(STORE_PRICE)}đ</b>\n📝 Mã CK: <code>${esc(memoToken(STORE_TRANSFER_PREFIX, 1) || 'M')}-XXXXXX</code>\n\n📤 Để thêm hoặc thay file, gửi tài liệu trực tiếp cho bot trong chat riêng và ghi caption <code>/setfile</code>. File mới sẽ tự động được chọn làm file đang bán.`, kb([[btn('🧾 ĐƠN CHỜ DUYỆT', 'adm:orders', 'success')], [btn('◀️ ADMIN', 'adm:home', 'primary')]]));
}

async function showFeedbackChannels(chatId) {
  if (!isAdmin(chatId)) return send(chatId, '⛔ Không có quyền admin.');
  const list = (settings.feedbackChannels || []).map(x => `<code>${esc(x)}</code>`);
  return send(chatId, `⭐ <b>KÊNH NHẬN FEEDBACK ĐÃ DUYỆT</b>\n\n${list.length ? list.join('\n') : 'Chưa đăng ký kênh nào.'}\n\nDùng <code>/fbchannel add ID</code> để thêm hoặc <code>/fbchannel add_here</code> khi nhắn trong nhóm. Bot phải có quyền đăng bài tại kênh/nhóm nhận feedback.`, kb([[btn('◀️ ADMIN', 'adm:home', 'primary')]]));
}

async function showAdminOperations(chatId) {
  const maintenance = settings.maintenance === true;
  const reactions = settings.reactionsEnabled !== false;
  const pollSeconds = Math.round((Number(settings.pollMs) || POLL_MS) / 1000);
  return send(chatId, `🛠 <b>ĐIỀU KHIỂN VẬN HÀNH BOT</b>\n\n${maintenance ? '🔴 BẢO TRÌ ĐANG BẬT' : '🟢 BOT ĐANG MỞ CHO USER'}\n${reactions ? '🎭 Reaction tự động: BẬT' : '🎭 Reaction tự động: TẮT'}\n⏱ Chu kỳ cập nhật game: <b>${pollSeconds} giây</b>\n\n<b>Lệnh nhanh</b>\n<code>/maintenance on</code> hoặc <code>/maintenance off</code>\n<code>/maintmsg Nội dung bảo trì</code>\n<code>/reactions on</code> hoặc <code>/reactions off</code>\n<code>/setpoll 10</code> để đặt chu kỳ 10 giây\n<code>/broadcast Nội dung</code> để gửi thông báo đến user`, kb([
    [btn(maintenance ? '🟢 TẮT BẢO TRÌ' : '🔴 BẬT BẢO TRÌ', maintenance ? 'adm:maint:off' : 'adm:maint:on', maintenance ? 'success' : 'danger')],
    [btn(reactions ? '🎭 TẮT REACTION' : '🎭 BẬT REACTION', reactions ? 'adm:reaction:off' : 'adm:reaction:on', 'primary')],
    [btn('🎮 QUẢN LÝ GAME / API', 'adm:games', 'primary')],
    [btn('◀️ ADMIN', 'adm:home', 'primary')]
  ]));
}

async function showAdminGames(chatId) {
  if (!isAdmin(chatId)) return send(chatId, '⛔ Không có quyền admin.');
  const rows = [];
  for (const g of games) {
    const icon = g.enabled === false ? '⚫' : '🟢';
    rows.push([btn(`${icon} ${g.brandLabel || g.brand} • ${g.variant}`, 'adm:game:toggle:' + g.id, 'primary')]);
  }
  rows.push([btn('◀️ ADMIN', 'adm:home', 'primary')]);
  return send(chatId, `🎮 <b>QUẢN LÝ GAME VÀ API</b>\n\nChạm một game để bật hoặc tắt.\n🟢 Đang bật  •  ⚫ Đang tắt\n\nĐổi API bằng lệnh:\n<code>/gameurl ID https://domain/api/path</code>\nVí dụ: <code>/gameurl betvip_tx https://api.example.com/tx</code>\nXem ID bằng <code>/game list</code>.`, kb(rows));
}

async function showAdminSettings(chatId) {
  const support = settings.support ? '@' + settings.support : 'Chưa cài';
  const bank = settings.bank || BANK;
  const msg = settings.maintenanceMessage || 'Bot đang bảo trì, vui lòng quay lại sau.';
  return send(chatId, `⚙️ <b>CÀI ĐẶT CHUNG</b>\n\n🏷 Tên bot: <b>${esc(settings.botTitle || 'TOOL TX BY FEE')}</b>\n💬 Support: <b>${esc(support)}</b>\n🏦 Ngân hàng: <b>${esc(bank.bankCode || bank.bin || 'TPBank')}</b>\n💳 STK: <code>${esc(bank.account || '')}</code>\n📣 Nhóm bắt buộc: <b>${(settings.groups || []).length}</b>\n📝 Lời chào: <b>${esc(settings.welcomeText || 'Mặc định')}</b>\n\n<b>Lệnh điều chỉnh</b>\n<code>/settitle Tên bot</code>\n<code>/setwelcome Nội dung lời chào</code>\n<code>/setsupport username</code>\n<code>/setbank BIN|STK|CHU_TK</code>\n<code>/addgroup ID|TÊN|LINK</code>\n<code>/removegroup ID</code>\n<code>/groups</code>\n\n<b>Nội dung bảo trì hiện tại</b>\n${esc(msg)}`, kb([
    [btn('🛠 VẬN HÀNH', 'adm:operations', 'primary'), btn('🎮 GAME / API', 'adm:games', 'primary')],
    [btn('💳 GÓI THUÊ', 'adm:packages', 'primary'), btn('👥 NGƯỜI DÙNG', 'adm:users', 'primary')],
    [btn('◀️ ADMIN', 'adm:home', 'primary')]
  ]));
}

async function showAdminPackages(chatId) {
  const rows = (settings.packages || []).map(p => `• <code>${esc(p.id)}</code> | ${esc(p.label || p.id)} | <b>${fmt(p.amount)}đ</b> | ${Number(p.hours) || 0} giờ`);
  return send(chatId, `💳 <b>QUẢN LÝ GÓI THUÊ TOOL</b>\n\n${rows.length ? rows.join('\n') : 'Chưa có gói thuê.'}\n\nThêm hoặc sửa gói bằng:\n<code>/setprice ID SOTIEN GIO TEN_GOI</code>\nVí dụ: <code>/setprice 1d 2500 24 2.5K 1 NGAY</code>`, kb([
    [btn('🔄 LÀM MỚI', 'adm:packages', 'success')],
    [btn('◀️ ADMIN', 'adm:home', 'primary')]
  ]));
}

async function showAdminUsers(chatId) {
  const list = Object.entries(users).sort((a,b) => Number(b[1].lastActive || 0) - Number(a[1].lastActive || 0)).slice(0, 12);
  const active = Object.values(users).filter(u => Number(u.vipUntil || 0) > Date.now()).length;
  const rows = list.map(([id, u]) => [btn(`${u.username ? '@' + u.username : id} • ${Number(u.vipUntil || 0) > Date.now() ? 'VIP' : 'FREE'}`, 'adm:user:view:' + id, 'primary')]);
  rows.push([btn('◀️ ADMIN', 'adm:home', 'primary')]);
  return send(chatId, `👥 <b>QUẢN LÝ NGƯỜI DÙNG</b>\n\nTổng user: <b>${Object.keys(users).length}</b>\nVIP còn hạn: <b>${active}</b>\n\nLệnh quản lý:\n<code>/user ID</code> xem hồ sơ\n<code>/grant ID GIO</code> cấp thời gian\n<code>/revoke ID</code> thu hồi quyền\n<code>/broadcast Nội dung</code> gửi thông báo`, kb(rows));
}

async function showAdminBank(chatId) {
  const age = bankMonitor.receivedAt ? Math.max(0, Math.round((Date.now() - bankMonitor.receivedAt) / 60000)) + ' phút trước' : 'chưa ghi nhận';
  const pending = Object.values(orders).filter(o => o && ['pending','checking','timeout'].includes(o.status)).length;
  return send(chatId, `🏦 <b>TRẠNG THÁI CHECK BANK</b>\n\nNhóm: <code>${esc(settings.bankGroupId || 'Chưa cài')}</code>\nTin mới nhất: <b>${age}</b>\nNguồn gửi: <code>${esc(bankMonitor.senderId || 'Chưa có')}</code>\nBot gửi: <b>${bankMonitor.isBot ? 'Có' : 'Không'}</b>\nTin cậy: <b>${bankMonitor.trusted ? 'Có' : 'Chưa xác nhận'}</b>\nSố tiền: <b>${bankMonitor.amount ? fmt(bankMonitor.amount) + 'đ' : 'Chưa đọc được'}</b>\nMã giao dịch: <code>${esc(bankMonitor.ref || 'Chưa có')}</code>\nĐơn chờ: <b>${pending}</b>\n\nLệnh: <code>/bankstatus</code>, <code>/setbankgroup ID</code>, <code>/setbanksenders ID1,ID2</code>`, kb([
    [btn('🔄 KIỂM TRA LẠI', 'adm:bank', 'success')],
    [btn('🧾 ĐƠN CHỜ DUYỆT', 'adm:orders', 'primary'), btn('🔑 ĐƠN KEY', 'adm:keyorders', 'primary')],
    [btn('◀️ ADMIN', 'adm:home', 'primary')]
  ]));
}

async function publishApprovedFeedback(fb) {
  const title = '⭐ <b>FEEDBACK NGƯỜI DÙNG</b>\n━━━━━━━━━━━━━━━━━━';
  const name = fb.username ? '@' + esc(fb.username) : esc(fb.name || 'Người dùng');
  const body = `${title}\n👤 ${name}\n🌟 Đánh giá: <b>${Number(fb.star || 0)}/5</b>\n💬 Nội dung: ${esc(fb.note || 'Người dùng không để lại ghi chú.')}\n\n💙 Cảm ơn bạn đã sử dụng dịch vụ!`;
  const targets = settings.feedbackChannels || [];
  const results = [];
  for (const target of targets) {
    const result = fb.photo
      ? await tg('sendPhoto', { chat_id: target, photo: fb.photo, caption: body, parse_mode: 'HTML' })
      : await send(target, body);
    results.push({ target, ok: Boolean(result && result.ok), error: result && result.description });
  }
  return results;
}

async function reviewFeedback(feedbackId, adminId, approve) {
  if (!isAdmin(adminId)) return { ok: false, message: 'Không có quyền admin.' };
  const fb = feedbacks[feedbackId];
  if (!fb) return { ok: false, message: 'Không tìm thấy feedback.' };
  if (fb.status !== 'pending') return { ok: false, message: 'Feedback này đã được xử lý.' };
  if (!approve) {
    fb.status = 'rejected'; fb.reviewedAt = Date.now(); fb.reviewedBy = String(adminId); saveFeedbacks();
    await send(fb.uid, '🙏 Feedback của bạn đã được admin xem xét. Cảm ơn bạn đã đóng góp ý kiến!');
    return { ok: true, message: 'Đã từ chối feedback.' };
  }
  fb.status = 'approved'; fb.reviewedAt = Date.now(); fb.reviewedBy = String(adminId); saveFeedbacks();
  const published = await publishApprovedFeedback(fb);
  fb.publishedTo = published.filter(x => x.ok).map(x => String(x.target));
  fb.publishErrors = published.filter(x => !x.ok);
  saveFeedbacks();
  await send(fb.uid, '🎉 Cảm ơn bạn! Feedback đã được admin duyệt. 💙');
  return { ok: true, message: `Đã duyệt feedback và đăng lên ${fb.publishedTo.length}/${published.length} kênh đã cấu hình.` };
}

/* ═══════════════ CALLBACKS & MESSAGES ═══════════════ */
async function onCallback(cq) {
  const chatId = cq.message.chat.id, msgId = cq.message.message_id;
  const from = cq.from, uid = uidOf(from), data = String(cq.data || '');
  await answerCb(cq.id);
  // Keep the clicked message visible; remove only its old buttons so Back never leaves a blank chat.
  await clearInlineKeyboard(chatId, msgId);
  if (settings.maintenance && !isAdmin(uid)) return send(chatId, `🛠 <b>BOT ĐANG BẢO TRÌ</b>\n\n${esc(settings.maintenanceMessage || 'Bot đang bảo trì, vui lòng quay lại sau.')}`);

  if (data === 'menu') { stopAuto(uid); delete sessions[uid]; return showUserMenu(chatId, from); }
  if (data === 'hash:start') {
    if (!isVip(uid)) return send(chatId, '🔒 <b>MUA KEY ĐÊ RỒI XEM</b>', kb([[btn('💳 THUÊ TOOL', 'rent:menu', 'primary'), btn('🔑 NHẬP KEY', 'key:input', 'success')], [btn('◀️ QUAY LẠI', 'menu', 'primary')]]));
    sessions[uid] = { await: 'hash_input' };
    return showHashTool(chatId);
  }
  if (data === 'adm:home' && isAdmin(uid)) return showAdmin(chatId);
  if (data === 'adm:operations' && isAdmin(uid)) return showAdminOperations(chatId);
  if (data === 'adm:games' && isAdmin(uid)) return showAdminGames(chatId);
  if (data === 'adm:settings' && isAdmin(uid)) return showAdminSettings(chatId);
  if (data === 'adm:packages' && isAdmin(uid)) return showAdminPackages(chatId);
  if (data === 'adm:users' && isAdmin(uid)) return showAdminUsers(chatId);
  if (data === 'adm:bank' && isAdmin(uid)) return showAdminBank(chatId);
  if (data === 'adm:maint:on' && isAdmin(uid)) { settings.maintenance = true; saveSettings(); return showAdminOperations(chatId); }
  if (data === 'adm:maint:off' && isAdmin(uid)) { settings.maintenance = false; saveSettings(); return showAdminOperations(chatId); }
  if (data === 'adm:reaction:on' && isAdmin(uid)) { settings.reactionsEnabled = true; saveSettings(); return showAdminOperations(chatId); }
  if (data === 'adm:reaction:off' && isAdmin(uid)) { settings.reactionsEnabled = false; saveSettings(); return showAdminOperations(chatId); }
  if (data.startsWith('adm:game:toggle:') && isAdmin(uid)) {
    const id = data.slice('adm:game:toggle:'.length);
    const game = games.find(g => g.id === id);
    if (!game) return send(chatId, '⚠️ Không tìm thấy game.');
    game.enabled = game.enabled === false;
    saveJSON('games.json', games);
    return showAdminGames(chatId);
  }
  if (data.startsWith('adm:user:view:') && isAdmin(uid)) {
    const targetUid = data.slice('adm:user:view:'.length);
    const user = ensureUser(targetUid);
    const expiry = Number(user.vipUntil || 0) > Date.now() ? new Date(user.vipUntil).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) + ' (GMT+7)' : 'Chưa kích hoạt';
    return send(chatId, `👤 <b>HỒ SƠ USER</b>\nID: <code>${esc(targetUid)}</code>\nUsername: <b>${esc(user.username || 'Chưa có')}</b>\nTên: <b>${esc(user.name || 'Chưa có')}</b>\nHạn dùng: <b>${esc(expiry)}</b>\nLượt dự đoán: <b>${Number(user.predCount || 0)}</b>\n\nDùng <code>/grant ${esc(targetUid)} 24</code> để cấp 24 giờ hoặc <code>/revoke ${esc(targetUid)}</code> để thu hồi.`, kb([[btn('◀️ NGƯỜI DÙNG', 'adm:users', 'primary')], [btn('👑 ADMIN', 'adm:home', 'success')]]));
  }
  if (data === 'adm:orders' && isAdmin(uid)) return showPendingFileOrders(chatId);
  if (data === 'adm:keyorders' && isAdmin(uid)) return showPendingKeyOrders(chatId);
  if (data === 'adm:files' && isAdmin(uid)) return showAdminFiles(chatId);
  if (data === 'adm:feedbackchannels' && isAdmin(uid)) return showFeedbackChannels(chatId);
  if (data === 'store:open') return showFileStore(chatId);
  if (data === 'store:confirm') {
    const active = storeFiles[String(storeProduct.activeFileId || '')];
    if (!storeFileExists(active)) return showFileStore(chatId);
    return send(chatId, `🛒 <b>XÁC NHẬN MUA KHO FILE</b>\n\n📦 ${esc(STORE_PRODUCT_NAME)}\n💰 Giá: <b>${fmt(STORE_PRICE)}đ</b>\n📝 Mã chuyển khoản: <code>M-XXXXXX</code>\n\nMã riêng cho đơn này. Thông tin người mua và thời gian được lưu trong hệ thống.`, kb([
      [btn('✅ TẠO MÃ QR THANH TOÁN', 'store:buy', 'success')],
      [btn('◀️ QUAY LẠI', 'store:open', 'danger')]
    ]));
  }
  if (data === 'store:buy') return createFileOrder(chatId, uid);
  if (data.startsWith('store:done:')) return markFileOrderDone(chatId, uid, data.slice(11));
  if (data.startsWith('store:cancel:')) {
    const oid = data.slice(13), order = orders[oid];
    if (order && order.type === 'file' && order.uid === String(uid) && order.status === 'pending') { order.status = 'cancelled'; saveOrders(); }
    return send(chatId, '🗑 Đã huỷ đơn kho file.', kb([[btn('📦 KHO FILE', 'store:open', 'primary'), btn('🏠 MENU', 'menu', 'success')]]));
  }
  if (data.startsWith('store:approve:')) {
    if (!isAdmin(uid)) return send(chatId, '⛔ Bạn không có quyền.');
    const result = await approveFileOrder(data.slice(14), uid);
    return send(chatId, (result.ok ? '✅ ' : '❌ ') + esc(result.message));
  }
  if (data.startsWith('store:reject:')) {
    if (!isAdmin(uid)) return send(chatId, '⛔ Bạn không có quyền.');
    const result = await rejectFileOrder(data.slice(13), uid);
    return send(chatId, (result.ok ? '✅ ' : '❌ ') + esc(result.message));
  }
  if (data.startsWith('keyorder:approve:')) {
    if (!isAdmin(uid)) return send(chatId, '⛔ Bạn không có quyền.');
    const result = await approveKeyOrder(data.slice(17), uid);
    return send(chatId, (result.ok ? '✅ ' : '❌ ') + esc(result.message));
  }
  if (data.startsWith('keyorder:reject:')) {
    if (!isAdmin(uid)) return send(chatId, '⛔ Bạn không có quyền.');
    const result = await rejectKeyOrder(data.slice(16), uid);
    return send(chatId, (result.ok ? '✅ ' : '❌ ') + esc(result.message));
  }
  if (data === 'pred:brands') { stopAuto(uid); return showBrandMenu(chatId); }
  if (data.startsWith('predbrand:')) { stopAuto(uid); return showTables(chatId, data.slice(10), uid); }
  if (data.startsWith('predhist:')) return exportHistory(chatId, data.slice(9));

  if (data === 'key:input') {
    sessions[uid] = { await: 'key_input' };
    return send(chatId, '🔑 <b>NHẬP KEY</b>\n\nGửi KEY của bạn:', kb([[btn('◀️ QUAY LẠI', 'menu', 'primary')]]));
  }
  if (data === 'code:input') {
    sessions[uid] = { await: 'code_input' };
    return send(chatId, '🎫 <b>NHẬP CODE</b>\n\nGửi code:', kb([[btn('◀️ QUAY LẠI', 'menu', 'primary')]]));
  }
  if (data === 'rent:menu') return showRentMenu(chatId);
  if (data.startsWith('rent:pkg:')) return showRentConfirm(chatId, data.slice(9));
  if (data.startsWith('rent:yes:')) return createRentOrder(chatId, uid, data.slice(9));
  if (data.startsWith('rent:done:')) return markOrderDone(chatId, uid, data.slice(10));
  if (data.startsWith('rent:cancel:')) {
    const oid = data.slice(12), order = orders[oid];
    if (order && order.uid === String(uid) && ['pending', 'checking', 'timeout'].includes(order.status)) { order.status = 'cancelled'; order.cancelledAt = Date.now(); saveOrders(); }
    else if (order && order.uid === String(uid)) return send(chatId, '⚠️ Đơn đã được xử lý hoặc đang giao KEY, không thể huỷ bằng nút này.');
    return send(chatId, '🗑 Đã huỷ đơn nếu đơn vẫn còn chờ thanh toán.', kb([[btn('◀️ QUAY LẠI', 'rent:menu', 'primary')]]));
  }
  if (data === 'support:go') {
    const s = settings.support || 'SunNetWin';
    return send(chatId, '💬 <b>SUPPORT</b>\nLiên hệ admin: @' + s, kb([
      [btnUrl('📩 NHẮN ADMIN', 'https://t.me/' + s, 'primary')],
      [btn('◀️ QUAY LẠI', 'menu', 'primary')]
    ]));
  }
  if (data === 'join:check') {
    const join = await checkUserInGroups(uid);
    if (!join.ok) return showForceJoin(chatId, join.missing);
    return showUserMenu(chatId, from);
  }
  if (data === 'fb:start') {
    sessions[uid] = { await: 'fb_photo', fb: {} };
    return send(chatId, '⭐ <b>FEEDBACK • Bước 1</b>\n\nGửi ảnh (hoặc bấm SKIP):', kb([
      [btn('⏭ SKIP', 'fb:skipphoto', 'primary')],
      [btn('◀️ QUAY LẠI', 'menu', 'primary')]
    ]));
  }
  if (data === 'fb:skipphoto') {
    sessions[uid] = { await: 'fb_note', fb: { photo: null } };
    return send(chatId, '⭐ <b>FEEDBACK • Bước 2</b>\n\nNote nội dung vào đây:', kb([
      [btn('⏭ SKIP', 'fb:skipnote', 'primary')],
      [btn('◀️ QUAY LẠI', 'menu', 'primary')]
    ]));
  }
  if (data === 'fb:skipnote') {
    sessions[uid] = { await: null, fb: Object.assign((sessions[uid] && sessions[uid].fb) || {}, { note: '' }) };
    return send(chatId, '⭐ <b>FEEDBACK • Bước 3</b>\n\nChọn số sao:', kb([
      [btn('⭐ 1', 'fb:star:1', 'danger'), btn('⭐ 2', 'fb:star:2', 'danger'), btn('⭐ 3', 'fb:star:3', 'primary')],
      [btn('⭐ 4', 'fb:star:4', 'success'), btn('⭐ 5', 'fb:star:5', 'success')],
      [btn('◀️ QUAY LẠI', 'menu', 'primary')]
    ]));
  }
  if (data.startsWith('fb:star:')) {
    const star = Number(data.slice(8));
    const draft = (sessions[uid] && sessions[uid].fb) || {};
    delete sessions[uid];
    const feedbackId = 'FB' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();
    const record = {
      id: feedbackId, uid: String(uid), username: from.username || '', name: displayName(from),
      star: Math.max(1, Math.min(5, star)), note: String(draft.note || '').slice(0, 600), photo: draft.photo || null,
      createdAt: Date.now(), status: 'pending'
    };
    feedbacks[feedbackId] = record; saveFeedbacks();
    const body = `⭐ <b>FEEDBACK CHỜ ADMIN DUYỆT</b>\n━━━━━━━━━━━━━━━━━━\n🧾 Mã: <code>${feedbackId}</code>\n👤 ${esc(record.name)} ${record.username ? '(@' + esc(record.username) + ')' : ''}\n🆔 User: <code>${uid}</code>\n🌟 Đánh giá: <b>${record.star}/5</b>\n💬 Nội dung: ${esc(record.note || 'Không có ghi chú')}\n\nChọn duyệt để đăng lên các kênh feedback đã cấu hình.`;
    for (const aid of ADMIN_IDS) {
      const markup = kb([[btn('✅ DUYỆT & ĐĂNG KÊNH', 'fb:approve:' + feedbackId, 'success'), btn('❌ TỪ CHỐI', 'fb:reject:' + feedbackId, 'danger')]]);
      if (record.photo) await tg('sendPhoto', { chat_id: aid, photo: record.photo, caption: body, parse_mode: 'HTML', reply_markup: markup.reply_markup });
      else await send(aid, body, markup);
    }
    return send(chatId, '✅ <b>FEEDBACK ĐÃ ĐƯỢC GỬI ĐẾN ADMIN</b>\n\n⏳ Sau khi admin duyệt, nội dung sẽ được đăng lên các kênh đã cài đặt. Cảm ơn bạn đã đóng góp ý kiến! 💙', kb([[btn('🏠 MENU', 'menu', 'primary')]]));
  }
  if (data.startsWith('fb:approve:') || data.startsWith('fb:reject:')) {
    if (!isAdmin(uid)) return send(chatId, '⛔ Bạn không có quyền admin.');
    const approve = data.startsWith('fb:approve:');
    const feedbackId = data.slice(approve ? 11 : 10);
    const result = await reviewFeedback(feedbackId, uid, approve);
    return send(chatId, (result.ok ? '✅ ' : '❌ ') + esc(result.message));
  }
  if (data === 'hash:ok' || data === 'hash:bad') {
    const predictionKey = `${chatId}:${msgId}`;
    const prediction = hashPredictions[predictionKey];
    if (!prediction || prediction.uid !== String(uid)) {
      return send(chatId, '⚠️ Kết quả này không còn ở trạng thái chờ xác nhận. Hãy gửi mã hash mới để phân tích.');
    }
    if (data === 'hash:bad') {
      sessions[uid] = { await: 'hash_actual', predictionKey };
      return send(chatId, '🧾 <b>XÁC NHẬN KẾT QUẢ THỰC TẾ</b>\n\nBạn báo dự đoán sai. Kết quả thật của ván đó là gì?', kb([
        [btn('🔴 THỰC TẾ TÀI', 'hash:actual:T', 'danger')],
        [btn('🔵 THỰC TẾ XỈU', 'hash:actual:X', 'primary')]
      ]));
    }
    const actual = prediction.side;
    const hashSave = recordHashOutcome({ uid: String(uid), hash: prediction.hash, type: prediction.type, prediction: prediction.side, actual, feedback: 'correct', confidence: prediction.conf, createdAt: Date.now() });
    delete hashPredictions[predictionKey]; saveHashPredictions();
    if (hashSave.reason === 'conflict') return send(chatId, '⚠️ Mã này đã có phản hồi thực tế mâu thuẫn trước đó nên được loại khỏi dữ liệu huấn luyện. Hãy dùng mã và kết quả đã xác minh khác.');
    sessions[uid] = { await: 'hash_input' };
    return send(chatId, hashSave.saved ? '✅ <b>ĐÃ GHI NHẬN KẾT QUẢ THỰC TẾ</b>\nMẫu mới đã được thêm vào dữ liệu kiểm định của Tool Hash. Gửi mã hash tiếp theo để phân tích.' : '✅ <b>ĐÃ GHI NHẬN PHẢN HỒI</b>\nMã này đã có trong dữ liệu; bot cập nhật số lần xác nhận nhưng không nhân đôi mẫu huấn luyện. Gửi mã hash tiếp theo để phân tích.', kb([
      [btn('🧩 PHÂN TÍCH MÃ TIẾP', 'hash:again', 'success')], [btn('🏠 THOÁT', 'menu', 'danger')]
    ]));
  }
  if (data.startsWith('hash:actual:')) {
    const st = sessions[uid];
    if (!st || st.await !== 'hash_actual' || !st.predictionKey) return send(chatId, '⚠️ Phiên xác nhận đã hết hạn. Hãy gửi mã hash mới.');
    const prediction = hashPredictions[st.predictionKey];
    if (!prediction || prediction.uid !== String(uid)) { delete sessions[uid]; return send(chatId, '⚠️ Không tìm thấy dự đoán cần xác nhận.'); }
    const actual = data.slice('hash:actual:'.length);
    if (actual !== 'T' && actual !== 'X') return send(chatId, '⚠️ Kết quả thực tế không hợp lệ.');
    const hashSave = recordHashOutcome({ uid: String(uid), hash: prediction.hash, type: prediction.type, prediction: prediction.side, actual, feedback: actual === prediction.side ? 'correct' : 'incorrect', confidence: prediction.conf, createdAt: Date.now() });
    delete hashPredictions[st.predictionKey]; delete sessions[uid];
    saveHashPredictions();
    if (hashSave.reason === 'conflict') return send(chatId, '⚠️ Mã hash này từng được xác nhận với kết quả khác. Mẫu đã bị loại khỏi huấn luyện để tránh làm sai mô hình.');
    sessions[uid] = { await: 'hash_input' };
    const correct = actual === prediction.side;
    return send(chatId, `${correct ? '✅' : '❌'} <b>ĐÃ LƯU KẾT QUẢ THỰC TẾ: ${actual === 'T' ? 'TÀI' : 'XỈU'}</b>\n📚 Dữ liệu phản hồi đã được kiểm tra trùng/mâu thuẫn trước khi dùng huấn luyện.`, kb([
      [btn('🧩 PHÂN TÍCH MÃ TIẾP', 'hash:again', 'success')], [btn('🏠 THOÁT', 'menu', 'danger')]
    ]));
  }
  if (data === 'hash:again') {
    sessions[uid] = { await: 'hash_input' };
    return showHashTool(chatId);
  }

  if (data.startsWith('pred:')) {
    const gameId = data.slice(5);
    if (gameId === 'brands') return;
    if (gameId.startsWith('stop:')) { stopAuto(uid); return send(chatId, '⏹ Đã dừng cập nhật.'); }
    if (!isVip(uid)) return send(chatId, '🔒 <b>MUA KEY ĐÊ RỒI XEM</b>', kb([[btn('💳 THUÊ TOOL', 'rent:menu', 'primary'), btn('🔑 NHẬP KEY', 'key:input', 'success')], [btn('◀️ QUAY LẠI', 'menu', 'primary')]]));
    const g = games.find(x => x.id === gameId);
    if (!g) return;
    const load = await send(chatId, '⏳ Đang lấy dữ liệu...');
    await pollGame(g);
    await delMsg(chatId, load.result && load.result.message_id);
    startAuto(uid, chatId, gameId);
    const card = await pushPredCard(chatId, gameId, uid, true);
    if (autoWatch[String(uid)] && card && card.result && card.result.message_id) autoWatch[String(uid)].messageId = card.result.message_id;
    return card;
  }

  if (data.startsWith('lc79:')) {
    return send(chatId, '⏹ Tính năng Auto cược LC79 đã được tắt.');
  }
}

async function onMessage(msg) {
  if (!msg || !msg.chat) return;
  try { await onBankMessage(msg); } catch (e) { console.error('[BANK MESSAGE]', e.message); }
  if (!msg.from) return;
  const chatId = msg.chat.id, from = msg.from, uid = uidOf(from), text = (msg.text || '').trim();
  if (msg.chat.type === 'private' && msg.message_id) queueReaction(chatId, msg.message_id);
  if (msg.chat.type === 'private' && settings.maintenance && !isAdmin(uid)) {
    return send(chatId, `🛠 <b>BOT ĐANG BẢO TRÌ</b>\n\n${esc(settings.maintenanceMessage || 'Bot đang bảo trì, vui lòng quay lại sau.')}`);
  }

  // In groups, only accept the admin command used to register the current feedback group.
  if (msg.chat.type !== 'private') {
    if (isAdmin(uid) && /^\/setbankgroup_here(?:@\w+)?$/i.test(text)) {
      settings.bankGroupId = String(chatId); saveSettings();
      await send(chatId, '✅ Đã đặt nhóm này làm nơi nhận thông báo ngân hàng: <code>' + esc(chatId) + '</code>');
      return;
    }
    if (isAdmin(uid) && /^\/fbchannel(?:@\w+)?\s+add_here$/i.test(text)) {
      settings.feedbackChannels = settings.feedbackChannels || [];
      if (!settings.feedbackChannels.map(String).includes(String(chatId))) settings.feedbackChannels.push(String(chatId));
      saveSettings();
      await send(chatId, '✅ Đã đăng ký nhóm này làm nơi nhận feedback đã duyệt.');
    }
    return;
  }

  ensureUser(uid, from);
  if (isAdmin(uid) && msg.document && ((sessions[uid] && sessions[uid].await === 'admin_file') || /^\/setfile(?:@\w+)?$/i.test(String(msg.caption || '').trim()))) {
    const doc = msg.document;
    const id = crypto.randomBytes(8).toString('hex');
    storeFiles[id] = {
      id, telegramFileId: doc.file_id, originalName: String(doc.file_name || 'kho-file').slice(0, 180),
      size: Number(doc.file_size || 0), mimeType: doc.mime_type || 'application/octet-stream', uploadedAt: Date.now(), source: 'telegram'
    };
    storeProduct.activeFileId = id;
    if (sessions[uid] && sessions[uid].await === 'admin_file') delete sessions[uid];
    saveStoreFiles(); saveStoreProduct();
    return send(chatId, `✅ <b>ĐÃ CẬP NHẬT KHO FILE</b>\n\n📁 Tệp: <b>${esc(storeFiles[id].originalName)}</b>\n📏 Dung lượng: ${(storeFiles[id].size / (1024*1024)).toFixed(2)} MB\n💰 Giá bán: <b>${fmt(STORE_PRICE)}đ</b>\n\nFile này hiện đã được chọn làm sản phẩm đang bán.`, kb([[btn('📦 KIỂM TRA KHO FILE', 'adm:files', 'primary')], [btn('👑 ADMIN', 'adm:home', 'success')]]));
  }

  if (text === '/start' || text === '/menu') {
    saveUsers(); delete sessions[uid];
    return showUserMenu(chatId, from);
  }
  if (text === '/admin' && isAdmin(uid)) return showAdmin(chatId);
  if (text === '/bankstatus' && isAdmin(uid)) {
    const age = bankMonitor.receivedAt ? Math.max(0, Math.round((Date.now() - bankMonitor.receivedAt) / 60000)) + ' phút trước' : 'chưa ghi nhận';
    const pending = Object.values(orders).filter(o => o && ['pending','checking','timeout'].includes(o.status)).length;
    return send(chatId, `🏦 <b>TRẠNG THÁI ĐỌC GIAO DỊCH</b>\n━━━━━━━━━━━━━━━━━━\nNhóm đang theo dõi: <code>${esc(settings.bankGroupId || 'chưa cài')}</code>\nThông báo gần nhất: <b>${age}</b>\nNgười gửi: <b>${esc(bankMonitor.senderName || 'chưa có')}</b>\nSender ID: <code>${esc(bankMonitor.senderId || 'Chưa có')}</code> • Bot: <b>${bankMonitor.isBot ? 'Có' : 'Không'}</b>\nSố tiền đọc được: <b>${bankMonitor.amount ? fmt(bankMonitor.amount) + 'đ' : 'Chưa có'}</b>\nMã GD: <code>${esc(bankMonitor.ref || 'Chưa có')}</code>\nTin gần nhất được tin cậy: <b>${bankMonitor.trusted ? 'Có' : 'Không'}</b>\nĐơn đang chờ: <b>${pending}</b>\n\n<i>Nếu không thấy tin nhắn từ vietqr_bot: bật Bot-to-Bot Communication trong BotFather và đặt bot này làm admin nhóm. Nếu người gửi chưa được tin cậy, dùng /setbanksenders ID để whitelist.</i>\nRaw: <code>${esc(bankMonitor.raw || 'Chưa có').slice(0, 700)}</code>`);
  }
  if (text.startsWith('/maintenance') && isAdmin(uid)) {
    const mode = text.split(/\s+/)[1] || 'status';
    if (mode === 'on') settings.maintenance = true;
    else if (mode === 'off') settings.maintenance = false;
    else if (mode !== 'status') return send(chatId, 'Dùng <code>/maintenance on</code> hoặc <code>/maintenance off</code>.');
    saveSettings();
    return send(chatId, `🛠 Bảo trì: <b>${settings.maintenance ? 'ĐANG BẬT' : 'ĐANG TẮT'}</b>`, kb([[btn('🛠 TRUNG TÂM VẬN HÀNH', 'adm:operations', 'primary')], [btn('👑 ADMIN', 'adm:home', 'success')]]));
  }
  if (text.startsWith('/maintmsg ') && isAdmin(uid)) {
    const body = text.slice('/maintmsg '.length).trim().slice(0, 500);
    if (!body) return send(chatId, 'Nội dung không được để trống. Dùng <code>/maintmsg Bot đang bảo trì</code>.');
    settings.maintenanceMessage = body; saveSettings();
    return send(chatId, '✅ Đã cập nhật nội dung thông báo bảo trì.');
  }
  if (text.startsWith('/reactions') && isAdmin(uid)) {
    const mode = (text.split(/\s+/)[1] || 'status').toLowerCase();
    if (mode === 'on') settings.reactionsEnabled = true;
    else if (mode === 'off') settings.reactionsEnabled = false;
    else if (mode !== 'status') return send(chatId, 'Dùng <code>/reactions on</code> hoặc <code>/reactions off</code>.');
    saveSettings();
    return send(chatId, `🎭 Reaction tự động: <b>${settings.reactionsEnabled ? 'BẬT' : 'TẮT'}</b>.`);
  }
  if (text.startsWith('/setpoll ') && isAdmin(uid)) {
    const seconds = Number(text.split(/\s+/)[1]);
    if (!Number.isInteger(seconds) || seconds < 5 || seconds > 120) return send(chatId, 'Dùng <code>/setpoll 10</code>. Giá trị từ 5 đến 120 giây.');
    settings.pollMs = seconds * 1000; saveSettings();
    const interval = scheduleGamePolling();
    return send(chatId, `✅ Chu kỳ kiểm tra game đã đặt thành <b>${Math.round(interval / 1000)} giây</b>.`);
  }
  if (text.startsWith('/settitle ') && isAdmin(uid)) {
    const title = text.slice('/settitle '.length).trim().slice(0, 48);
    if (!title) return send(chatId, 'Dùng <code>/settitle TEN_BOT</code>.');
    settings.botTitle = title; saveSettings();
    return send(chatId, `✅ Tên hiển thị đã đổi thành <b>${esc(title)}</b>.`);
  }
  if (text.startsWith('/setwelcome ') && isAdmin(uid)) {
    const body = text.slice('/setwelcome '.length).trim().slice(0, 180);
    settings.welcomeText = body; saveSettings();
    return send(chatId, `✅ Đã cập nhật lời nhắc ở menu: <b>${esc(body || 'Chọn chức năng bạn cần')}</b>.`);
  }
  if (text === '/game list') {
    if (!isAdmin(uid)) return send(chatId, '⛔ Không có quyền admin.');
    return showAdminGames(chatId);
  }
  if (text.startsWith('/game ') && isAdmin(uid)) {
    const parts = text.split(/\s+/);
    const action = (parts[1] || '').toLowerCase(), id = parts[2];
    if (action === 'list') return showAdminGames(chatId);
    if (!['on', 'off'].includes(action) || !id) return send(chatId, 'Dùng <code>/game on ID</code>, <code>/game off ID</code> hoặc <code>/game list</code>.');
    const game = games.find(g => g.id === id);
    if (!game) return send(chatId, '⚠️ Không tìm thấy ID game. Dùng <code>/game list</code>.');
    game.enabled = action === 'on'; saveJSON('games.json', games);
    return send(chatId, `✅ ${esc(game.brandLabel)} ${esc(game.variant)} đã ${action === 'on' ? 'BẬT' : 'TẮT'}.`, kb([[btn('🎮 QUẢN LÝ GAME / API', 'adm:games', 'primary')]]));
  }
  if (text.startsWith('/gameurl ') && isAdmin(uid)) {
    const parts = text.split(/\s+/);
    const id = parts[1], rawUrl = parts[2];
    if (!id || !rawUrl) return send(chatId, 'Dùng <code>/gameurl ID https://domain/api</code>.');
    const game = games.find(g => g.id === id);
    if (!game) return send(chatId, '⚠️ Không tìm thấy ID game.');
    let parsed;
    try { parsed = new URL(rawUrl); } catch { return send(chatId, '⚠️ URL không hợp lệ.'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return send(chatId, '⚠️ Chỉ chấp nhận URL HTTPS hợp lệ.');
    game.url = parsed.toString(); saveJSON('games.json', games);
    const feed = FEEDS[id];
    if (feed) { feed.lastLive = null; feed.lastPred = null; }
    return send(chatId, `✅ Đã đổi API cho <b>${esc(game.brandLabel)} ${esc(game.variant)}</b>. Bot sẽ lấy dữ liệu ở chu kỳ kế tiếp.`);
  }
  if (text.startsWith('/removegroup ') && isAdmin(uid)) {
    const id = text.split(/\s+/)[1];
    if (!id) return send(chatId, 'Dùng <code>/removegroup ID</code>.');
    const before = (settings.groups || []).length;
    settings.groups = (settings.groups || []).filter(g => String(g.id) !== String(id));
    saveSettings();
    return send(chatId, `✅ Đã xóa ${before - settings.groups.length} nhóm bắt buộc.`);
  }
  if (text === '/groups' && isAdmin(uid)) {
    const list = settings.groups || [];
    return send(chatId, `📢 <b>NHÓM BẮT BUỘC</b>\n\n${list.length ? list.map(g => `• <code>${esc(g.id)}</code> | ${esc(g.title || 'Group')} | ${esc(g.link || '')}`).join('\n') : 'Chưa cài nhóm nào.'}\n\nThêm: <code>/addgroup ID|TEN|LINK</code>\nXóa: <code>/removegroup ID</code>`, kb([[btn('⚙️ CÀI ĐẶT CHUNG', 'adm:settings', 'primary')]]));
  }

  if (text === '/setfile' && isAdmin(uid)) {
    sessions[uid] = { await: 'admin_file' };
    return send(chatId, '📤 <b>GỬI FILE SẢN PHẨM</b>\n\nHãy gửi một tài liệu (Document) ngay trong chat này. File mới sẽ thay file đang bán trong KHO FILE.');
  }
  if (text.startsWith('/setfileprice ') && isAdmin(uid)) {
    const price = Number(text.split(/\s+/)[1]);
    if (!Number.isSafeInteger(price) || price < 1000 || price > 100000000) return send(chatId, '⚠️ Dùng: <code>/setfileprice 10000</code> (từ 1.000đ đến 100.000.000đ).');
    STORE_PRICE = price; settings.storePrice = price; saveSettings();
    return send(chatId, `✅ Đã đặt giá kho file: <b>${fmt(STORE_PRICE)}đ</b>.`);
  }
  if (text.startsWith('/setfilememo ') && isAdmin(uid)) {
    const prefix = memoToken(text.slice('/setfilememo '.length), 12);
    if (!prefix) return send(chatId, '⚠️ Vui lòng nhập tiền tố. Ví dụ <code>/setfilememo M</code>');
    STORE_TRANSFER_PREFIX = prefix; settings.storeTransferPrefix = prefix; saveSettings();
    return send(chatId, `✅ Mã đầu đơn FILE: <code>${esc(prefix)}</code>. Mỗi đơn dùng dạng <code>${esc(memoToken(prefix, 1) || 'M')}-XXXXXX</code>; thời gian được lưu trong đơn.`);
  }
  if (text.startsWith('/setkeyprefix ') && isAdmin(uid)) {
    const prefix = memoToken(text.slice('/setkeyprefix '.length), 12);
    if (!prefix) return send(chatId, '⚠️ Vui lòng nhập tiền tố. Ví dụ <code>/setkeyprefix N</code>');
    KEY_TRANSFER_PREFIX = prefix; settings.keyTransferPrefix = prefix; saveSettings();
    return send(chatId, `✅ Mã đầu đơn KEY: <code>${esc(prefix)}</code>. Mỗi đơn dùng dạng <code>${esc(memoToken(prefix, 1) || 'N')}-XXXXXX</code>; username/ID được lưu riêng trong đơn.`);
  }
  if (text.startsWith('/setproduct ') && isAdmin(uid)) {
    const name = text.slice('/setproduct '.length).trim().slice(0, 80);
    if (!name) return send(chatId, '⚠️ Dùng: <code>/setproduct Tên sản phẩm</code>');
    STORE_PRODUCT_NAME = name; settings.storeProductName = name; saveSettings();
    return send(chatId, `✅ Tên sản phẩm: <b>${esc(name)}</b>`);
  }
  if (text.startsWith('/setbank ') && isAdmin(uid)) {
    const parts = text.slice('/setbank '.length).split('|').map(x => x.trim());
    if (parts.length < 3 || !/^\d{6}$/.test(parts[0]) || !/^\d{6,20}$/.test(parts[1]) || !parts[2]) return send(chatId, '⚠️ Dùng: <code>/setbank BIN|SO_TAI_KHOAN|CHU_TAI_KHOAN</code>');
    BANK = { ...BANK, bin: parts[0], account: parts[1], name: parts.slice(2).join('|').slice(0, 80) };
    settings.bank = BANK; saveSettings();
    return send(chatId, `✅ Đã cập nhật tài khoản nhận tiền.\n🏦 BIN: <code>${BANK.bin}</code>\n💳 STK: <code>${BANK.account}</code>\n👤 Chủ TK: <b>${esc(BANK.name)}</b>`);
  }
  if (text.startsWith('/fbchannel ' ) && isAdmin(uid)) {
    const parts = text.split(/\s+/);
    const action = (parts[1] || '').toLowerCase();
    const target = parts[2];
    settings.feedbackChannels = settings.feedbackChannels || [];
    if (action === 'add' && target) {
      if (!/^-?\d+$/.test(target)) return send(chatId, '⚠️ Chat ID phải là số. Dùng <code>/fbchannel add -100...</code>');
      if (!settings.feedbackChannels.map(String).includes(String(target))) settings.feedbackChannels.push(String(target));
      saveSettings();
      const test = await send(target, '✅ Bot đã kết nối kênh feedback này.');
      if (!test || !test.ok) return send(chatId, `⚠️ Đã lưu ID nhưng bot chưa gửi thử được: ${esc(test && test.description || 'Không rõ lỗi')}. Hãy kiểm tra bot đã tham gia và có quyền đăng bài.`);
      return send(chatId, `✅ Đã thêm kênh nhận feedback <code>${esc(target)}</code>.`);
    }
    if (action === 'remove' && target) {
      settings.feedbackChannels = settings.feedbackChannels.filter(x => String(x) !== String(target)); saveSettings();
      return send(chatId, `✅ Đã xoá kênh <code>${esc(target)}</code>.`);
    }
    return send(chatId, '⚠️ Dùng <code>/fbchannel add ID</code> hoặc <code>/fbchannel remove ID</code>. Có thể dùng <code>/fbchannel add_here</code> trong nhóm.');
  }
  if (text === '/fbchannels' && isAdmin(uid)) return showFeedbackChannels(chatId);
  if (text === '/orders' && isAdmin(uid)) return showPendingFileOrders(chatId);
  if (text === '/stop') {
    stopAuto(uid);
    return send(chatId, '⏹ <b>Đã dừng tất cả hoạt động.</b>');
  }
  if (text.startsWith('/grant ') && isAdmin(uid)) {
    const parts = text.split(/\s+/);
    if (parts.length >= 3) {
      const targetUid = parts[1], hours = Number(parts[2]);
      if (hours > 0) {
        const created = createKeyForUser(targetUid, hours);
        send(chatId, `✅ Đã cấp <b>${hours}h</b> cho <code>${targetUid}</code>\nKEY: <code>${created.key}</code>`);
        try { send(targetUid, `🎉 <b>BẠN ĐÃ MỞ KHOÁ VIP THÀNH CÔNG</b>\n🔑 KEY: <code>${created.key}</code>\n${vipText(targetUid).expire}\nMỞ TOOL CHIẾN NGAY THÔI!`); } catch (e) {}
      }
    } else send(chatId, '⚠️ <code>/grant ID Số_Giờ</code>');
    return;
  }
  if (text.startsWith('/revoke ') && isAdmin(uid)) {
    const targetUid = text.split(/\s+/)[1];
    if (targetUid) {
      revokeVip(targetUid);
      send(chatId, `🔒 Đã thu hồi <code>${targetUid}</code>`);
      try { send(targetUid, '🔒 Quyền sử dụng Tool TX BY FEE đã bị thu hồi.'); } catch (e) {}
    } else send(chatId, '⚠️ <code>/revoke ID</code>');
    return;
  }
  if (text.startsWith('/user ') && isAdmin(uid)) {
    const targetUid = text.split(/\s+/)[1];
    if (targetUid) {
      const u = ensureUser(targetUid);
      const v = vipText(targetUid);
      const last = u.lastActive ? new Date(u.lastActive).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : 'Chưa có';
      send(chatId, `👤 <b>USER <code>${targetUid}</code></b>\n🔗 @${esc(u.username || 'Chưa có')}\n📛 ${esc(u.name || 'Chưa có')}\n${v.line}\n${v.expire}\n🔑 Key: <code>${u.key || 'Chưa có'}</code>\n📊 Pred: <b>${u.predCount || 0}</b>\n🕐 Active: ${last}`);
    } else send(chatId, '⚠️ <code>/user ID</code>');
    return;
  }
  if (text.startsWith('/genkey ') && isAdmin(uid)) {
    const hours = Number(text.split(/\s+/)[1] || 24);
    const key = genKey();
    keysDB[key] = { uid: null, until: Date.now() + hours * 3600 * 1000, created: Date.now(), hours };
    saveKeys();
    return send(chatId, `🔑 KEY (${hours}h):\n<code>${key}</code>`);
  }
  if (text.startsWith('/mkcode ') && isAdmin(uid)) {
    const parts = text.split(/\s+/);
    if (parts.length >= 3) {
      const code = parts[1].toUpperCase();
      codesDB[code] = { hours: Number(parts[2]), maxUses: Number(parts[3] || 1), used: 0, active: true };
      saveCodes();
      return send(chatId, `✅ Code <code>${code}</code>`);
    }
    return send(chatId, '⚠️ <code>/mkcode CODE Giờ [max]</code>');
  }
  if (text.startsWith('/setsupport ') && isAdmin(uid)) {
    settings.support = text.split(/\s+/)[1].replace('@', '');
    saveSettings();
    return send(chatId, '✅ Support @' + settings.support);
  }
  if (text.startsWith('/setbankgroup ') && isAdmin(uid)) {
    settings.bankGroupId = text.split(/\s+/)[1];
    saveSettings();
    return send(chatId, '✅ Nhóm biến động số dư đã đặt: <code>' + esc(settings.bankGroupId) + '</code>');
  }

  if (text.startsWith('/setbanksenders') && isAdmin(uid)) {
    const value = text.slice('/setbanksenders'.length).trim();
    if (!value) {
      const current = settings.bankSenderIds.length ? settings.bankSenderIds.join(', ') : 'Chưa whitelist bot ngân hàng; chỉ tin admin đã cấu hình được tin cậy';
      return send(chatId, `🛡️ <b>NGUỒN THÔNG BÁO NGÂN HÀNG ĐƯỢC TIN CẬY</b>\n${esc(current)}\n\nDùng <code>/setbanksenders ID1,ID2</code> để đặt danh sách cho phép.\nDùng <code>/setbanksenders clear</code> để quay về chế độ mặc định.`);
    }
    if (value.toLowerCase() === 'clear') {
      settings.bankSenderIds = []; saveSettings();
      return send(chatId, '✅ Đã xóa danh sách riêng. Bot chỉ tự tin cậy admin; bot ngân hàng cần được whitelist bằng ID.');
    }
    const ids = value.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
    if (!ids.length || ids.some(x => !/^-?\d+$/.test(x))) return send(chatId, '⚠️ ID phải là số. Ví dụ: <code>/setbanksenders 123456789</code>');
    settings.bankSenderIds = [...new Set(ids)]; saveSettings();
    return send(chatId, `✅ Đã cập nhật nguồn ngân hàng tin cậy: <code>${esc(settings.bankSenderIds.join(', '))}</code>`);
  }
  if (text.startsWith('/addgroup ') && isAdmin(uid)) {
    const body = text.slice(10);
    const parts = body.split('|').map(s => s.trim());
    if (parts.length < 3) return send(chatId, '⚠️ <code>/addgroup ID|TITLE|LINK</code>');
    if (!/^-?\d+$/.test(parts[0])) return send(chatId, '⚠️ Chat ID phải là số.');
    let groupUrl;
    try { groupUrl = new URL(parts[2]); } catch { return send(chatId, '⚠️ Link nhóm không hợp lệ.'); }
    if (!['https:', 'http:'].includes(groupUrl.protocol)) return send(chatId, '⚠️ Link nhóm phải là HTTP hoặc HTTPS.');
    settings.groups = settings.groups || [];
    settings.groups = settings.groups.filter(g => String(g.id) !== String(parts[0]));
    settings.groups.push({ id: parts[0], title: parts[1].slice(0, 60), link: groupUrl.toString() });
    saveSettings();
    return send(chatId, `✅ Đã lưu nhóm bắt buộc: <b>${esc(parts[1])}</b> (<code>${esc(parts[0])}</code>).`);
  }
  if (text === '/cleargroups' && isAdmin(uid)) {
    settings.groups = []; saveSettings();
    return send(chatId, '✅ Cleared groups');
  }
  if (text.startsWith('/broadcast ') && isAdmin(uid)) {
    const body = text.slice(11);
    let ok = 0;
    for (const id of Object.keys(users)) {
      try { await send(id, '📢 <b>THÔNG BÁO</b>\n\n' + body); ok++; } catch (e) {}
    }
    return send(chatId, '✅ Sent to ' + ok);
  }
  if (text.startsWith('/setprice ') && isAdmin(uid)) {
    const parts = text.split(/\s+/);
    if (parts.length >= 5) {
      const row = { id: parts[1], amount: Number(parts[2]), hours: Number(parts[3]), label: parts.slice(4).join(' ').slice(0, 60) };
      if (!/^[a-zA-Z0-9_-]{1,20}$/.test(row.id) || !Number.isSafeInteger(row.amount) || row.amount < 1000 || row.amount > 100000000 || !Number.isFinite(row.hours) || row.hours <= 0 || row.hours > 8760 || !row.label) return send(chatId, '⚠️ ID không hợp lệ, số tiền 1.000đ đến 100.000.000đ, thời hạn từ 1 đến 8.760 giờ.');
      settings.packages = settings.packages || [];
      const i = settings.packages.findIndex(x => x.id === row.id);
      if (i >= 0) settings.packages[i] = row; else settings.packages.push(row);
      saveSettings();
      return send(chatId, '✅ Price updated');
    }
    return send(chatId, '⚠️ <code>/setprice ID amount hours label</code>');
  }

  const st = sessions[uid];
  if (st) {
    
    if (st.await === 'key_input') {
      const r = activateKey(uid, text);
      delete sessions[uid];
      if (!r.ok) return send(chatId, '❌ ' + r.msg, kb([[btn('🔑 THỬ LẠI', 'key:input', 'success'), btn('◀️ MENU', 'menu', 'danger')]]));
      const expireText = new Date(r.until).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      return send(chatId, `🎉 <b>BẠN ĐÃ MỞ KHOÁ VIP THÀNH CÔNG</b>\n⏳ Thời hạn đến: <b>${expireText} (GMT+7)</b>\nMỞ TOOL CHIẾN NGAY THÔI!`, kb([
        [btn('🎮 CHỌN GAME', 'pred:brands', 'primary')],
        [btn('🏠 MENU', 'menu', 'success')]
      ]));
    }
    if (st.await === 'code_input') {
      const code = text.trim().toUpperCase();
      const c = codesDB[code];
      delete sessions[uid];
      if (!c || !c.active) return send(chatId, '❌ Code không hợp lệ.', kb([[btn('◀️ MENU', 'menu', 'danger')]]));
      if (c.used >= c.maxUses) return send(chatId, '❌ Code đã hết lượt.', kb([[btn('◀️ MENU', 'menu', 'danger')]]));
      c.used++;
      saveCodes();
      const created = createKeyForUser(uid, c.hours);
      const expireText = new Date(created.until).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      return send(chatId, `🎉 <b>CODE ĐÃ KÍCH HOẠT</b>\n🔑 KEY: <code>${created.key}</code>\n⏳ Hạn sử dụng: <b>${expireText} (GMT+7)</b>`, kb([
        [btn('🚀 VÀO TOOL', 'pred:brands', 'primary')],
        [btn('🏠 MENU', 'menu', 'success')]
      ]));
    }
    if (st.await === 'fb_note') {
      st.fb = st.fb || {};
      st.fb.note = text;
      st.await = null;
      return send(chatId, '⭐ <b>FEEDBACK • Bước 3</b>\n\nChọn số sao:', kb([
        [btn('⭐ 1', 'fb:star:1', 'danger'), btn('⭐ 2', 'fb:star:2', 'danger'), btn('⭐ 3', 'fb:star:3', 'primary')],
        [btn('⭐ 4', 'fb:star:4', 'success'), btn('⭐ 5', 'fb:star:5', 'success')],
        [btn('◀️ QUAY LẠI', 'menu', 'primary')]
      ]));
    }
    if (st.await === 'fb_photo') {
      // if user sent photo
      if (msg.photo && msg.photo.length) {
        st.fb = st.fb || {};
        st.fb.photo = msg.photo[msg.photo.length - 1].file_id;
        st.await = 'fb_note';
        return send(chatId, '⭐ <b>FEEDBACK • Bước 2</b>\n\nNote nội dung vào đây:', kb([
          [btn('⏭ SKIP', 'fb:skipnote', 'primary')],
          [btn('◀️ QUAY LẠI', 'menu', 'primary')]
        ]));
      }
      return send(chatId, 'Gửi ảnh hoặc bấm SKIP.', kb([[btn('⏭ SKIP', 'fb:skipphoto', 'primary')]]));
    }
    
    if (st.await === 'hash_input') {
      const hashStr = text.toLowerCase();
      if (!/^[a-f0-9]{32}$/.test(hashStr) && !/^[a-f0-9]{64}$/.test(hashStr)) {
        return send(chatId, '⚠️ <b>ĐỊNH DẠNG HASH CHƯA ĐÚNG</b>\nVui lòng gửi mã MD5 gồm 32 ký tự hoặc SHA-256 gồm 64 ký tự hệ 16.');
      }
      const type = hashStr.length === 32 ? 'MD5' : 'SHA256';
      const pred = predictHash(hashStr);
      const sideTxt = pred.side === 'T' ? 'TÀI' : 'XỈU';
      const sideIcon = pred.side === 'T' ? '🔴' : '🔵';
      const filled = Math.max(0, Math.min(10, Math.round((pred.conf || 50) / 10)));
      const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
      const modelLine = pred.model === 'learned' ? `🧠 Mẫu đã kiểm định: <b>${pred.samples}</b> • Balanced accuracy: <b>${pred.validationAccuracy.toFixed(1)}%</b> • Brier: <b>${Number(pred.validationBrier || 0).toFixed(3)}</b>` : '🧪 Chế độ an toàn • Chưa vượt ngưỡng kiểm định ngoài mẫu';
      const sent = await send(chatId, `╭━━━━━━━━━━━━━━━━━━╮\n       🧩 <b>TOOL MD5/SHA256</b>\n╰━━━━━━━━━━━━━━━━━━╯\n\n🔐 <b>Loại mã:</b> ${type} • ${hashStr.length} ký tự\n🔑 <code>${esc(hashStr)}</code>\n\n🎯 <b>TÍN HIỆU THAM KHẢO</b>\n${sideIcon} <b>${sideTxt}</b>\n📊 Mức nghiêng thống kê: <b>${pred.conf}%</b>\n<code>${bar}</code>\n${modelLine}\n\n💡 ${esc(pred.reason)}\n\n👇 <i>Chỉ gửi phản hồi sau khi đã có kết quả thực tế để đối chiếu.</i>`,
      kb([[btn('✅ ĐÚNG • THỰC TẾ TRÙNG', 'hash:ok', 'success'), btn('❌ SAI • NHẬP KẾT QUẢ THẬT', 'hash:bad', 'danger')], [btn('🏠 THOÁT', 'menu', 'danger')]]));
      if (sent && sent.ok && sent.result && sent.result.message_id) {
        const predictionKey = `${chatId}:${sent.result.message_id}`;
        hashPredictions[predictionKey] = {
          uid: String(uid), hash: hashStr, type, side: pred.side,
          conf: pred.conf, model: pred.model || 'neutral', samples: pred.samples || 0,
          validationAccuracy: pred.validationAccuracy, createdAt: Date.now()
        };
        const entries = Object.entries(hashPredictions);
        if (entries.length > 500) {
          entries.sort((a, b) => Number(a[1].createdAt || 0) - Number(b[1].createdAt || 0));
          for (const [key] of entries.slice(0, entries.length - 500)) delete hashPredictions[key];
        }
        saveHashPredictions();
      }
      return sent;
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
app.use(express.json({ limit: '2mb' }));

// The dashboard shell is public, but all live data endpoints require the INDEX_PASSWORD session.
const INDEX_PASSWORD = String(process.env.INDEX_PASSWORD || '');
const INDEX_COOKIE = 'byfee_index';
const loginAttempts = new Map();
function signIndexToken(exp) {
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', INDEX_PASSWORD).update(payload).digest('base64url');
  return payload + '.' + sig;
}
function validIndexToken(req) {
  if (!INDEX_PASSWORD) return false;
  const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map(v => v.trim()).filter(Boolean).map(v => { const i = v.indexOf('='); return [v.slice(0, i), v.slice(i + 1)]; }));
  const token = cookies[INDEX_COOKIE] || '';
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = crypto.createHmac('sha256', INDEX_PASSWORD).update(payload).digest('base64url');
  const a = Buffer.from(signature), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try { const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); return Number(data.exp) > Date.now(); } catch { return false; }
}
function requireIndexAuth(req, res, next) {
  if (validIndexToken(req)) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/api/auth/status', (req, res) => res.json({ configured: Boolean(INDEX_PASSWORD), authenticated: validIndexToken(req) }));
app.post('/api/login', (req, res) => {
  if (!INDEX_PASSWORD) return res.status(503).json({ ok: false, error: 'INDEX_PASSWORD_NOT_SET' });
  const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
  const state = loginAttempts.get(ip) || { count: 0, until: 0 };
  if (state.until > Date.now() && state.count >= 8) return res.status(429).json({ ok: false, error: 'TOO_MANY_ATTEMPTS' });
  const supplied = Buffer.from(String(req.body && req.body.password || ''));
  const expected = Buffer.from(INDEX_PASSWORD);
  const ok = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  if (!ok) {
    state.count = state.until > Date.now() ? state.count + 1 : 1;
    state.until = Date.now() + 10 * 60 * 1000; loginAttempts.set(ip, state);
    return res.status(401).json({ ok: false, error: 'WRONG_PASSWORD' });
  }
  loginAttempts.delete(ip);
  const token = signIndexToken(Date.now() + 12 * 60 * 60 * 1000);
  const secure = req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https');
  res.setHeader('Set-Cookie', `${INDEX_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${secure ? '; Secure' : ''}`);
  return res.json({ ok: true });
});
app.post('/api/logout', (_req, res) => { res.setHeader('Set-Cookie', `${INDEX_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`); res.json({ ok: true }); });

app.get('/api/games', requireIndexAuth, (_req, res) => {
  const list = games.map(g => {
    const f = FEEDS[g.id], p = f.lastPred || {};
    return {
      id: g.id, name: `${g.brandLabel} · ${g.variant}`, group: g.group,
      pred: p.side ? (p.side === 'T' ? 'TÀI' : 'XỈU') : 'Đang lấy...',
      updatedAt: f.lastLive ? nowVN() : 'Chưa có dữ liệu'
    };
  });
  res.json({ games: list });
});

app.post('/api/data', requireIndexAuth, (req, res) => {
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
  const p = feed.lastPred || {};
  res.json({
    rows,
    current: {
      prediction: p.side === 'T' ? 'TÀI' : p.side === 'X' ? 'XỈU' : 'ĐANG LẤY DỮ LIỆU',
      previousRound: getPreviousRoundSummary(feed.lastLive),
      session: feed.lastLive ? String(Number(feed.lastLive.session) + 1) : 'Chưa có',
      updatedAt: nowVN()
    }
  });
});

app.get('/health', (_, res) => res.json({ ok: true, bot: 'TOOL TX BY FEE v16.8.4 COMPACT SICBO CARD UPDATES', games: games.length, indexPasswordConfigured: Boolean(INDEX_PASSWORD), bankGroupId: String(settings.bankGroupId || '') }));

app.listen(PORT, '0.0.0.0', () => {
  console.log('🔥 TOOL TX BY FEE running on port', PORT, '| data:', DATA, '| index password:', Boolean(INDEX_PASSWORD));
});

/* ═══════════════ TELEGRAM POLLING ═══════════════ */
let offset = 0;
async function loop() {
  if (!BOT_TOKEN) return;
  try {
    const j = await tg('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
    if (j && j.ok === false) {
      console.error('[TELEGRAM POLLING]', j.description || 'getUpdates failed');
      if (/webhook|409/i.test(String(j.description || ''))) {
        console.error('[TELEGRAM POLLING] Bot đang có webhook. Hãy gỡ webhook cũ trước khi dùng long polling: https://api.telegram.org/bot<TOKEN>/deleteWebhook?drop_pending_updates=false');
        await new Promise(r => setTimeout(r, 10000));
      }
    }
    if (j && j.result) {
      for (const u of j.result) {
        offset = u.update_id + 1;
        try {
          if (u.callback_query) await onCallback(u.callback_query);
          else if (u.message) await onMessage(u.message);
        } catch (e) { console.error('[TELEGRAM UPDATE]', e); }
      }
    }
  } catch (e) {
    console.error('[TELEGRAM POLLING ERROR]', e.message || e);
    await new Promise(r => setTimeout(r, 2000));
  }
  setImmediate(loop);
}
loop();