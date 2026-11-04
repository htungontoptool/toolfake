const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const source = fs.readFileSync(__dirname + '/server.js', 'utf8');

function extract(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error('Cannot extract: ' + start);
  return source.slice(a, b);
}

const sampleSumsCode = extract('function sampleWeightedSums(rows, count = 3, randomFn = Math.random) {', '\n\n/* ═══════════════ SICBO ANALYZER');
const sicboCode = source.slice(source.indexOf('class SicboAnalyzer {'), source.indexOf('\n}\n\n/* ═══════════════ ENGINE') + 2);
const engineStart = source.indexOf('class Engine {');
const engineEnd = source.indexOf('\n}\n\n/* ═══════════════ FEEDS', engineStart);
if (engineStart < 0 || engineEnd < 0) throw new Error('Cannot extract Engine');
const engineCode = source.slice(engineStart, engineEnd + 2);
const hashCode = extract('function hashFeatures(hashStr) {', '\n\n/* ═══════════════ EXPORT HISTORY');
const memoCode = extract('function memoToken(value, max = 12) {', '\n\n// Download the VietQR PNG');
const recordCode = extract('function recordHashOutcome(row) {', '\n\nfunction saveUsers()');
const paymentCode = extract('function tryMatchPayment(text) {', '\n\nasync function notifyPaymentReview');
const sessionCode = source.slice(source.indexOf('function compareSessionIds(a, b) {'), source.indexOf('\nasync function fetchJson') );
const parserCode = source.slice(source.indexOf('function parseHistoryArray(json) {'), source.indexOf('\nfunction compareSessionIds') - 1);

const gameListCodeStart = source.indexOf('const DEFAULT_GAMES = [');
const gameListCodeEnd = source.indexOf('];', gameListCodeStart) + 2;
if (gameListCodeStart < 0 || gameListCodeEnd < 2) throw new Error('Cannot locate default game list');
const gameListCode = source.slice(gameListCodeStart, gameListCodeEnd) + '\nthis.DEFAULT_GAMES = DEFAULT_GAMES;';

const context = {
  Buffer, crypto, Date, Math, Map, Set, Array, Number, String, Object, JSON,
  hashFeedbacks: [], hashTrainingRevision: 0, hashModelCache: {},
  STORE_TRANSFER_PREFIX: 'MUAFILE', KEY_TRANSFER_PREFIX: 'NAPASS', orders: {},
  nowVN: () => 'test-time',
  saveHashFeedbacks() { this.saved = true; }
};
vm.createContext(context);
vm.runInContext(gameListCode, context);
vm.runInContext(sampleSumsCode + '\n' + sicboCode + '\nthis.SicboAnalyzer = SicboAnalyzer; this.sampleWeightedSums = sampleWeightedSums;', context);
vm.runInContext(engineCode + '\nthis.Engine = Engine;', context);
vm.runInContext(hashCode + '\nthis.predictHash = predictHash; this.hashFeatures = hashFeatures; this.fitHashLogistic = fitHashLogistic;', context);
vm.runInContext(memoCode + '\nthis.createPaymentMemo = createPaymentMemo;', context);
vm.runInContext(recordCode + '\nthis.recordHashOutcome = recordHashOutcome;', context);
vm.runInContext(paymentCode + '\nthis.tryMatchPayment = tryMatchPayment; this.transferMemoIncluded = transferMemoIncluded; this.normalizeTransferText = normalizeTransferText;', context);
vm.runInContext(sessionCode + '\nthis.appendNewGameResults = appendNewGameResults; this.compareSessionIds = compareSessionIds;', context);
vm.runInContext(parserCode + '\nthis.parseHistoryArray = parseHistoryArray;', context);

