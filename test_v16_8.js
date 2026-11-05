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
const keyCode = extract('function genKey() {', '\nfunction createKeyForUser');
const uploadCode = extract('function extractStoreUpload(msg) {', '\nfunction validStorePrice');
const recordCode = extract('function recordHashOutcome(row) {', '\n\nfunction saveUsers()');
const paymentCode = extract('function parseVndAmount(raw) {', '\n\nasync function notifyPaymentReview');
const sessionCode = source.slice(source.indexOf('function compareSessionIds(a, b) {'), source.indexOf('\nasync function fetchJson') );
const parserCode = source.slice(source.indexOf('function parseHistoryArray(json) {'), source.indexOf('\nfunction compareSessionIds') - 1);
const previousRoundCode = source.slice(source.indexOf('function getPreviousRoundSummary(live) {'), source.indexOf('\nfunction appendNewGameResults', source.indexOf('function getPreviousRoundSummary(live) {')));
const reviewCode = extract('function getPreviousPredictionReview(engine, previous, isSicbo = false) {', '\nfunction renderPredictionCardText');
const cardRenderCode = extract('function renderPredictionCardText(g, feed) {', '\nasync function pushPredCard');


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
context.keysDB = {};
vm.runInContext(keyCode + '\nthis.genKey = genKey;', context);
vm.runInContext(uploadCode + '\nthis.extractStoreUpload = extractStoreUpload;', context);
vm.runInContext(recordCode + '\nthis.recordHashOutcome = recordHashOutcome;', context);
vm.runInContext(paymentCode + '\nthis.parseVndAmount = parseVndAmount; this.tryMatchPayment = tryMatchPayment; this.transferMemoIncluded = transferMemoIncluded; this.normalizeTransferText = normalizeTransferText;', context);
vm.runInContext(sessionCode + '\nthis.appendNewGameResults = appendNewGameResults; this.compareSessionIds = compareSessionIds;', context);
vm.runInContext(parserCode + '\nthis.parseHistoryArray = parseHistoryArray;', context);
vm.runInContext(previousRoundCode + '\nthis.getPreviousRoundSummary = getPreviousRoundSummary;', context);
vm.runInContext(reviewCode + '\nthis.getPreviousPredictionReview = getPreviousPredictionReview;', context);
const nextSessionCode = extract('function nextSessionLabel(lastSession) {', '\nfunction renderPredictionCardText');
vm.runInContext(cardRenderCode + '\nthis.renderPredictionCardText = renderPredictionCardText;', context);
context.esc = x => String(x);
vm.runInContext(nextSessionCode + '\nthis.nextSessionLabel = nextSessionLabel;', context);
if (context.nextSessionLabel('12345') !== '12346' || context.nextSessionLabel('round-A') !== 'Chờ phiên mới') throw new Error('Next session formatting failed');
const ewmaRegression = new context.Engine('ewma-regression');
const ewmaSinglePass = ewmaRegression._weightedRate(['T'], 0.1, 0.5);
if (Math.abs(ewmaSinglePass - 0.55) > 1e-9) throw new Error('EWMA must process each result exactly once');


// Compact previous-round summary must format real result, dice and triple outcomes.
const previousTai = context.getPreviousRoundSummary({ session: '12345', side: 'T', sum: 12, dice: [3, 4, 5] });
if (previousTai.session !== '12345' || previousTai.result !== 'TÀI' || !previousTai.dice.includes('Tổng 12')) throw new Error('Previous Tài round summary failed');
const previousTriple = context.getPreviousRoundSummary({ session: '12346', side: 'T', sum: 3, dice: [1, 1, 1] }, true);
if (previousTriple.result !== 'BỘ BA') throw new Error('Previous Sicbo triple must not be shown as Big/Small');
const normalTriple = context.getPreviousRoundSummary({ session: 'n1', side: 'X', sum: 6, dice: [2, 2, 2] }, false);
if (normalTriple.result !== 'XỈU') throw new Error('Non-Sicbo triple must use the game result side');
const missingPrevious = context.getPreviousRoundSummary(null);
if (missingPrevious.result !== 'Chưa có' || missingPrevious.diceValues.length !== 0) throw new Error('Missing previous round summary failed');
const priorEngine = { log: [{ session: '12345', ok: true }, { session: '12346', ok: false }] };
if (!context.getPreviousPredictionReview(priorEngine, previousTai, false).includes('ĐÚNG CỬA')) throw new Error('Previous correct-side label missing');
if (!context.getPreviousPredictionReview(priorEngine, { session: '12346', result: 'XỈU' }, false).includes('SAI CỬA')) throw new Error('Previous wrong-side label missing');
if (!context.getPreviousPredictionReview(priorEngine, previousTriple, true).includes('KHÔNG TÍNH')) throw new Error('Sicbo triple review must be void');
const cardMockFeed = { lastPred: { side: 'T', dicePrediction: { topSums: [11, 13, 16] } }, engine: priorEngine, lastLive: { session: '12345', side: 'T', sum: 12, dice: [3, 4, 5] } };
const cardText = context.renderPredictionCardText({ id: 'sicbo_sunwin', brandLabel: 'SUNWIN', variant: 'Sicbo' }, cardMockFeed).text;
if (!cardText.includes('🎲 3') || !cardText.includes('ĐÚNG CỬA') || !cardText.includes('BA TỔNG DỄ XUẤT HIỆN') || /⚀|⚁|⚂|⚃|⚄|⚅/.test(cardText)) throw new Error('Professional dice card content / status review failed');