// Every configured game receives its own adaptive engine and rolling model score.
const allGameIds = context.DEFAULT_GAMES.map(g => g.id);
if (allGameIds.length < 15) throw new Error('Default game registry is unexpectedly incomplete');
for (const id of allGameIds) {
  const engine = new context.Engine(id);
  for (let i = 0; i < 160; i++) {
    const side = i % 3 === 0 ? 'T' : 'X';
    const dice = [1 + (i % 6), 1 + ((i * 3) % 6), 1 + ((i * 5) % 6)].sort((a, b) => a - b);
    engine.push(side, dice.reduce((a, b) => a + b, 0), id.startsWith('sicbo_') ? dice : [], String(1000 + i));
    engine.predict();
  }
  const p = engine.predict();
  if (!['T', 'X'].includes(p.side)) throw new Error('Missing side output for ' + id);
  if (!Number.isFinite(p.probability) || p.probability < 0.38 || p.probability > 0.62) throw new Error('Uncalibrated probability boundary for ' + id);
  if (p.conf < 50 || p.conf > 62) throw new Error('Confidence outside conservative range for ' + id);
  if (!p.qualityLabel || !p.modelVersion) throw new Error('Missing model metadata for ' + id);
  if (!Object.hasOwn(p.modelProbabilities, 'transition')) throw new Error('Missing adaptive transition model for ' + id);
  if (!engine.modelLosses.transition) throw new Error('Missing transition validation bucket for ' + id);
  if (!engine.modelLosses.reversal || !Object.hasOwn(p.modelProbabilities, 'reversal')) throw new Error('Missing reversal/anti-streak model for ' + id);
}
const isolatedA = new context.Engine('sunwin_tx');
const isolatedB = new context.Engine('hitclub_tx');
if (isolatedA.modelLosses.transition === isolatedB.modelLosses.transition) throw new Error('Game model scores must be isolated per game');

// Reversal model must identify historical runs of the current length, not only one-item runs.
const reversalEngine = new context.Engine('reversal_test');
reversalEngine.history = ['T','T','T','X','X','T','T','T','X','T','T','T'];
const reversal = reversalEngine._reversalProbability('T', 3, 0.5);
if (reversal.count !== 2 || reversal.oppositeCount !== 2 || reversal.observedOppositeRate !== 1) throw new Error('Reversal model failed to learn same-length streak reversals');

// Sicbo: 3 side-conditioned totals, normalized probabilities, and triple exclusion.
const fair = new context.SicboAnalyzer().predict();
for (const [side, min, max] of [['T', 11, 17], ['X', 4, 10]]) {
  const picks = fair.topSumsBySide[side];
  if (!Array.isArray(picks) || picks.length !== 3) throw new Error('Missing Sicbo top-three totals for ' + side);
  if (!picks.every(x => x.sum >= min && x.sum <= max && Number.isFinite(x.percent))) throw new Error('Sicbo total outside the selected side');
  const sumPct = picks.reduce((sum, x) => sum + x.percent, 0);
  if (sumPct <= 0 || sumPct > 100) throw new Error('Invalid Sicbo conditional percentage');
}
const sicboEngine = new context.Engine('sicbo_sunwin');
for (let i = 0; i < 45; i++) {
  const dice = [1 + (i % 6), 1 + ((i + 2) % 6), 1 + ((i + 4) % 6)].sort((a, b) => a - b);
  sicboEngine.push((dice.reduce((a, b) => a + b, 0) >= 11 ? 'T' : 'X'), dice.reduce((a, b) => a + b, 0), dice, String(i));
}
sicboEngine.predict();
const beforeTripleTotal = sicboEngine.total;
const beforeTripleHistory = sicboEngine.history.length;
sicboEngine.push('X', 3, [1, 1, 1], 'triple-1');
if (sicboEngine.total !== beforeTripleTotal || sicboEngine.history.length !== beforeTripleHistory) throw new Error('Sicbo triple incorrectly scored as Big/Small');

// Sicbo weighted sample returns three distinct totals inside the selected side.
for (const [side, min, max] of [['T', 11, 17], ['X', 4, 10]]) {
  const picks = fair.topSumsBySide[side];
  if (new Set(picks.map(x => x.sum)).size !== 3) throw new Error('Sicbo weighted sample must not repeat totals');
  if (!picks.every(x => x.sum >= min && x.sum <= max && x.percent > 0)) throw new Error('Sicbo weighted sample outside selected side');
}