// Every configured game receives its own adaptive engine and rolling model score.
const allGameIds = context.DEFAULT_GAMES.map(g => g.id);
if (allGameIds.length < 15) throw new Error('Default game registry is unexpectedly incomplete');
for (const id of allGameIds) {
  const engine = new context.Engine(id);
  for (let i = 0; i < 160; i++) {
    const side = i % 3 === 0 ? 'T' : 'X';
    const dice = [1 + (i % 6), 1 + ((i * 3) % 6), 1 + ((i * 5) % 6)].sort((a, b) => a - b);
    engine.push(side, dice.reduce((a, b) => a + b, 0), dice, String(1000 + i));
    engine.predict();
  }
  const p = engine.predict();
  if (!['T', 'X'].includes(p.side)) throw new Error('Missing side output for ' + id);
  if (!Number.isFinite(p.probability) || p.probability < 0.28 || p.probability > 0.72) throw new Error('Uncalibrated probability boundary for ' + id);
  if (p.conf < 50 || p.conf > 72) throw new Error('Confidence outside allowed range for ' + id);
  if (!p.qualityLabel || !p.modelVersion) throw new Error('Missing model metadata for ' + id);
  if (!Object.hasOwn(p.modelProbabilities, 'transition')) throw new Error('Missing adaptive transition model for ' + id);
  if (!engine.modelLosses.transition) throw new Error('Missing transition validation bucket for ' + id);
  if (!engine.modelLosses.reversal || !Object.hasOwn(p.modelProbabilities, 'reversal')) throw new Error('Missing reversal/anti-streak model for ' + id);
}
const isolatedA = new context.Engine('sunwin_tx');
const isolatedB = new context.Engine('hitclub_tx');
if (isolatedA.modelLosses.transition === isolatedB.modelLosses.transition) throw new Error('Game model scores must be isolated per game');
const diceModelEngine = new context.Engine('dice-face-model');
for (let i = 0; i < 120; i++) { const row = i % 4 === 0 ? [6, 5, 4] : [5, 4, 3]; diceModelEngine.push('T', row.reduce((a, b) => a + b, 0), row, String(i)); }
const diceSignal = diceModelEngine._diceFaceSignal();
if (diceSignal.count !== 120 || !Number.isFinite(diceSignal.p) || !diceSignal.faces || diceSignal.faces.length !== 3) throw new Error('Per-die face distribution model missing');
const dicePrediction = diceModelEngine.predict();
if (!Object.hasOwn(dicePrediction.modelProbabilities, 'diceFaces')) throw new Error('Per-die face model not blended into forecast');

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
const callbackSource = extract('async function handleCallbackAction(cq) {', '\n// Send the new screen first.');
if (!callbackSource.includes('pred:refresh:') || !callbackSource.includes('pred:back:')) throw new Error('Telegram navigation must support card refresh/back');
const wrapperSource = extract('async function onCallback(cq) {', '\nasync function onMessage(msg) {');
if (!wrapperSource.includes('await handleCallbackAction(cq)') || wrapperSource.indexOf('await handleCallbackAction(cq)') > wrapperSource.indexOf('await delMsg(chatId, messageId)')) throw new Error('Telegram must send the replacement screen before deleting the old one');
if (!source.includes('send(chatId, card.text') || !source.includes('await delMsg(chatId, replaceMessageId)') || source.includes("tg('editMessageText'")) throw new Error('Auto card must send a new message then delete old card without editing');
if (!source.includes('Object.values(autoWatch).map(w => w && w.gameId)') || source.includes('state.timer = setInterval')) throw new Error('Auto polling must be limited to active game watchers');
if (!source.includes('if (!f || !g.enabled || !g.url || f.polling) return;') || !source.includes('finally { f.polling = false; }')) throw new Error('Game API polling lock missing');
if (!source.includes("stopAuto(uid);\n    saveUsers(); delete sessions[uid];")) throw new Error('Text /menu and /start must stop game auto updates');
if (!source.includes("[btn('🔄 LÀM MỚI', 'pred:refresh:' + gameId, 'success'), btn('◀️ QUAY LẠI', 'pred:back:' + g.brand, 'primary'), btn('🏠 VỀ MENU', 'menu', 'danger')]") || !source.includes('🎲 ${n}')) throw new Error('Prediction card buttons or native dice icon format missing');
if (!source.includes("app.post('/api/login'") || !source.includes("app.post('/api/logout'") || !source.includes('requireIndexAuth')) throw new Error('Dashboard password gate is missing');
if (!source.includes("tg('setMessageReaction'")) throw new Error('Random reactions are not wired');
for (const feature of ['showAdminOperations','showAdminGames','showAdminSettings','showAdminPackages','showAdminUsers','showAdminBank','scheduleGamePolling']) {
  if (!new RegExp('function\\s+' + feature + '\\s*\\(').test(source)) throw new Error('Missing admin control: ' + feature);
}
for (const command of ['/maintenance on','/maintmsg ','/reactions on','/setpoll ','/gameurl ','/settitle ','/setwelcome ','/removegroup ']) {
  if (!source.includes(command)) throw new Error('Missing admin command: ' + command);
}
if (!source.includes('adm:game:toggle:') || !source.includes('settings.reactionsEnabled === false')) throw new Error('Admin game/reaction toggles are missing');

for (const command of ['/fileadd ', '/filereplace ', '/filetitle', '/filedesc', '/fileprice', '/filetype', '/filetoggle', '/filedelete', '/filelist']) {
  if (!source.includes(command)) throw new Error('Missing file-store admin command: ' + command);
}
for (const feature of ['showStoreProduct','showAdminFileProduct','activeStoreProducts','saveStoreProducts','extractStoreUpload']) {
  if (!new RegExp('function\\s+' + feature + '\\s*\\(').test(source)) throw new Error('Missing multi-product file-store feature: ' + feature);
}
if (!source.includes("loadJSON('store_products.json'") || !source.includes("data.slice('store:item:'.length)")) throw new Error('Persistent product catalog / user selection routes are missing');
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