// Bank parser accepts the exact TPBank VietQR messages visible in the uploaded screenshot.
const bankSamples = [
  '+2.000 VND | TK: TPBank - 24032506210 | 03/11/2026 18:04:51 | 30394656767 | ND: HOANG THANH TUNG chuyen tien FT26307265626089',
  '+2.500 VND | TK: TPBank - 24032506210 | 03/11/2026 20:19:42 | 30397889817 | ND: Napas8064707600',
  '+2.500 VND | TK: TPBank - 24032506210 | 03/11/2026 22:33:10 | 30402390489 | ND: ZPBV7DF33SENV5\nNapas8669996135',
  '+2.500 VND | TK: TPBank - 24032506210 | 04/11/2026 14:02:36 | 30413010246 | ND: NB11A08 FT26308564779251'
];
const parsedBank = bankSamples.map(x => context.tryMatchPayment(x));
if (parsedBank[0].amount !== 2000 || parsedBank[1].amount !== 2500 || parsedBank[2].amount !== 2500 || parsedBank[3].amount !== 2500) throw new Error('TPBank amount parsing failed');
if (parsedBank[2].ref !== '30402390489' || !parsedBank[2].nd.includes('Napas8669996135')) throw new Error('TPBank transaction reference / wrapped ND parsing failed');
if (context.transferMemoIncluded(parsedBank[1].raw, 'N-ABC123') || context.transferMemoIncluded(parsedBank[2].raw, 'N-ABC123')) throw new Error('Bank parser must not invent a missing short order memo');
const memoPayment = context.tryMatchPayment('+10.000 VND | TK: TPBank | 04/11/2026 14:02:36 | 30413010246 | ND: hoang N-ABC123 Napas8669996135');
if (memoPayment.amount !== 10000 || !context.transferMemoIncluded(memoPayment.raw, 'N-ABC123')) throw new Error('Short payment memo extraction/matching failed');