// QR: 7-character compact memo (N/M + six hex chars), unique per order, old dashed memos remain matchable.
const keyMemo1 = context.createPaymentMemo('key', '123456', 'member');
const keyMemo2 = context.createPaymentMemo('key', '123456', 'member');
const fileMemo = context.createPaymentMemo('file', '123456', 'member');
if (!/^N[A-F0-9]{6}$/.test(keyMemo1) || keyMemo1 === keyMemo2) throw new Error('KEY memo must be N plus six random characters, without hyphen');
if (!/^M[A-F0-9]{6}$/.test(fileMemo)) throw new Error('FILE memo must be M plus six random characters, without hyphen');
if (!context.transferMemoIncluded('REF: 998877 | ND: napass ' + keyMemo1 + ' trailing', keyMemo1)) throw new Error('New KEY memo matching failed');
if (!context.transferMemoIncluded('ND: legacy N-ABC123 Napas12345678', 'N-ABC123')) throw new Error('Legacy memo with hyphen must remain compatible');
if (context.tryMatchPayment('-2.500 VND | ND: NABC123') !== null) throw new Error('Debit notification must not be matched as a credit');
if (context.tryMatchPayment('Số dư còn lại 2.500 VND | ND: NABC123') !== null) throw new Error('Balance-only notification must not be treated as a deposit');
if (!context.transferMemoIncluded('ND: old order N0123456789AB', 'N0123456789AB')) throw new Error('Legacy memo matching failed');

// v16.8.6: activation keys are exactly ten random uppercase letters/digits, unique against saved keys.
const tenCharKey = context.genKey();
if (!/^[A-Z2-9]{10}$/.test(tenCharKey)) throw new Error('Generated activation KEY must contain exactly 10 uppercase alphanumeric characters');
context.keysDB[tenCharKey] = { until: Date.now() + 1000 };
if (context.genKey() === tenCharKey) throw new Error('Generated activation KEY collision was not avoided');

// v16.8.6: inventory upload accepts Telegram documents and native media types.
const docUpload = context.extractStoreUpload({ document: { file_id: 'doc-1', file_name: 'bundle.zip' } });
const photoUpload = context.extractStoreUpload({ photo: [{ file_id: 'small' }, { file_id: 'large' }] });
const videoUpload = context.extractStoreUpload({ video: { file_id: 'video-1', file_name: 'clip.mp4' } });
if (docUpload.mediaType !== 'document' || docUpload.name !== 'bundle.zip' || photoUpload.file.file_id !== 'large' || videoUpload.mediaType !== 'video') throw new Error('Multi-type store upload parser failed');

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
  version: '16.8.8',
  engine: { allGameEnginesTested: allGameIds, transitionModel: true, recencyWeightedPatterns: true, perDieFaceModel: true, ewmaSinglePassRegression: true, isolatedPerGame: true, confidenceRange: [50, 72], duplicateSessionsIgnored: true, tripleVoided: true },
  sicbo: { topSumsT: fair.topSumsBySide.T.map(x => x.sum), topSumsX: fair.topSumsBySide.X.map(x => x.sum) },
  payment: { keyMemo: keyMemo1, fileMemo, hyphenRemoved: !keyMemo1.includes('-') && !fileMemo.includes('-'), debitRejected: true, unique: keyMemo1 !== keyMemo2, legacyDashedMemoMatch: true, screenshotFormatsParsed: parsedBank.length },
  telegram: { nativeDiceEmojiCard: true, previousSessionCorrectWrongReview: true, threeInlineButtonsSingleRow: true, activeGameOnlyAuto: true, freshMessageNavigation: true, newCardOnSession: true, gameHandlersDefined: true, randomReactionPool: true, indexPasswordGate: true },
  hash: { modelReady: model.ready, samples: model.samples, holdout: model.holdoutSamples, balancedAccuracy: Number(model.validationAccuracy.toFixed(2)), brier: Number(model.validationBrier.toFixed(4)), duplicate: duplicate.reason, conflicting: conflict.reason }
}, null, 2));