// Source integrity checks for the formerly undefined menu and auto handlers, and non-destructive callback handling.
for (const name of ['showBrandMenu','showTables','startAuto','stopAuto','pushPredCard']) {
  if (!new RegExp('function\\s+' + name + '\\s*\\(').test(source)) throw new Error('Missing Telegram handler: ' + name);
}
const callbackSource = extract('async function onCallback(cq) {', '\nasync function onMessage(msg) {');
if (callbackSource.includes('await delMsg(chatId, msgId)') || !callbackSource.includes('clearInlineKeyboard(chatId, msgId)')) throw new Error('Callback should keep the old message and clear only its keyboard');
if (!source.includes("app.post('/api/login'") || !source.includes("app.post('/api/logout'") || !source.includes('requireIndexAuth')) throw new Error('Dashboard password gate is missing');
if (!source.includes("tg('setMessageReaction'")) throw new Error('Random reactions are not wired');
for (const feature of ['showAdminOperations','showAdminGames','showAdminSettings','showAdminPackages','showAdminUsers','showAdminBank','scheduleGamePolling']) {
  if (!new RegExp('function\\s+' + feature + '\\s*\\(').test(source)) throw new Error('Missing admin control: ' + feature);
}
for (const command of ['/maintenance on','/maintmsg ','/reactions on','/setpoll ','/gameurl ','/settitle ','/setwelcome ','/removegroup ']) {
  if (!source.includes(command)) throw new Error('Missing admin command: ' + command);
}
if (!source.includes('adm:game:toggle:') || !source.includes('settings.reactionsEnabled === false')) throw new Error('Admin game/reaction toggles are missing');
const reactionPoolMatch = source.match(/const REACTION_POOL = \[(.*?)\];/s);
const reactionCount = reactionPoolMatch ? (reactionPoolMatch[1].match(/'/g) || []).length / 2 : 0;
if (reactionCount < 70) throw new Error('Random reaction pool is unexpectedly small');

// Poll deduplication: full-history API responses must not replay old sessions.
const feed = { engine: new context.Engine('lc79_tx'), lastSession: null, seenSessions: new Set(), lastLive: null };
const history = Array.from({ length: 30 }, (_, i) => ({ session: String(200 + i), side: i % 2 ? 'T' : 'X', sum: i % 2 ? 12 : 9, dice: [] }));
if (context.appendNewGameResults(feed, history) !== 30) throw new Error('Initial history was not ingested');
if (context.appendNewGameResults(feed, history) !== 0) throw new Error('Duplicate history was replayed');
const next = history.concat([{ session: '230', side: 'T', sum: 12, dice: [] }]);
if (context.appendNewGameResults(feed, next) !== 1 || feed.lastSession !== '230') throw new Error('New session was not appended exactly once');

// Parser: accept clear T/X data; do not invent an Xiu result from an empty row.
const parsed = context.parseHistoryArray({ history: [
  { session: 1, result: 'TAI', total: 12 },
  { session: 2, result: 'XIU', total: 9 },
  { session: 3, result: '', total: 0 },
  { session: 4, result: '', dice: [4, 4, 4] }
] });
if (parsed.length !== 3 || parsed[0].side !== 'T' || parsed[1].side !== 'X') throw new Error('Game result parser created or lost an invalid result');

// QR: 8-character memo (N-/M- + six hex chars), unique per order, old memos remain matchable.
const keyMemo1 = context.createPaymentMemo('key', '123456', 'member');
const keyMemo2 = context.createPaymentMemo('key', '123456', 'member');
const fileMemo = context.createPaymentMemo('file', '123456', 'member');
if (!/^N-[A-F0-9]{6}$/.test(keyMemo1) || keyMemo1 === keyMemo2) throw new Error('KEY memo must be N- plus six random characters');
if (!/^M-[A-F0-9]{6}$/.test(fileMemo)) throw new Error('FILE memo must be M- plus six random characters');
if (!context.transferMemoIncluded('REF: 998877 | ND: napass ' + keyMemo1 + ' trailing', keyMemo1)) throw new Error('New KEY memo matching failed');
if (!context.transferMemoIncluded('ND: old order N0123456789AB', 'N0123456789AB')) throw new Error('Legacy memo matching failed');

// Hash: only sufficiently large, balanced, validated samples enable learned mode.
const hash = '0123456789abcdef0123456789abcdef';
const neutral = context.predictHash(hash);
if (neutral.conf !== 50 || neutral.model !== 'neutral') throw new Error('Hash without feedback must remain neutral');
const rows = [];
for (let i = 0; i < 480; i++) {
  const randomPart = crypto.createHash('sha256').update('sample-' + i).digest('hex');
  rows.push({ type: 'MD5', hash: (i % 2 ? 'f' : '0') + randomPart.slice(1, 32), actual: i % 2 ? 'T' : 'X', createdAt: i + 1 });
}
context.hashFeedbacks = rows;
context.hashTrainingRevision++;
const model = context.fitHashLogistic('MD5', rows);
if (!model || !model.ready || model.holdoutSamples < 60 || model.validationBrier >= 0.245) throw new Error('Hash holdout validation did not pass controlled signal test');
const duplicate = context.recordHashOutcome({ type: 'MD5', hash: rows[0].hash, actual: rows[0].actual, uid: '1' });
if (duplicate.reason !== 'duplicate') throw new Error('Duplicate hash feedback not detected');
const conflict = context.recordHashOutcome({ type: 'MD5', hash: rows[0].hash, actual: rows[0].actual === 'T' ? 'X' : 'T', uid: '2' });
if (conflict.reason !== 'conflict') throw new Error('Conflicting hash feedback not detected');

console.log(JSON.stringify({
  version: '16.8.2',
  engine: { allGameEnginesTested: allGameIds, transitionModel: true, isolatedPerGame: true, confidenceRange: [50, 62], duplicateSessionsIgnored: true, tripleVoided: true },
  sicbo: { topSumsT: fair.topSumsBySide.T.map(x => x.sum), topSumsX: fair.topSumsBySide.X.map(x => x.sum) },
  payment: { keyMemo: keyMemo1, fileMemo, length: keyMemo1.length, unique: keyMemo1 !== keyMemo2, legacyMemoMatch: true, screenshotFormatsParsed: parsedBank.length },
  telegram: { nonDestructiveBack: true, gameHandlersDefined: true, randomReactionPool: true, indexPasswordGate: true },
  hash: { modelReady: model.ready, samples: model.samples, holdout: model.holdoutSamples, balancedAccuracy: Number(model.validationAccuracy.toFixed(2)), brier: Number(model.validationBrier.toFixed(4)), duplicate: duplicate.reason, conflicting: conflict.reason }
}, null, 2));
