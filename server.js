const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class Engine {
    constructor() {
        this.history = [];          // 'T' / 'X'
        this.detailedHistory = [];  // tong diem nut
        this.models = {};
        this.weights = {};
        this.lastPredictions = {};
        this.consecutiveLosses = 0;

        this.sessionStats = {
            streaks: { T: 0, X: 0, maxT: 0, maxX: 0 },
            transitions: { TtoT: 0, TtoX: 0, XtoT: 0, XtoX: 0 },
            volatility: 0.5,
            recentAccuracy: 0,
            sumAverage: 10.5
        };
        this.marketState = { trend: 'CÃ‚N Báº°NG', regime: 'NORMAL' };

        // ===== SIÃŠU VIP ENGINE UPGRADE =====
        this.modelHits = {};        // EWMA do chinh xac tung model
        this.autocorr = 0;          // tu tuong quan lag-1 (+1: bet, -1: nhip)
        this.entropy = 1.0;
        this.streakSurvival = {};   // P(tiep tuc | do dai chuoi k) thuc nghiem
        this.balancedLastPreds = []; // model19 â€” chá»‘ng bá»‡t dá»± Ä‘oÃ¡n
        this.consecutiveSamePreds = []; // chá»‘ng láº·p dá»± Ä‘oÃ¡n liÃªn tiáº¿p
        this.recentPredResults = []; // theo dÃµi Ä‘Ãºng/sai gáº§n Ä‘Ã¢y cá»§a ensemble
        this.lastEnsemblePred = null; // dá»± Ä‘oÃ¡n ensemble cuá»‘i (Ä‘á»ƒ cháº¥m Ä‘iá»ƒm)
        this.initAllModels();
    }

    initAllModels() {
        for (let i = 1; i <= 10; i++) {
            if (this[`model${i}`]) {
                this.models[`model${i}`] = this[`model${i}`].bind(this);
                this.weights[`model${i}`] = i === 1 ? 0.12 : 1.0;
                this.modelHits[`model${i}`] = { win: 0, loss: 0, ewma: 0.5 };
            }
        }
        this.models['model_antiBreak'] = this.model_antiBreak.bind(this);
        this.weights['model_antiBreak'] = 1.25;
        this.modelHits['model_antiBreak'] = { win: 0, loss: 0, ewma: 0.5 };
        for (let i = 11; i <= 20; i++) {
            if (this[`model${i}`]) {
                this.models[`model${i}`] = this[`model${i}`].bind(this);
                this.weights[`model${i}`] = 1.0;
                this.modelHits[`model${i}`] = { win: 0, loss: 0, ewma: 0.5 };
            }
        }
        // === SIÃŠU Ká»¸: trá»ng sá»‘ tá»‘i Æ°u â€” giáº£m máº¡nh model dá»… báº¯t 1-1 áº£o ===
        if (this.models['model16']) this.weights['model16'] = 1.55; // pattern8 table
        if (this.models['model17']) this.weights['model17'] = 0.50; // RLE â€” giáº£m máº¡nh, dá»… nháº§m 2-2
        if (this.models['model14']) this.weights['model14'] = 0.40; // nhá»‹p 5 phiÃªn â€” ráº¥t dá»… áº£o
        if (this.models['model18']) this.weights['model18'] = 1.30;
        if (this.models['model19']) this.weights['model19'] = 1.10;
        if (this.models['model20']) this.weights['model20'] = 1.60; // VIP pattern reader â€” Ä‘Ã¡ng tin
        if (this.models['model_antiBreak']) this.weights['model_antiBreak'] = 1.75; // theo bá»‡t â€” chÃ­nh xÃ¡c nháº¥t
        if (this.models['model2']) this.weights['model2'] = 1.25;
        if (this.models['model8']) this.weights['model8'] = 1.30; // N-gram máº¡nh
    }

    addResult(result, diceSum = null) {
        // === SIÃŠU Ká»¸: cháº¥m Ä‘iá»ƒm dá»± Ä‘oÃ¡n ensemble cuá»‘i â†’ cáº­p nháº­t chuá»—i thua ===
        if (this.lastEnsemblePred && this.lastEnsemblePred.prediction) {
            const ensHit = this.lastEnsemblePred.prediction === result;
            if (ensHit) { this.consecutiveLosses = 0; this.recentPredResults.push(1); }
            else { this.consecutiveLosses++; this.recentPredResults.push(0); }
            if (this.recentPredResults.length > 12) this.recentPredResults.shift();
            this.lastEnsemblePred = null;
        }
        // Cap nhat trong so adaptive + EWMA do chinh xac tung model
        for (const [modelName, lastPred] of Object.entries(this.lastPredictions)) {
            if (lastPred && lastPred.prediction) {
                const hit = lastPred.prediction === result;
                if (hit) {
                    this.weights[modelName] = Math.min((this.weights[modelName] || 1.0) * 1.10, 3.2);
                } else {
                    // === SIÃŠU Ká»¸: pháº¡t náº·ng hÆ¡n cÃ¡c model dá»… báº¯t 1-1 áº£o ===
                    const flipProne = (modelName === 'model1' || modelName === 'model14' || modelName === 'model17' || modelName === 'model9');
                    const penalty = flipProne ? 0.45 : (modelName === 'model_antiBreak' ? 0.60 : 0.72);
                    this.weights[modelName] = Math.max((this.weights[modelName] || 1.0) * penalty, 0.05);
                }
                if (this.modelHits[modelName]) {
                    const h = this.modelHits[modelName];
                    if (hit) h.win++; else h.loss++;
                    h.ewma = 0.82 * h.ewma + 0.18 * (hit ? 1 : 0);
                }
            }
        }
        this.lastPredictions = {};

        if (this.history.length > 0) {
            const lastResult = this.history[this.history.length - 1];
            const transitionKey = `${lastResult}to${result}`;
            this.sessionStats.transitions[transitionKey] = (this.sessionStats.transitions[transitionKey] || 0) + 1;

            if (result === lastResult) {
                this.sessionStats.streaks[result]++;
                this.sessionStats.streaks[`max${result}`] = Math.max(
                    this.sessionStats.streaks[`max${result}`],
                    this.sessionStats.streaks[result]
                );
            } else {
                this.sessionStats.streaks[result] = 1;
                this.sessionStats.streaks[lastResult] = 0;
            }
        } else {
            this.sessionStats.streaks[result] = 1;
        }

        this.history.push(result);
        if (diceSum !== null) {
            this.detailedHistory.push(diceSum);
            if (this.detailedHistory.length > 200) this.detailedHistory.shift();
            const recentSums = this.detailedHistory.slice(-15);
            this.sessionStats.sumAverage = recentSums.reduce((a, b) => a + b, 0) / recentSums.length;
        }
        if (this.history.length > 300) this.history.shift();

        this.updateVolatility();
        this.updateAutocorrelation();
        this.updateStreakSurvival();
        this.updateMarketState();
    }

    updateVolatility() {
        if (this.history.length < 5) return;
        const recent = this.history.slice(-10);
        let changes = 0;
        for (let i = 1; i < recent.length; i++) {
            if (recent[i] !== recent[i-1]) changes++;
        }
        this.sessionStats.volatility = changes / (recent.length - 1);
        // Shannon entropy 20 phien gan nhat
        const w = this.history.slice(-20);
        const pT = w.filter(c => c === 'T').length / Math.max(1, w.length);
        const pX = 1 - pT;
        const e = -(pT > 0 ? pT * Math.log2(pT) : 0) - (pX > 0 ? pX * Math.log2(pX) : 0);
        this.entropy = isNaN(e) ? 1 : e;
    }

    updateAutocorrelation() {
        const N = Math.min(this.history.length, 40);
        if (N < 10) { this.autocorr = 0; return; }
        const seq = this.history.slice(-N).map(c => c === 'T' ? 1 : -1);
        const mean = seq.reduce((a, b) => a + b, 0) / seq.length;
        let num = 0, den = 0;
        for (let i = 1; i < seq.length; i++) {
            num += (seq[i-1] - mean) * (seq[i] - mean);
            den += (seq[i] - mean) * (seq[i] - mean);
        }
        this.autocorr = den > 0 ? Math.max(-0.85, Math.min(0.85, num / den)) : 0;
    }

    updateStreakSurvival() {
        // P(chuoi tiep tuc | da chay k phien) â€” thuc nghiem tren toan bo lich su
        const cont = {}, tot = {};
        let runChar = null, runLen = 0;
        for (let i = 0; i < this.history.length; i++) {
            const c = this.history[i];
            if (runChar === c) {
                const k = Math.min(runLen, 8);
                tot[k] = (tot[k] || 0) + 1;
                cont[k] = (cont[k] || 0) + 1;
                runLen++;
            } else {
                if (runChar !== null) {
                    const k = Math.min(runLen, 8);
                    tot[k] = (tot[k] || 0) + 1; // chuoi do dai k bi be
                }
                runChar = c;
                runLen = 1;
            }
        }
        this.streakSurvival = {};
        for (const k in tot) {
            this.streakSurvival[k] = ((cont[k] || 0) + 0.5) / (tot[k] + 1.0); // Laplace smoothing
        }
    }

    updateMarketState() {
        if (this.history.length < 15) return;
        const recent = this.history.slice(-15);
        const tCount = recent.filter(x => x === 'T').length;
        const xCount = recent.filter(x => x === 'X').length;
        const diff = Math.abs(tCount - xCount) / recent.length;

        // === SIÃŠU Ká»¸: chá»‰ gá»i lÃ  nhá»‹p khi Cáº¢ autocorr máº¡nh VÃ€ biáº¿n Ä‘á»™ng cao ===
        if (this.autocorr < -0.28 && this.sessionStats.volatility > 0.75) {
            this.marketState.regime = 'Cáº§u Nhá»‹p Ngáº¯n (1-1 / 1-2)';
        } else if (diff > 0.4) {
            this.marketState.regime = tCount > xCount ? 'Cáº§u NghiÃªng TÃ€I' : 'Cáº§u NghiÃªng Xá»ˆU';
        } else if (this.sessionStats.streaks.T >= 3 || this.sessionStats.streaks.X >= 3) {
            this.marketState.regime = 'Cáº§u Bá»‡t / Chuá»—i DÃ i';
        } else {
            this.marketState.regime = 'Cáº§u TÃ¡ch / KhuÃ´n 2-2';
        }
        this.marketState.trend = tCount > xCount ? 'TÃ€I Táº®C' : (xCount > tCount ? 'Xá»ˆU Táº®C' : 'CÃ‚N Báº°NG');
    }

    // ===== CÃC MODEL Dá»° ÄOÃN (giá»¯ nguyÃªn tÃªn, nÃ¢ng cáº¥p logic) =====

    // Model 1: chá»‰ nháº­n 1-1 khi xÃ¡c nháº­n rÃµ (6+ phiÃªn Ä‘an xen) â€” trÃ¡nh báº¯t 1-1 áº£o
    model1() {
        // === SIÃŠU Ká»¸: chá»‰ báº¯t 1-1 khi 10 phiÃªn Ä‘an xen HOÃ€N Háº¢O (9/9 Ä‘áº£o) ===
        const recent = this.history.slice(-10);
        if (recent.length < 10) return null;
        let flips = 0;
        for (let i = 1; i < recent.length; i++) if (recent[i] !== recent[i-1]) flips++;
        if (flips < 9) return null; // khÃ´ng cháº¥p nháº­n bá»‡t xen káº½
        const last = recent[recent.length - 1];
        const pred = last === 'T' ? 'X' : 'T';
        return { prediction: pred, confidence: 0.68, reason: `1-1 sáº¡ch 10 phiÃªn (xÃ¡c nháº­n máº¡nh) â†’ Ä‘áº£o nháº¹` };
    }

    // Model Anti-Break: dung hazard thuc nghiem cua chuoi
    model_antiBreak() {
        const last = this.history[this.history.length - 1];
        if (!last) return null;
        const streak = this.sessionStats.streaks[last] || 0;
        if (streak < 2) return null;
        const k = Math.min(streak, 8);
        const surv = this.streakSurvival[k];
        if (surv === undefined) {
            if (streak >= 2 && streak <= 5) {
                return { prediction: last, confidence: 0.85 + (streak * 0.02), reason: `Anti Báº» Cáº§u: Chuá»—i ${streak} (${last === 'T' ? 'TÃ€I' : 'Xá»ˆU'})` };
            }
            return null;
        }
        if (surv >= 0.50) {
            const conf = Math.min(0.62 + (surv - 0.5) * 1.4, 0.88);
            return { prediction: last, confidence: conf, reason: `Anti-Báº» Thá»±c Nghiá»‡m: P(tiáº¿p tá»¥c)=${(surv * 100).toFixed(0)}% @ chuá»—i ${streak}` };
        } else if (surv <= 0.42) {
            const conf = Math.min(0.60 + (0.5 - surv) * 1.4, 0.85);
            return { prediction: last === 'T' ? 'X' : 'T', confidence: conf, reason: `Hazard Báº» Cáº§u: P(Ä‘á»©t)=${((1 - surv) * 100).toFixed(0)}% @ chuá»—i ${streak}` };
        }
        return null;
    }

    // Model 2: Bet dai â€” ket hop hazard thuc nghiem
    model2() {
        const last = this.history[this.history.length - 1];
        if (!last) return null;
        const streak = this.sessionStats.streaks[last] || 0;
        if (streak < 3) return null;
        const k = Math.min(streak, 8);
        const surv = this.streakSurvival[k];
        if (surv !== undefined) {
            if (streak <= 6 && surv >= 0.5) {
                return { prediction: last, confidence: Math.min(0.7 + surv * 0.2, 0.9), reason: `Cáº§u Bá»‡t ${streak} PhiÃªn (Hazard ${(surv * 100).toFixed(0)}% tiáº¿p)` };
            }
            if (streak > 6 || surv < 0.42) {
                return { prediction: last === 'T' ? 'X' : 'T', confidence: 0.72, reason: `Cáº§u QuÃ¡ DÃ i (${streak} PhiÃªn) - Báº» An ToÃ n` };
            }
            return null;
        }
        if (streak >= 3 && streak <= 6) return { prediction: last, confidence: 0.82, reason: `Cáº§u Bá»‡t DÃ i ${streak} PhiÃªn (Xu HÆ°á»›ng TrÃ´i)` };
        if (streak > 6) return { prediction: last === 'T' ? 'X' : 'T', confidence: 0.70, reason: `Cáº§u QuÃ¡ DÃ i (${streak} PhiÃªn) - Báº» An ToÃ n` };
        return null;
    }

    // Model 3: Khuon 2-2 / 3-1 â€” mo rong them mau
    model3() {
        const recent = this.history.slice(-4);
        if (recent.length < 4) return null;
        const str = recent.join('-');
        const map = {
            'T-T-X-X': { p: 'T', c: 0.80, r: 'KhuÃ´n Cáº§u ÄÃ´i 2-2 (Æ¯u TiÃªn TÃ€I)' },
            'X-X-T-T': { p: 'X', c: 0.80, r: 'KhuÃ´n Cáº§u ÄÃ´i 2-2 (Æ¯u TiÃªn Xá»ˆU)' },
            'T-X-X-T': { p: 'T', c: 0.76, r: 'KhuÃ´n Cáº§u KÃ©p 2-1-2' },
            'X-T-T-X': { p: 'X', c: 0.76, r: 'KhuÃ´n Cáº§u KÃ©p 2-1-2' },
            'T-T-T-X': { p: 'T', c: 0.70, r: 'Máº«u Cáº§u 3-1 (Lá»‡ch Pha)' },
            'X-X-X-T': { p: 'X', c: 0.70, r: 'Máº«u Cáº§u 3-1 (Lá»‡ch Pha)' },
            'T-X-T-T': { p: 'T', c: 0.68, r: 'Máº«u 1-2-1 KÃ©o DÃ i' },
            'X-T-X-X': { p: 'X', c: 0.68, r: 'Máº«u 1-2-1 KÃ©o DÃ i' }
        };
        const m = map[str];
        if (m) return { prediction: m.p, confidence: m.c, reason: m.r };
        return null;
    }

    // Model 4: Mau 1-2-1 tren 5 diem (tranh xung dot voi model3)
    model4() {
        const recent = this.history.slice(-5);
        if (recent.length < 5) return null;
        const str = recent.join('-');
        if (str === 'T-X-X-T-T') return { prediction: 'X', confidence: 0.74, reason: 'Cáº§u TÃ¡ch Máº«u 1-2-1-1 (Há»“i Xá»ˆU)' };
        if (str === 'X-T-T-X-X') return { prediction: 'T', confidence: 0.74, reason: 'Cáº§u TÃ¡ch Máº«u 1-2-1-1 (Há»“i TÃ€I)' };
        if (str === 'T-T-X-X-T') return { prediction: 'X', confidence: 0.72, reason: 'Máº«u 2-2-1 Äáº£o Chiá»u' };
        if (str === 'X-X-T-T-X') return { prediction: 'T', confidence: 0.72, reason: 'Máº«u 2-2-1 Äáº£o Chiá»u' };
        return null;
    }

    // Model 5: Diem nut cuc han
    model5() {
        if (this.detailedHistory.length === 0) return null;
        const lastSum = this.detailedHistory[this.detailedHistory.length - 1];
        if (lastSum <= 4) return { prediction: 'T', confidence: 0.88, reason: `NÃºt Cá»±c Tháº¥p (${lastSum} NÃºt) - Há»“i Quy TÃ€I` };
        if (lastSum >= 17) return { prediction: 'X', confidence: 0.88, reason: `NÃºt Cá»±c Cao (${lastSum} NÃºt) - Há»“i Quy Xá»ˆU` };
        return null;
    }

    // Model 6: Trung binh diem nut
    model6() {
        if (this.detailedHistory.length < 4) return null;
        const avg = this.sessionStats.sumAverage;
        if (avg > 11.8) {
            return { prediction: 'X', confidence: Math.min(0.65 + (avg - 10.5) * 0.08, 0.85), reason: `Äiá»ƒm Trung BÃ¬nh Cao (${avg.toFixed(1)}) - Ã‰p Xá»ˆU` };
        } else if (avg < 9.2) {
            return { prediction: 'T', confidence: Math.min(0.65 + (10.5 - avg) * 0.08, 0.85), reason: `Äiá»ƒm Trung BÃ¬nh Tháº¥p (${avg.toFixed(1)}) - Ã‰p TÃ€I` };
        }
        return null;
    }

    // Model 7: Markov bac 1 tu ma tran chuyen trang thuc nghiem
    model7() {
        if (this.history.length < 12) return null;
        const tr = this.sessionStats.transitions;
        const last = this.history[this.history.length - 1];
        const other = last === 'T' ? 'X' : 'T';
        const cCont = tr[`${last}to${last}`] || 0;
        const cBreak = tr[`${last}to${other}`] || 0;
        const tot = cCont + cBreak;
        if (tot < 10) return null;
        const pCont = (cCont + 0.5) / (tot + 1);
        if (Math.abs(pCont - 0.5) < 0.12) return null;
        const pred = pCont > 0.5 ? last : other;
        const conf = Math.min(0.58 + Math.abs(pCont - 0.5) * 1.1, 0.82);
        return { prediction: pred, confidence: conf, reason: `Markov Báº­c 1: P(${pred === 'T' ? 'TÃ€I' : 'Xá»ˆU'})=${(Math.max(pCont, 1 - pCont) * 100).toFixed(0)}% (${tot} máº«u)` };
    }

    // Model 8: N-gram Markov bac bien (2..5) co trong so thoi gian â€” model manh nhat
    model8() {
        if (this.history.length < 10) return null;
        const H = this.history;
        const hs = H.join('');
        let aggLo = 0, aggW = 0, bestOrder = 0, bestSupport = 0;
        for (let order = 2; order <= 5; order++) {
            if (H.length < order + 5) continue;
            const suffix = hs.slice(-order);
            let tW = 0, xW = 0, support = 0;
            for (let i = 0; i + order < H.length; i++) {
                if (hs.substr(i, order) !== suffix) continue;
                const recency = 0.35 + 0.65 * (i / (H.length - 1)); // mau gan nhat trong so cao hon
                if (H[i + order] === 'T') tW += recency; else xW += recency;
                support += recency;
            }
            if (support < 1.2) continue;
            const pT = (tW + 0.5) / (support + 1.0);
            const pc = Math.min(Math.max(pT, 0.12), 0.88);
            const lo = Math.log(pc / (1 - pc));
            const w = support * (1 + 0.12 * order); // bac cao hon duoc tin hon khi du mau
            aggLo += w * lo;
            aggW += w;
            if (support > bestSupport) { bestSupport = support; bestOrder = order; }
        }
        if (aggW === 0) return null;
        const pT = 1 / (1 + Math.exp(-aggLo));
        if (Math.abs(pT - 0.5) < 0.06) return null;
        const pred = pT > 0.5 ? 'T' : 'X';
        const conf = Math.min(0.55 + Math.abs(pT - 0.5) * 1.1, 0.9);
        return { prediction: pred, confidence: conf, reason: `N-gram Markov Báº­c ${bestOrder} (${bestSupport.toFixed(1)} máº«u cÃ³ trá»ng sá»‘)` };
    }

    // Model 9: Regime adapter dua tren tu tuong quan (bet vs nhip)
    model9() {
        if (this.history.length < 15) return null;
        const ac = this.autocorr;
        if (Math.abs(ac) < 0.22) return null;
        const last = this.history[this.history.length - 1];
        if (ac > 0) {
            return { prediction: last, confidence: Math.min(0.55 + ac * 0.8, 0.82), reason: `Regime Xu HÆ°á»›ng (autocorr=${ac.toFixed(2)}) â†’ Theo Chuá»—i` };
        } else {
            return { prediction: last === 'T' ? 'X' : 'T', confidence: Math.min(0.55 + (-ac) * 0.8, 0.82), reason: `Regime Nhá»‹p (autocorr=${ac.toFixed(2)}) â†’ Äáº£o Chiá»u` };
        }
    }

    // Model 10: Ty le thuc te TAI/XIU tren N phien gan nhat (base-rate bias)
    model10() {
        if (this.detailedHistory.length < 8) return null;
        const recent = this.detailedHistory.slice(-20);
        const tCount = recent.filter(s => s >= 11).length;
        const n = recent.length;
        const pT = (tCount + 0.5) / (n + 1);
        if (Math.abs(pT - 0.5) < 0.12) return null;
        const pred = pT > 0.5 ? 'T' : 'X';
        const conf = Math.min(0.55 + Math.abs(pT - 0.5) * 1.3, 0.85);
        return { prediction: pred, confidence: conf, reason: `Tá»· Lá»‡ Thá»±c Táº¿ ${n} phiÃªn: TÃ€I ${(pT * 100).toFixed(0)}%` };
    }

    // ===== CHáº¾ Äá»˜ TIáº¾P Tá»¤C HUáº¤N LUYá»†N (khÃ´ng áº£nh hÆ°á»Ÿng giao diá»‡n) =====
    saveState() {
        return {
            history: this.history,
            detailedHistory: this.detailedHistory,
            weights: this.weights,
            modelHits: this.modelHits,
            sessionStats: this.sessionStats,
            marketState: this.marketState,
            autocorr: this.autocorr,
            entropy: this.entropy,
            streakSurvival: this.streakSurvival,
            consecutiveLosses: this.consecutiveLosses,
            balancedLastPreds: this.balancedLastPreds || [],
            consecutiveSamePreds: this.consecutiveSamePreds || [],
            recentPredResults: this.recentPredResults || [],
            lastEnsemblePred: this.lastEnsemblePred || null,
            ts: Date.now()
        };
    }
    loadState(s) {
        if (!s) return;
        try {
            if (Array.isArray(s.history)) this.history = s.history.slice(-300);
            if (Array.isArray(s.detailedHistory)) this.detailedHistory = s.detailedHistory.slice(-200);
            if (s.weights) this.weights = s.weights;
            if (s.modelHits) this.modelHits = s.modelHits;
            if (s.sessionStats) this.sessionStats = s.sessionStats;
            if (s.marketState) this.marketState = s.marketState;
            if (typeof s.autocorr === 'number') this.autocorr = s.autocorr;
            if (typeof s.entropy === 'number') this.entropy = s.entropy;
            if (s.streakSurvival) this.streakSurvival = s.streakSurvival;
            if (typeof s.consecutiveLosses === 'number') this.consecutiveLosses = s.consecutiveLosses;
            if (Array.isArray(s.balancedLastPreds)) this.balancedLastPreds = s.balancedLastPreds.slice(-20);
            if (Array.isArray(s.consecutiveSamePreds)) this.consecutiveSamePreds = s.consecutiveSamePreds.slice(-10);
            if (Array.isArray(s.recentPredResults)) this.recentPredResults = s.recentPredResults.slice(-12);
            if (s.lastEnsemblePred) this.lastEnsemblePred = s.lastEnsemblePred;
            // dam bao cac model moi deu co trong so / EWMA mac dinh
            for (const k in this.models) {
                if (!(k in this.weights)) {
                    this.weights[k] = (k === 'model1') ? 0.12
                        : (k === 'model_antiBreak' ? 1.75
                        : (k === 'model20' ? 1.60
                        : (k === 'model17' ? 0.50
                        : (k === 'model14' ? 0.40 : 1.0))));
                }
                if (!(k in this.modelHits)) this.modelHits[k] = { win: 0, loss: 0, ewma: 0.5 };
            }
            // === SIÃŠU Ká»¸: Ã©p trá»ng sá»‘ chuáº©n sau khi load state (chá»‘ng bias 1-1 tá»« state cÅ©) ===
            if (this.weights['model1'] && this.weights['model1'] > 0.20) this.weights['model1'] = 0.12;
            if (this.weights['model14'] && this.weights['model14'] > 0.60) this.weights['model14'] = 0.40;
            if (this.weights['model17'] && this.weights['model17'] > 0.70) this.weights['model17'] = 0.50;
            if (this.models['model_antiBreak'] && (!this.weights['model_antiBreak'] || this.weights['model_antiBreak'] < 1.5))
                this.weights['model_antiBreak'] = 1.75;
            if (this.models['model20'] && (!this.weights['model20'] || this.weights['model20'] < 1.4))
                this.weights['model20'] = 1.60;
        } catch (e) { console.warn('loadState failed:', e); }
    }

    // ===== MODEL 11-15: tÃ­ch há»£p tá»« thuattoan8.txt + thuattoan123/sun_algo =====
    // Model 11: Báº£ng tra cá»©u 8-gram (4950 máº«u, majority vote trÃªn 256 tá»• há»£p)
    model11() {
        if (this.history.length < 8) return null;
        const key = this.history.slice(-8).join('');
        if (!this._gram8) this._gram8 = {"TTTTTTTT":"T","TTTTTTTX":"X","TTTTTTXT":"X","TTTTTTXX":"X","TTTTTXTT":"X","TTTTTXTX":"T","TTTTTXXT":"T","TTTTTXXX":"X","TTTTXTTT":"T","TTTTXTTX":"X","TTTTXTXT":"T","TTTTXTXX":"T","TTTTXXTT":"T","TTTTXXTX":"X","TTTTXXXT":"X","TTTTXXXX":"X","TTTXTTTT":"X","TTTXTTTX":"X","TTTXTTXT":"X","TTTXTTXX":"X","TTTXTXTT":"X","TTTXTXTX":"T","TTTXTXXT":"X","TTTXTXXX":"X","TTTXXTTT":"T","TTTXXTTX":"T","TTTXXTXT":"T","TTTXXTXX":"X","TTTXXXTT":"X","TTTXXXTX":"X","TTTXXXXT":"T","TTTXXXXX":"X","TTXTTTTT":"X","TTXTTTTX":"X","TTXTTTXT":"T","TTXTTTXX":"T","TTXTTXTT":"T","TTXTTXTX":"T","TTXTTXXT":"X","TTXTTXXX":"T","TTXTXTTT":"T","TTXTXTTX":"T","TTXTXTXT":"X","TTXTXTXX":"X","TTXTXXTT":"T","TTXTXXTX":"T","TTXTXXXT":"X","TTXTXXXX":"T","TTXXTTTT":"T","TTXXTTTX":"X","TTXXTTXT":"X","TTXXTTXX":"T","TTXXTXTT":"T","TTXXTXTX":"T","TTXXTXXT":"X","TTXXTXXX":"T","TTXXXTTT":"X","TTXXXTTX":"T","TTXXXTXT":"T","TTXXXTXX":"X","TTXXXXTT":"X","TTXXXXTX":"X","TTXXXXXT":"X","TTXXXXXX":"T","TXTTTTTT":"X","TXTTTTTX":"X","TXTTTTXT":"X","TXTTTTXX":"X","TXTTTXTT":"T","TXTTTXTX":"X","TXTTTXXT":"X","TXTTTXXX":"X","TXTTXTTT":"T","TXTTXTTX":"X","TXTTXTXT":"X","TXTTXTXX":"T","TXTTXXTT":"T","TXTTXXTX":"T","TXTTXXXT":"X","TXTTXXXX":"T","TXTXTTTT":"T","TXTXTTTX":"T","TXTXTTXT":"T","TXTXTTXX":"T","TXTXTXTT":"X","TXTXTXTX":"X","TXTXTXXT":"X","TXTXTXXX":"T","TXTXXTTT":"X","TXTXXTTX":"X","TXTXXTXT":"T","TXTXXTXX":"T","TXTXXXTT":"X","TXTXXXTX":"T","TXTXXXXT":"X","TXTXXXXX":"X","TXXTTTTT":"T","TXXTTTTX":"X","TXXTTTXT":"T","TXXTTTXX":"T","TXXTTXTT":"X","TXXTTXTX":"T","TXXTTXXT":"X","TXXTTXXX":"X","TXXTXTTT":"T","TXXTXTTX":"X","TXXTXTXT":"X","TXXTXTXX":"T","TXXTXXTT":"T","TXXTXXTX":"X","TXXTXXXT":"X","TXXTXXXX":"X","TXXXTTTT":"T","TXXXTTTX":"X","TXXXTTXT":"T","TXXXTTXX":"T","TXXXTXTT":"X","TXXXTXTX":"T","TXXXTXXT":"X","TXXXTXXX":"T","TXXXXTTT":"T","TXXXXTTX":"X","TXXXXTXT":"T","TXXXXTXX":"T","TXXXXXTT":"X","TXXXXXTX":"X","TXXXXXXT":"T","TXXXXXXX":"T","XTTTTTTT":"T","XTTTTTTX":"T","XTTTTTXT":"T","XTTTTTXX":"X","XTTTTXTT":"T","XTTTTXTX":"T","XTTTTXXT":"X","XTTTTXXX":"X","XTTTXTTT":"X","XTTTXTTX":"T","XTTTXTXT":"T","XTTTXTXX":"X","XTTTXXTT":"T","XTTTXXTX":"T","XTTTXXXT":"T","XTTTXXXX":"X","XTTXTTTT":"T","XTTXTTTX":"T","XTTXTTXT":"X","XTTXTTXX":"T","XTTXTXTT":"X","XTTXTXTX":"X","XTTXTXXT":"T","XTTXTXXX":"X","XTTXXTTT":"T","XTTXXTTX":"T","XTTXXTXT":"X","XTTXXTXX":"X","XTTXXXTT":"X","XTTXXXTX":"T","XTTXXXXT":"X","XTTXXXXX":"T","XTXTTTTT":"T","XTXTTTTX":"T","XTXTTTXT":"X","XTXTTTXX":"T","XTXTTXTT":"T","XTXTTXTX":"T","XTXTTXXT":"X","XTXTTXXX":"X","XTXTXTTT":"T","XTXTXTTX":"T","XTXTXTXT":"T","XTXTXTXX":"X","XTXTXXTT":"T","XTXTXXTX":"X","XTXTXXXT":"T","XTXTXXXX":"T","XTXXTTTT":"X","XTXXTTTX":"T","XTXXTTXT":"T","XTXXTTXX":"T","XTXXTXTT":"X","XTXXTXTX":"T","XTXXTXXT":"T","XTXXTXXX":"T","XTXXXTTT":"T","XTXXXTTX":"X","XTXXXTXT":"X","XTXXXTXX":"T","XTXXXXTT":"T","XTXXXXTX":"T","XTXXXXXT":"X","XTXXXXXX":"T","XXTTTTTT":"X","XXTTTTTX":"T","XXTTTTXT":"T","XXTTTTXX":"X","XXTTTXTT":"T","XXTTTXTX":"X","XXTTTXXT":"X","XXTTTXXX":"T","XXTTXTTT":"X","XXTTXTTX":"X","XXTTXTXT":"X","XXTTXTXX":"T","XXTTXXTT":"T","XXTTXXTX":"T","XXTTXXXT":"T","XXTTXXXX":"X","XXTXTTTT":"T","XXTXTTTX":"X","XXTXTTXT":"T","XXTXTTXX":"T","XXTXTXTT":"T","XXTXTXTX":"X","XXTXTXXT":"T","XXTXTXXX":"T","XXTXXTTT":"T","XXTXXTTX":"X","XXTXXTXT":"X","XXTXXTXX":"X","XXTXXXTT":"T","XXTXXXTX":"X","XXTXXXXT":"X","XXTXXXXX":"T","XXXTTTTT":"T","XXXTTTTX":"X","XXXTTTXT":"T","XXXTTTXX":"T","XXXTTXTT":"T","XXXTTXTX":"X","XXXTTXXT":"X","XXXTTXXX":"X","XXXTXTTT":"X","XXXTXTTX":"X","XXXTXTXT":"T","XXXTXTXX":"X","XXXTXXTT":"T","XXXTXXTX":"X","XXXTXXXT":"T","XXXTXXXX":"T","XXXXTTTT":"T","XXXXTTTX":"T","XXXXTTXT":"T","XXXXTTXX":"T","XXXXTXTT":"T","XXXXTXTX":"T","XXXXTXXT":"T","XXXXTXXX":"T","XXXXXTTT":"T","XXXXXTTX":"T","XXXXXTXT":"T","XXXXXTXX":"X","XXXXXXTT":"X","XXXXXXTX":"T","XXXXXXXT":"T","XXXXXXXX":"X"};
        const pred = this._gram8[key];
        if (!pred) return null;
        return { prediction: pred, confidence: 0.72, reason: `Báº£ng Tra Cá»©u 8-Gram: [${key}] â†’ ${pred === 'T' ? 'TÃ€I' : 'Xá»ˆU'}` };
    }
    // Model 12: Cyclic-7 â€” 7 phiÃªn cuá»‘i trÃ¹ng hoÃ n toÃ n 7 phiÃªn liá»n trÆ°á»›c â†’ theo chu ká»³
    model12() {
        if (this.history.length < 14) return null;
        const a = this.history.slice(-7).join('');
        const b = this.history.slice(-14, -7).join('');
        if (a !== b) return null;
        const pred = this.history[this.history.length - 7];
        return { prediction: pred, confidence: 0.75, reason: `Chu Ká»³ 7 PhiÃªn Láº·p Láº¡i â†’ theo chu ká»³ ${pred === 'T' ? 'TÃ€I' : 'Xá»ˆU'}` };
    }
    // Model 13: Momentum-break â€” 6 phiÃªn lá»‡ch máº¡nh, 3 phiÃªn cuá»‘i ngÆ°á»£c chiá»u â†’ quay láº¡i momentum
    model13() {
        if (this.history.length < 9) return null;
        const first6 = this.history.slice(-9, -3);
        const last3 = this.history.slice(-3);
        const t6 = first6.filter(x => x === 'T').length;
        if (Math.abs(t6 - (6 - t6)) < 4) return null;
        if (!(last3[0] === last3[1] && last3[1] === last3[2])) return null;
        const momSide = t6 > 3 ? 'T' : 'X';
        if (last3[0] === momSide) return null;
        return { prediction: momSide, confidence: 0.71, reason: `Momentum Bá»‹ PhÃ¡ Vá»¡ (3 phiÃªn ngÆ°á»£c) â†’ Quay Láº¡i ${momSide === 'T' ? 'TÃ€I' : 'Xá»ˆU'}` };
    }
    // Model 14: 5 phiÃªn Ä‘an xen hoÃ n háº£o â†’ tiáº¿p tá»¥c nhá»‹p (Ä‘áº£o chiá»u)
    model14() {
        // === SIÃŠU Ká»¸: yÃªu cáº§u 6 phiÃªn Ä‘an xen hoÃ n háº£o, háº¡ Ä‘á»™ tin cáº­y ===
        if (this.history.length < 6) return null;
        const last6 = this.history.slice(-6);
        for (let i = 1; i < 6; i++) if (last6[i] === last6[i-1]) return null;
        const pred = last6[5] === 'T' ? 'X' : 'T';
        return { prediction: pred, confidence: 0.58, reason: '6 PhiÃªn Äan Xen â†’ Ä‘áº£o nháº¹ (Ä‘á»™ tin tháº¥p)' };
    }
    // Model 15: Máº¥t cÃ¢n báº±ng Ä‘á»™ng â€” 6/8 hoáº·c 4/6 nghiÃªng má»™t bÃªn, phiÃªn cuá»‘i lÃ  bÃªn Ä‘Ã³ â†’ há»“i quy
    model15() {
        if (this.history.length < 8) return null;
        const last8 = this.history.slice(-8);
        const t8 = last8.filter(x => x === 'T').length;
        const last = last8[7];
        if (t8 >= 6 && last === 'T') return { prediction: 'X', confidence: 0.78, reason: `Máº¥t CÃ¢n Náº·ng Máº¡nh (${t8}/8 TÃ€I, cuá»‘i TÃ€I) â†’ Há»“i Quy Xá»ˆU` };
        if ((8 - t8) >= 6 && last === 'X') return { prediction: 'T', confidence: 0.78, reason: `Máº¥t CÃ¢n Náº·ng Máº¡nh (${8 - t8}/8 Xá»ˆU, cuá»‘i Xá»ˆU) â†’ Há»“i Quy TÃ€I` };
        const last6 = last8.slice(-6);
        const t6 = last6.filter(x => x === 'T').length;
        if (t6 >= 4 && last === 'T') return { prediction: 'X', confidence: 0.72, reason: `Máº¥t CÃ¢n Náº·ng (${t6}/6 TÃ€I, cuá»‘i TÃ€I) â†’ Há»“i Quy Xá»ˆU` };
        if ((6 - t6) >= 4 && last === 'X') return { prediction: 'T', confidence: 0.72, reason: `Máº¥t CÃ¢n Náº·ng (${6 - t6}/6 Xá»ˆU, cuá»‘i Xá»ˆU) â†’ Há»“i Quy TÃ€I` };
        return null;
    }

    getAllPredictions() {
        const predictions = {};
        for (const [modelName, modelFunc] of Object.entries(this.models)) {
            try {
                const res = modelFunc();
                // === SIÃŠU Ká»¸: lá»c bá» dá»± Ä‘oÃ¡n quÃ¡ tháº¥p tá»± tin (<0.58) ===
                if (res && res.confidence >= 0.58) {
                    predictions[modelName] = res;
                    this.lastPredictions[modelName] = res;
                }
            } catch (e) {
                console.error(`Error in ${modelName}:`, e);
            }
        }
        return predictions;
    }

    // MODEL 16: Báº£ng pattern 8-kÃ½ tá»± (thuattoan8) â€” lookup chuá»—i gáº§n nháº¥t
    model16() {
        if (this.history.length < 4) return null;
        const table = Engine.PATTERN8 || {};
        // thá»­ tá»« dÃ i â†’ ngáº¯n
        for (let len = 8; len >= 4; len--) {
            if (this.history.length < len) continue;
            const key = this.history.slice(-len).join('');
            if (table[key]) {
                const pred = table[key];
                return {
                    prediction: pred,
                    confidence: len >= 8 ? 0.78 : (len >= 6 ? 0.68 : 0.58),
                    reason: `Pattern-${len} khá»›p báº£ng cáº§u (${key} â†’ ${pred === 'T' ? 'TÃ€I' : 'Xá»ˆU'})`
                };
            }
        }
        return null;
    }

    // MODEL 17: RLE â€” Ä‘á»c cáº§u tháº­t (bá»‡t / 2-2 / 3-3 / a-b), KHÃ”NG máº·c Ä‘á»‹nh 1-1
    model17() {
        if (this.history.length < 6) return null;
        const rle = [];
        let cur = this.history[0], cnt = 1;
        for (let i = 1; i < this.history.length; i++) {
            if (this.history[i] === cur) cnt++;
            else { rle.push([cur, cnt]); cur = this.history[i]; cnt = 1; }
        }
        rle.push([cur, cnt]);

        const last = rle[rle.length - 1];
        const prev = rle.length >= 2 ? rle[rle.length - 2] : null;
        const prev2 = rle.length >= 3 ? rle[rle.length - 3] : null;

        // --- Bá»‡t Ä‘ang cháº¡y (count >= 2): Æ°u tiÃªn TIáº¾P tá»¥c, khÃ´ng vá»™i Ä‘áº£o ---
        if (last[1] >= 2) {
            // nhá»‹p a-b á»•n Ä‘á»‹nh: prev.count == last.count vÃ  prev2 cÃ¹ng pattern
            if (prev && last[1] === prev[1] && last[1] >= 3) {
                // === SIÃŠU Ká»¸: chá»‰ Ä‘áº£o khi nhá»‹p Ä‘á»§ 3-3 trá»Ÿ lÃªn (2-2 quÃ¡ dá»… áº£o) ===
                const pred = last[0] === 'T' ? 'X' : 'T';
                return { prediction: pred, confidence: 0.62, reason: `Nhá»‹p ${prev[1]}-${last[1]} Ä‘á»§ Ä‘á»u â†’ Ä‘áº£o nháº¹` };
            }
            // Ä‘ang trong bá»‡t / nhá»‹p chÆ°a Ä‘á»§ so vá»›i nhá»‹p trÆ°á»›c â†’ TIáº¾P
            if (prev && last[1] < prev[1]) {
                return { prediction: last[0], confidence: 0.68 + Math.min(0.1, last[1] * 0.02), reason: `Theo nhá»‹p ${prev[1]}-${last[1]}: tiáº¿p ${last[0] === 'T' ? 'TÃ€I' : 'Xá»ˆU'}` };
            }
            // bá»‡t thuáº§n (khÃ´ng cÃ³ prev hoáº·c prev ngáº¯n)
            if (last[1] >= 3 && last[1] <= 6) {
                return { prediction: last[0], confidence: 0.72 + Math.min(0.12, (last[1] - 3) * 0.03), reason: `Cáº§u bá»‡t ${last[1]} â†’ tiáº¿p ${last[0] === 'T' ? 'TÃ€I' : 'Xá»ˆU'}` };
            }
            // bá»‡t quÃ¡ dÃ i (>=7) má»›i nghiÃªng gÃ£y
            if (last[1] >= 7) {
                const pred = last[0] === 'T' ? 'X' : 'T';
                return { prediction: pred, confidence: Math.min(0.78, 0.55 + last[1] * 0.03), reason: `Bá»‡t ${last[1]} dÃ i â†’ nghiÃªng gÃ£y` };
            }
            // streak 2: tiáº¿p (Æ°u tiÃªn theo bá»‡t, khÃ´ng vá»™i Ä‘áº£o)
            return { prediction: last[0], confidence: 0.66, reason: `Streak 2 â†’ Æ°u tiÃªn tiáº¿p ${last[0] === 'T' ? 'TÃ€I' : 'Xá»ˆU'}` };
        }

        // --- last count === 1: vá»«a flip ---
        if (last[1] === 1 && prev) {
            // Náº¿u trÆ°á»›c Ä‘Ã³ lÃ  bá»‡t dÃ i (>=3) rá»“i má»›i 1 nhá»‹p ngÆ°á»£c â†’ cÃ³ thá»ƒ gÃ£y cáº§u, chÆ°a cháº¯c 1-1
            // â†’ dá»± Ä‘oÃ¡n theo hÆ°á»›ng "xÃ¡c nháº­n gÃ£y" (tiáº¿p cá»­a má»›i) vá»›i conf tháº¥p-trung
            if (prev[1] >= 3) {
                return { prediction: last[0], confidence: 0.60, reason: `Bá»‡t ${prev[1]} gÃ£y 1 nhá»‹p â†’ xÃ¡c nháº­n cá»­a ${last[0] === 'T' ? 'TÃ€I' : 'Xá»ˆU'}` };
            }
            // True 1-1: nhiá»u Ä‘oáº¡n count=1 liÃªn tiáº¿p
            const ones = [];
            for (let i = rle.length - 1; i >= 0 && rle[i][1] === 1; i--) ones.push(rle[i]);
            if (ones.length >= 4) {
                const pred = last[0] === 'T' ? 'X' : 'T';
                return { prediction: pred, confidence: 0.64, reason: `1-1 xÃ¡c nháº­n (${ones.length} nhá»‹p) â†’ Ä‘áº£o` };
            }
            // 2-1 hoáº·c nhiá»…u: khÃ´ng Ã©p 1-1 â€” theo cá»­a vá»«a ra (xÃ¡c nháº­n)
            if (prev[1] === 2) {
                return { prediction: last[0], confidence: 0.58, reason: 'Nhá»‹p 2-1: xÃ¡c nháº­n cá»­a má»›i' };
            }
            // máº·c Ä‘á»‹nh: khÃ´ng Ä‘oÃ¡n 1-1 áº£o
            return null;
        }

        return null;
    }

    // MODEL 18: Dynamic patterns (tá»« UltraDice â€” máº¥t cÃ¢n / chu ká»³ / momentum break)
    model18() {
        const h = this.history;
        if (h.length < 6) return null;
        // 4T/6 cuá»‘i T â†’ X
        const last6 = h.slice(-6);
        if (last6.filter(x => x === 'T').length >= 4 && last6[5] === 'T') {
            return { prediction: 'X', confidence: 0.72, reason: '4+T/6 phiÃªn, cuá»‘i T â†’ há»“i Xá»ˆU' };
        }
        if (last6.filter(x => x === 'X').length >= 4 && last6[5] === 'X') {
            return { prediction: 'T', confidence: 0.72, reason: '4+X/6 phiÃªn, cuá»‘i X â†’ há»“i TÃ€I' };
        }
        if (h.length >= 8) {
            const last8 = h.slice(-8);
            const t8 = last8.filter(x => x === 'T').length;
            if (t8 >= 6 && last8[7] === 'T') return { prediction: 'X', confidence: 0.78, reason: '6+T/8, cuá»‘i T â†’ X máº¡nh' };
            if ((8 - t8) >= 6 && last8[7] === 'X') return { prediction: 'T', confidence: 0.78, reason: '6+X/8, cuá»‘i X â†’ T máº¡nh' };
        }
        // 5 phiÃªn Ä‘an xen
        if (h.length >= 5) {
            const last5 = h.slice(-5);
            let alt = true;
            for (let i = 1; i < 5; i++) if (last5[i] === last5[i - 1]) { alt = false; break; }
            if (alt) {
                const pred = last5[4] === 'T' ? 'X' : 'T';
                return { prediction: pred, confidence: 0.68, reason: '5 phiÃªn Ä‘an xen â†’ Ä‘áº£o' };
            }
        }
        // chu ká»³ 7
        if (h.length >= 14) {
            const a = h.slice(-14, -7).join('');
            const b = h.slice(-7).join('');
            if (a === b) {
                return { prediction: h[h.length - 7], confidence: 0.75, reason: 'Chu ká»³ 7 láº·p â†’ theo chu ká»³' };
            }
        }
        return null;
    }

    // MODEL 19: Balanced Predictor v3 â€” tá»· lá»‡ cá»­a sá»• + Markov + streak + random cÃ³ kiá»ƒm soÃ¡t
    model19() {
        const h = this.history;
        if (!h || h.length < 10) return null;

        // history engine: cÅ© â†’ má»›i; balanced gá»‘c dÃ¹ng má»›i â†’ cÅ© â†’ Ä‘áº£o
        const results = h.slice().reverse(); // [0] = má»›i nháº¥t
        const total = results.length;
        const totalT = results.filter(r => r === 'T').length;
        const totalRatio = totalT / total;

        const winRatio = (size) => {
            if (total < size) return totalRatio;
            const slice = results.slice(0, size);
            return slice.filter(r => r === 'T').length / size;
        };
        const recent10 = winRatio(10);
        const recent20 = winRatio(20);
        const recent50 = winRatio(50);

        // streak tá»« phiÃªn má»›i nháº¥t
        let streak = 1;
        const currentSide = results[0];
        for (let i = 1; i < results.length; i++) {
            if (results[i] === currentSide) streak++;
            else break;
        }

        // Markov báº­c 1 (trÃªn chuá»—i má»›iâ†’cÅ© váº«n Ä‘Ãºng transition náº¿u duyá»‡t i â†’ i+1 theo hÆ°á»›ng thá»i gian ngÆ°á»£c... 
        // DÃ¹ng chuá»—i theo thá»i gian tÄƒng: h
        let t2t = 0, t2x = 0, x2t = 0, x2x = 0;
        for (let i = 0; i < h.length - 1; i++) {
            const cur = h[i], next = h[i + 1];
            if (cur === 'T') next === 'T' ? t2t++ : t2x++;
            else next === 'T' ? x2t++ : x2x++;
        }
        const totT = t2t + t2x, totX = x2t + x2x;
        const pTfromT = totT > 0 ? t2t / totT : 0.5;
        const pTfromX = totX > 0 ? x2t / totX : 0.5;
        let markovT = (h[h.length - 1] === 'T' ? pTfromT : pTfromX);
        markovT = markovT * 0.7 + 0.15; // lÃ m mÆ°á»£t vá» 0.5

        // trend score
        const avgRatio = (totalRatio + recent10 + recent20 + recent50) / 4;
        let trendScore = (avgRatio - 0.5) * 2;
        const markovScore = (markovT - 0.5) * 2;
        trendScore = trendScore * 0.7 + markovScore * 0.3;

        // streak ngáº¯n-trung (2-5): Cá»˜NG theo hÆ°á»›ng bá»‡t, khÃ´ng vá»™i Ä‘áº£o
        if (streak >= 2 && streak <= 5) {
            const direction = currentSide === 'T' ? 1 : -1;
            trendScore += direction * (0.08 + streak * 0.03);
        }
        // chá»‰ khi bá»‡t ráº¥t dÃ i (>=6) má»›i nghiÃªng gÃ£y nháº¹
        if (streak >= 6) {
            const direction = currentSide === 'T' ? 1 : -1;
            if (trendScore * direction > 0) {
                trendScore -= direction * 0.15 * Math.min(1, (streak - 5) / 4);
            }
        }

        // === SIÃŠU Ká»¸: bá» random, dÃ¹ng co giÃ£n theo entropy (nhiá»…u thá»‹ trÆ°á»ng) ===
        let finalScore;
        const entM19 = (typeof this.entropy === 'number') ? this.entropy : 1.0;
        const noiseGateM19 = Math.max(0.35, 1.1 - entM19); // entropy cao â†’ co máº¡nh vá» 0
        if (Math.abs(trendScore) < 0.15) {
            const base = (totalRatio - 0.5) * 2;
            finalScore = base * 0.4 * noiseGateM19;
        } else {
            finalScore = Math.min(0.55, Math.max(-0.55, trendScore * noiseGateM19));
        }

        // chá»‘ng bá»‡t dá»± Ä‘oÃ¡n model nÃ y
        const recent = this.balancedLastPreds.slice(-3);
        if (recent.length === 3 && recent.every(p => p === recent[0])) {
            finalScore = -finalScore * 0.8;
        }

        const prediction = finalScore > 0 ? 'T' : 'X';
        this.balancedLastPreds.push(prediction);
        if (this.balancedLastPreds.length > 20) this.balancedLastPreds.shift();

        const confidence = Math.min(0.85, Math.max(0.5, 0.5 + Math.abs(finalScore) * 0.4));
        let reason;
        if (streak >= 6) reason = `Balanced: bá»‡t ${streak} ${currentSide === 'T' ? 'TÃ i' : 'Xá»‰u'} â†’ nghiÃªng gÃ£y`;
        else if (streak >= 2) reason = `Balanced: theo bá»‡t ${streak} ${currentSide === 'T' ? 'TÃ i' : 'Xá»‰u'}`;
        else reason = `Balanced v3 Â· trend ${trendScore.toFixed(2)}`;

        return { prediction, confidence, reason };
    }


    // MODEL 20: VIP Pattern Reader â€” Ä‘á»c cáº§u Ä‘a khung + majority + streak context
    model20() {
        const h = this.history;
        if (!h || h.length < 12) return null;
        const last = h[h.length - 1];
        let streak = 1;
        for (let i = h.length - 2; i >= 0; i--) {
            if (h[i] === last) streak++; else break;
        }

        // RLE segments
        const segs = [];
        let c = h[0], n = 1;
        for (let i = 1; i < h.length; i++) {
            if (h[i] === c) n++;
            else { segs.push([c, n]); c = h[i]; n = 1; }
        }
        segs.push([c, n]);

        // Cáº§u bá»‡t rÃµ
        if (streak >= 3 && streak <= 5) {
            return { prediction: last, confidence: 0.74 + Math.min(0.1, streak * 0.02), reason: `VIP: bá»‡t ${streak} â†’ theo ${last === 'T' ? 'TÃ€I' : 'Xá»ˆU'}` };
        }
        if (streak >= 6) {
            // hazard: long streak often breaks but not always
            const breakP = Math.min(0.55, 0.35 + (streak - 6) * 0.04);
            if (breakP > 0.48) {
                return { prediction: last === 'T' ? 'X' : 'T', confidence: 0.62 + (streak - 6) * 0.02, reason: `VIP: bá»‡t ${streak} dÃ i â†’ nghiÃªng gÃ£y` };
            }
            return { prediction: last, confidence: 0.6, reason: `VIP: bá»‡t ${streak} cÃ²n giá»¯` };
        }

        // Nhá»‹p Ä‘á»u a-a (2-2, 3-3)
        if (segs.length >= 4) {
            const a = segs[segs.length - 1], b = segs[segs.length - 2], c2 = segs[segs.length - 3];
            if (a[1] === b[1] && a[1] >= 2 && a[1] === c2[1]) {
                // vá»«a Ä‘á»§ nhá»‹p â†’ Ä‘áº£o
                if (a[1] === b[1]) {
                    return { prediction: a[0] === 'T' ? 'X' : 'T', confidence: 0.71, reason: `VIP: nhá»‹p ${a[1]}-${a[1]} Ä‘á»u â†’ sang cá»­a` };
                }
            }
            if (b[1] >= 2 && a[1] < b[1] && a[1] >= 1) {
                return { prediction: a[0], confidence: 0.66, reason: `VIP: theo nhá»‹p ${b[1]} â†’ tiáº¿p` };
            }
        }

        // Majority cá»­a sá»• 8/12/20 lá»‡ch rÃµ
        const votes = { T: 0, X: 0 };
        [8, 12, 20].forEach(sz => {
            if (h.length < sz) return;
            const sl = h.slice(-sz);
            const tC = sl.filter(x => x === 'T').length;
            if (tC / sz >= 0.62) votes.T++;
            else if (tC / sz <= 0.38) votes.X++;
        });
        if (votes.T >= 2) return { prediction: 'T', confidence: 0.64, reason: 'VIP: Ä‘a khung nghiÃªng TÃ€I' };
        if (votes.X >= 2) return { prediction: 'X', confidence: 0.64, reason: 'VIP: Ä‘a khung nghiÃªng Xá»ˆU' };

        // True 1-1 only
        const last6 = h.slice(-6).join('');
        if (last6 === 'TXTXTX' || last6 === 'XTXTXT') {
            return { prediction: last === 'T' ? 'X' : 'T', confidence: 0.63, reason: 'VIP: 1-1 sáº¡ch 6 phiÃªn' };
        }
        return null;
    }

    // Ensemble: Log-odds pooling + trong so EWMA accuracy + shrink + cooling
    getEnsemblePrediction() {
        const allPreds = this.getAllPredictions();
        let logOdds = 0;   // >0 ung voi TAI
        let totalWeight = 0;
        let activeCount = 0;
        let topReason = 'Thuáº­t ToÃ¡n Engine @SunNetWin';
        let highestW = 0;

        const regime = (this.marketState && this.marketState.regime) || '';
        const isBet = /Bá»‡t|Chuá»—i/.test(regime);
        const isNhip = /Nhá»‹p|1-1/.test(regime);

        // === SIÃŠU Ká»¸: Ä‘áº¿m Ä‘á»“ng thuáº­n giá»¯a cÃ¡c model ===
        let voteT = 0, voteX = 0;

        for (const [modelName, pred] of Object.entries(allPreds)) {
            if (!pred || !pred.prediction) continue;
            let baseW = (this.weights[modelName] !== undefined ? this.weights[modelName] : 1.0);
            // === SIÃŠU Ká»¸: regime-aware â€” bá»‡t boost model theo bá»‡t; háº¡n cháº¿ model1/14/17 ===
            if (isBet && (modelName === 'model_antiBreak' || modelName === 'model20' || modelName === 'model2')) baseW *= 1.25;
            if (isNhip && modelName === 'model1') baseW *= 0.9; // háº¡n cháº¿ model1 ngay cáº£ khi nhá»‹p
            if (isBet && modelName === 'model1') baseW *= 0.4; // Ä‘á»«ng báº¯t 1-1 khi Ä‘ang bá»‡t
            if (isBet && (modelName === 'model14' || modelName === 'model17')) baseW *= 0.6;
            const ewma = this.modelHits[modelName] ? this.modelHits[modelName].ewma : 0.5;
            const accMult = 0.5 + ewma;
            const w = baseW * accMult * pred.confidence;
            activeCount++;
            if (pred.prediction === 'T') voteT++; else voteX++;

            const p = pred.prediction === 'T' ? pred.confidence : (1 - pred.confidence);
            const pc = Math.min(Math.max(p, 0.1), 0.9);
            logOdds += w * Math.log(pc / (1 - pc));
            totalWeight += w;

            if (w > highestW) { highestW = w; topReason = pred.reason; }
        }

        // === SIÃŠU Ká»¸: Cá»•ng lá»c nhiá»…u â€” thá»‹ trÆ°á»ng há»—n loáº¡n thÃ¬ co máº¡nh vá» 50% ===
        const entEns = (typeof this.entropy === 'number') ? this.entropy : 1.0;
        const acAbs = Math.abs(this.autocorr || 0);
        let noiseGate = 1.0;
        if (entEns > 0.92 || acAbs < 0.07) noiseGate = 0.45;
        else if (entEns > 0.85 || acAbs < 0.12) noiseGate = 0.7;

        // === SIÃŠU Ká»¸: Äá»“ng thuáº­n â€” model quÃ¡ chia ráº½ thÃ¬ háº¡ tá»± tin ===
        const consensusGap = Math.abs(voteT - voteX);
        let consensusGate = 1.0;
        if (activeCount >= 5 && consensusGap < 2) consensusGate = 0.5;
        else if (activeCount >= 4 && consensusGap < 2) consensusGate = 0.65;

        if (totalWeight === 0) {
            // Fallback: dung ty le co so tu lich su gan nhat (khong random nhu ban cu)
            const recent = this.history.slice(-20);
            const tFreq = recent.length ? recent.filter(c => c === 'T').length / recent.length : 0.5;
            const pT = (tFreq * recent.length + 1) / (recent.length + 2);
            let taiProb = Math.round(pT * 100);
            taiProb = Math.min(Math.max(taiProb, 42), 58);
            const xiuProb = 100 - taiProb;
            const isTai = taiProb >= 50;
            this.lastEnsemblePred = { prediction: isTai ? 'T' : 'X' };
            return {
                predictedResult: isTai ? 'TÃ€I' : 'Xá»ˆU',
                confidence: isTai ? taiProb : xiuProb,
                taiProb: taiProb,
                xiuProb: xiuProb,
                activeModels: 0,
                topReason: 'Äang phÃ¢n tÃ­ch dá»¯ liá»‡u & khá»Ÿi táº¡o Engine @SunNetWin...'
            };
        }

        // Shrink ve 0.5 khi tong trong so thap (it chung khoan)
        const shrink = Math.min(1, totalWeight / 6);
        const aggLo = logOdds * shrink;
        let pT = 1 / (1 + Math.exp(-aggLo));

        // === SIÃŠU Ká»¸: Cooling tá»•ng há»£p â€” thua liÃªn tiáº¿p + nhiá»…u + thiáº¿u Ä‘á»“ng thuáº­n ===
        const cool = Math.max(0.45, 1 - this.consecutiveLosses * 0.15);
        const finalGate = Math.min(noiseGate, consensusGate, cool);
        pT = 0.5 + (pT - 0.5) * finalGate;

        let taiProb = Math.round(pT * 100);
        taiProb = Math.min(Math.max(taiProb, 35), 85); // khÃ´ng cho xÃ¡c suáº¥t cá»±c trá»‹
        const xiuProb = 100 - taiProb;
        const isTai = taiProb >= 52; // ngÆ°á»¡ng quyáº¿t Ä‘á»‹nh cao hÆ¡n (trÃ¡nh vÃ¹ng 50/50)
        const finalConfidence = isTai ? taiProb : xiuProb;

        this.lastEnsemblePred = { prediction: isTai ? 'T' : 'X' };

        return {
            predictedResult: isTai ? 'TÃ€I' : 'Xá»ˆU',
            confidence: finalConfidence,
            taiProb: taiProb,
            xiuProb: xiuProb,
            activeModels: activeCount,
            topReason: topReason
        };
    }
}

// Load pattern-8 lookup (thuattoan8)
try {
    const _p8 = path.join(__dirname, 'pattern8.json');
    if (fs.existsSync(_p8)) Engine.PATTERN8 = JSON.parse(fs.readFileSync(_p8, 'utf8'));
    else Engine.PATTERN8 = {};
} catch { Engine.PATTERN8 = {}; }


// ================= BACCARAT ENGINE (14 models + ensemble) =================
class BaccaratEngine {
  constructor() {
    this.history = []; // 'B'|'P'|'T'
    this.goodRoad = '';
    this.lastAlgos = [];
  }
  addResult(char, _sum, meta) {
    const c = String(char || '').toUpperCase();
    if (c !== 'B' && c !== 'P' && c !== 'T') return;
    this.history.push(c);
    if (this.history.length > 300) this.history = this.history.slice(-300);
    if (meta && meta.goodRoad) this.goodRoad = String(meta.goodRoad);
  }
  saveState() {
    return { history: this.history.slice(-300), goodRoad: this.goodRoad };
  }
  loadState(s) {
    if (!s) return;
    if (Array.isArray(s.history)) this.history = s.history.filter(x => x === 'B' || x === 'P' || x === 'T').slice(-300);
    if (s.goodRoad) this.goodRoad = String(s.goodRoad);
  }
  _clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  _lastN(arr, n) { return arr.slice(Math.max(0, arr.length - n)); }
  _wilson(h, n, z = 1.645) {
    if (n < 1) return 0.5;
    const p = h / n, d = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
    return this._clamp(Math.round(((p + z * z / (2 * n) + d) / (1 + z * z / n)) * 100), 50, 96);
  }
  _streak(arr) {
    if (!arr.length) return { val: '', len: 0 };
    const l = arr[arr.length - 1]; let n = 1;
    for (let i = arr.length - 2; i >= 0; i--) { if (arr[i] === l) n++; else break; }
    return { val: l, len: n };
  }
  a_trend(arr) {
    const r5 = this._lastN(arr, 5).filter(c => c !== 'T'); if (r5.length < 3) return null;
    const b = r5.filter(c => c === 'B').length, p = r5.length - b;
    if (b === p) return null;
    const dom = b > p ? 'B' : 'P'; const ratio = Math.max(b, p) / r5.length;
    if (ratio < 0.6) return null;
    return { pred: dom, conf: this._clamp(52 + Math.round((ratio - .6) * 80), 52, 78), reason: `Gáº§n: ${dom}${Math.max(b, p)}/${r5.length}`, type: 'trend', name: 'Xu hÆ°á»›ng' };
  }
  a_revert(arr) {
    const r8 = this._lastN(arr, 8).filter(c => c !== 'T'); if (r8.length < 5) return null;
    const b = r8.filter(c => c === 'B').length, p = r8.length - b;
    const ratio = Math.max(b, p) / r8.length; if (ratio < 0.75) return null;
    const dom = b > p ? 'B' : 'P', opp = b > p ? 'P' : 'B';
    return { pred: opp, conf: this._clamp(54 + Math.round((ratio - .75) * 100), 54, 84), reason: `QuÃ¡ lá»‡ch ${dom}${Math.round(ratio * 100)}%â†’Ä‘áº£o`, type: 'counter', name: 'Äáº£o chiá»u' };
  }
  a_markov1(arr) {
    if (arr.length < 6) return null;
    const last = arr[arr.length - 1];
    const cnt = { B: { B: 0, P: 0, T: 0 }, P: { B: 0, P: 0, T: 0 }, T: { B: 0, P: 0, T: 0 } };
    for (let i = 0; i < arr.length - 1; i++) { const f = arr[i], t = arr[i + 1]; if (cnt[f] && cnt[f][t] !== undefined) cnt[f][t]++; }
    const row = cnt[last]; if (!row) return null;
    const tot = row.B + row.P + row.T; if (tot < 3) return null;
    const pred = row.B >= row.P ? 'B' : 'P'; const mx = Math.max(row.B, row.P);
    const conf = this._wilson(mx, tot); if (conf < 54) return null;
    return { pred, conf, reason: `${last}â†’${pred}: ${mx}/${tot}`, type: 'pattern', name: 'Markov-1' };
  }
  a_markov2(arr) {
    if (arr.length < 8) return null;
    const n = arr.length, last2 = arr[n - 2] + arr[n - 1]; const cnt = {};
    for (let i = 0; i < n - 2; i++) { const k = arr[i] + arr[i + 1]; if (!cnt[k]) cnt[k] = { B: 0, P: 0, T: 0 }; if (cnt[k][arr[i + 2]] !== undefined) cnt[k][arr[i + 2]]++; }
    const row = cnt[last2]; if (!row) return null;
    const tot = row.B + row.P + row.T; if (tot < 3) return null;
    const pred = row.B >= row.P ? 'B' : 'P'; const mx = Math.max(row.B, row.P);
    const conf = this._wilson(mx, tot, 1.5); if (conf < 55) return null;
    return { pred, conf, reason: `${last2}â†’${pred}: ${mx}/${tot}`, type: 'pattern', name: 'Markov-2' };
  }
  a_markov3(arr) {
    if (arr.length < 12) return null;
    const n = arr.length, last3 = arr[n - 3] + arr[n - 2] + arr[n - 1]; const cnt = {};
    for (let i = 0; i < n - 3; i++) { const k = arr[i] + arr[i + 1] + arr[i + 2]; if (!cnt[k]) cnt[k] = { B: 0, P: 0, T: 0 }; if (cnt[k][arr[i + 3]] !== undefined) cnt[k][arr[i + 3]]++; }
    const row = cnt[last3]; if (!row) return null;
    const tot = row.B + row.P + row.T; if (tot < 2) return null;
    const pred = row.B >= row.P ? 'B' : 'P'; const mx = Math.max(row.B, row.P);
    const conf = this._wilson(mx, tot, 1.3) + 2; if (conf < 56) return null;
    return { pred, conf, reason: `${last3}â†’${pred}: ${mx}/${tot}`, type: 'pattern', name: 'Markov-3' };
  }
  a_stkFollow(arr) {
    const { val, len } = this._streak(arr); if (val === 'T' || len < 2 || len > 5) return null;
    return { pred: val, conf: this._clamp(58 + len * 4, 58, 82), reason: `Bá»‡t ${val}Ã—${len}â†’theo`, type: 'trend', name: 'Streak+' };
  }
  a_stkBreak(arr) {
    const { val, len } = this._streak(arr); if (val === 'T' || len < 4) return null;
    return { pred: val === 'B' ? 'P' : 'B', conf: this._clamp(56 + len * 3, 56, 86), reason: `Bá»‡t ${val}Ã—${len}â†’báº»`, type: 'counter', name: 'Streak-' };
  }
  a_dragon(arr) {
    const { val, len } = this._streak(arr); if (val === 'T' || len < 7) return null;
    return { pred: val === 'B' ? 'P' : 'B', conf: this._clamp(72 + len * 2, 72, 92), reason: `Dragon ${val}Ã—${len}â†’Ä‘áº£o`, type: 'counter', name: 'Dragon' };
  }
  a_pingpong(arr) {
    const tail = this._lastN(arr.filter(c => c !== 'T'), 6); if (tail.length < 5) return null;
    let alt = 0; for (let i = 0; i < tail.length - 1; i++) if (tail[i] !== tail[i + 1]) alt++;
    if (alt < tail.length - 1) return null;
    const last = tail[tail.length - 1];
    return { pred: last === 'B' ? 'P' : 'B', conf: this._clamp(58 + alt * 3, 58, 80), reason: `Ping-Pong Ã—${alt + 1}`, type: 'pattern', name: 'Ping-Pong' };
  }
  a_pattern46(arr) {
    const noT = arr.filter(c => c !== 'T'); if (noT.length < 5) return null;
    const n = noT, L = n.length;
    if (L >= 5 && n[L - 1] === n[L - 2] && n[L - 3] === n[L - 4] && n[L - 1] !== n[L - 3])
      return { pred: n[L - 1], conf: 64, reason: 'AABBâ†’tiáº¿p Ä‘Ã´i', type: 'pattern', name: 'AABB' };
    if (L >= 6) {
      let ok = true; for (let i = L - 5; i < L - 1; i++) if (n[i] === n[i + 1]) { ok = false; break; }
      if (ok) return { pred: n[L - 1] === 'B' ? 'P' : 'B', conf: 68, reason: 'ABABABâ†’xen', type: 'pattern', name: 'ABAB' };
    }
    return null;
  }
  a_momentum(arr) {
    if (arr.length < 10) return null;
    const r5 = this._lastN(arr, 5), p5 = arr.slice(arr.length - 10, arr.length - 5);
    const rB = r5.filter(c => c === 'B').length, rP = r5.filter(c => c === 'P').length;
    const pB = p5.filter(c => c === 'B').length, pP = p5.filter(c => c === 'P').length;
    const mB = rB - pB, mP = rP - pP; if (Math.abs(mB - mP) < 2) return null;
    const pred = mB > mP ? 'B' : 'P'; const str = Math.abs(mB - mP);
    return { pred, conf: this._clamp(56 + str * 6, 56, 76), reason: `ÄÃ  ${pred} +${str}`, type: 'trend', name: 'Momentum' };
  }
  a_hotzone(arr) {
    if (arr.length < 12) return null;
    const z1 = this._lastN(arr, 4).filter(c => c !== 'T'), z2 = arr.slice(arr.length - 8, arr.length - 4).filter(c => c !== 'T');
    if (z1.length < 3 || z2.length < 3) return null;
    const b1 = z1.filter(c => c === 'B').length / z1.length, b2 = z2.filter(c => c === 'B').length / z2.length;
    const p1 = 1 - b1, p2 = 1 - b2;
    if (b1 > b2 + .25 && b1 > .6) return { pred: 'B', conf: this._clamp(56 + Math.round((b1 - .6) * 80), 56, 78), reason: `Hot Bâ†‘${Math.round(b1 * 100)}%`, type: 'trend', name: 'Hot Zone' };
    if (p1 > p2 + .25 && p1 > .6) return { pred: 'P', conf: this._clamp(56 + Math.round((p1 - .6) * 80), 56, 78), reason: `Hot Pâ†‘${Math.round(p1 * 100)}%`, type: 'trend', name: 'Hot Zone' };
    if (b1 >= .9) return { pred: 'P', conf: this._clamp(60 + Math.round((b1 - .75) * 80), 60, 86), reason: `ChÃ¡y Bâ†’Ä‘áº£o`, type: 'counter', name: 'Hot Zone' };
    if (p1 >= .9) return { pred: 'B', conf: this._clamp(60 + Math.round((p1 - .75) * 80), 60, 86), reason: `ChÃ¡y Pâ†’Ä‘áº£o`, type: 'counter', name: 'Hot Zone' };
    return null;
  }
  a_runlen(arr) {
    if (arr.length < 10) return null;
    const runs = []; let cur = arr[0], cnt = 1;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] === cur && arr[i] !== 'T') cnt++;
      else { runs.push({ v: cur, n: cnt }); cur = arr[i]; cnt = 1; }
    }
    runs.push({ v: cur, n: cnt }); if (runs.length < 3) return null;
    const avg = runs.slice(0, -1).reduce((a, r) => a + r.n, 0) / (runs.length - 1);
    const last = runs[runs.length - 1]; if (last.v === 'T') return null;
    if (last.n >= avg * 2) return { pred: last.v === 'B' ? 'P' : 'B', conf: this._clamp(58 + Math.round((last.n / avg - 2) * 10), 58, 82), reason: `Run ${last.n}â†’báº»`, type: 'counter', name: 'Run-Len' };
    if (last.n <= 1 && avg > 2) return { pred: last.v, conf: 60, reason: `Run ngáº¯nâ†’tiáº¿p`, type: 'trend', name: 'Run-Len' };
    return null;
  }
  a_bayesian(arr) {
    if (arr.length < 6) return null;
    let aB = 1, aP = 1;
    arr.forEach((c, i) => { const w = Math.pow(1.08, i); if (c === 'B') aB += w; else if (c === 'P') aP += w; });
    const tot = aB + aP, pB = aB / tot, diff = Math.abs(pB - .5); if (diff < .04) return null;
    const pred = pB > .5 ? 'B' : 'P';
    return { pred, conf: this._clamp(52 + Math.round(diff * 120), 52, 82), reason: `Bayes P(B)=${Math.round(pB * 100)}%`, type: 'stat', name: 'Bayes' };
  }
  getEnsemblePrediction() {
    const arr = this.history.slice();
    const goodRoad = this.goodRoad || '';
    if (arr.length < 5) {
      return {
        predictedResult: 'BANKER', confidence: 50, taiProb: 50, xiuProb: 50,
        reason: 'Baccarat: chá» Ä‘á»§ dá»¯ liá»‡u', gameType: 'baccarat',
        modelsUsed: 0, market: { regime: 'Chá»', trend: 'â€”' }
      };
    }
    const fns = [
      this.a_trend, this.a_revert, this.a_markov1, this.a_markov2, this.a_markov3,
      this.a_stkFollow, this.a_stkBreak, this.a_dragon, this.a_pingpong, this.a_pattern46,
      this.a_momentum, this.a_hotzone, this.a_runlen, this.a_bayesian
    ];
    const hits = [];
    for (const fn of fns) {
      try { const r = fn.call(this, arr); if (r) hits.push(r); } catch (e) {}
    }
    if (goodRoad) {
      const l = goodRoad.toLowerCase(); let ap = null;
      if ((l.includes('bá»‡t') || l.includes('dÃ­nh')) && l.includes('cÃ¡i')) ap = 'B';
      else if ((l.includes('bá»‡t') || l.includes('dÃ­nh')) && l.includes('con')) ap = 'P';
      else if (l.includes('Ä‘áº£o') || l.includes('xen')) {
        const la = arr[arr.length - 1]; if (la === 'B') ap = 'P'; else if (la === 'P') ap = 'B';
      }
      if (ap) hits.push({ pred: ap, conf: 62, reason: goodRoad, type: 'api', name: 'API-Road' });
    }
    this.lastAlgos = hits;
    if (!hits.length) {
      const l = arr[arr.length - 1];
      const cls = l === 'P' ? 'P' : 'B';
      return {
        predictedResult: cls === 'B' ? 'BANKER' : 'PLAYER', confidence: 52,
        taiProb: cls === 'B' ? 52 : 48, xiuProb: cls === 'B' ? 48 : 52,
        reason: 'Baccarat fallback', gameType: 'baccarat', modelsUsed: 0,
        market: { regime: 'Fallback', trend: cls }
      };
    }
    const tW = { trend: 0.85, counter: 0.9, pattern: 1.1, stat: 0.95, api: 0.75 };
    const tally = {};
    for (const h of hits) {
      const w = tW[h.type] || 1;
      if (!tally[h.pred]) tally[h.pred] = { wS: 0, wT: 0, cnt: 0, items: [] };
      tally[h.pred].wS += h.conf * w; tally[h.pred].wT += w; tally[h.pred].cnt++; tally[h.pred].items.push(h);
    }
    let bK = null, bSc = -1;
    for (const [k, v] of Object.entries(tally)) {
      const avg = v.wS / v.wT, cb = Math.min((v.cnt / hits.length) * 20, 20), sc = avg + cb;
      if (sc > bSc) { bSc = sc; bK = k; }
    }
    const win = tally[bK];
    const conf = this._clamp(Math.round(bSc), 52, 95);
    const cls = bK === 'P' ? 'P' : 'B';
    const topName = win.items.sort((a, b) => b.conf - a.conf).slice(0, 2).map(x => x.name).join('+');
    const bPct = Math.round((tally.B ? tally.B.wS / (tally.B.wT || 1) : 50));
    const pPct = 100 - Math.min(99, Math.max(1, cls === 'B' ? conf : 100 - conf));
    const bankerProb = cls === 'B' ? conf : 100 - conf;
    return {
      predictedResult: cls === 'B' ? 'BANKER' : 'PLAYER',
      confidence: conf,
      taiProb: bankerProb,
      xiuProb: 100 - bankerProb,
      reason: `Baccarat Â· ${topName} (${win.cnt}/${hits.length} vote)`,
      gameType: 'baccarat',
      modelsUsed: hits.length,
      market: { regime: win.cnt >= 4 && conf >= 74 ? 'Super' : 'Normal', trend: cls === 'B' ? 'BANKER' : 'PLAYER' },
      algos: hits.slice(0, 8)
    };
  }
}


// ================= SERVER WRAPPER =================
// Telegram bot implementation is embedded below; no separate telegram-bot.js needed.


function startTelegramBot(options) {
  const token = String(options.token || '').trim();
  const adminIds = new Set(String(options.adminIds || '').split(',').map(s => s.trim()).filter(Boolean));
  if (!token) return null;
  const apiRoot = `https://api.telegram.org/bot${token}`;
  let offset = 0;
  let stopped = false;

  async function tg(method, payload = {}) {
    const response = await fetch(`${apiRoot}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed (${response.status})`);
    return data.result;
  }
  const send = (chat_id, text, extra = {}) => tg('sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: false, ...extra });
  const sendPhoto = (chat_id, photo, extra = {}) => tg('sendPhoto', { chat_id, photo, parse_mode: 'HTML', ...extra });
  const isAdmin = id => adminIds.has(String(id));
  const displayName = from => [from?.first_name, from?.last_name].filter(Boolean).join(' ') || from?.username || 'Báº¡n';
  const plans = () => (options.getConfig().plans || []).filter(p => p.active !== false && Number(p.price) > 0 && Number(p.durationHours) > 0);
  const idShort = () => crypto.randomBytes(5).toString('hex').toUpperCase();
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fmt = n => Number(n || 0).toLocaleString('vi-VN');

  // â”€â”€â”€ USER MENU (command only, no buttons) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function showStart(chatId, name) {
    await send(chatId, 'âš¡ <b>TOOL TÆ¯NG Tá»¬NG</b> Â· VIP\n' + 'â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n' + 'Xin chÃ o <b>' + esc(name) + '</b>\n\n' + 'ðŸŽ <b>KEY FREE</b>\n' + 'â”œ /getkey â€” nhiá»‡m vá»¥ nhÃ³m\n' + 'â”” /free â€” giá»‘ng getkey\n' + '\n' + 'ðŸ’Ž <b>MUA KEY</b>\n' + 'â”œ /buy â€” chá»n gÃ³i + QR\n' + 'â”” /muakeytx â€” alias mua\n' + '\n' + 'ðŸ”§ <b>KEY</b>\n' + 'â”œ /resetkey â€” reset mÃ¡y auto\n' + 'â”” /status â€” yÃªu cáº§u chá» duyá»‡t\n' + '\n' + 'ðŸ”Ž <b>INFO</b>\n' + 'â”œ /tiktok @user\n' + 'â”” /fb user|link\n' + '\n' + 'â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n' + 'ðŸ”‘ KYT-... Â· 3 thiáº¿t bá»‹\n' + 'ðŸ’¬ @SunNetWin Â· /help\n');
  }

  async function showAdminHelp(chatId) {
    await send(chatId,
`ðŸ›  <b>ADMIN</b>
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ðŸ”‘ <b>Key</b>
/keys â€” danh sÃ¡ch
/key &lt;id|mÃ£&gt; â€” chi tiáº¿t
/createkey [giá»] [TB] [nhÃ£n]
/resetdevice &lt;id|mÃ£&gt;
/revoke &lt;id|mÃ£&gt;

ðŸ“© <b>YÃªu cáº§u</b>
/pending
/approve &lt;id&gt;
/reject &lt;id&gt;

âš™ï¸ <b>Cáº¥u hÃ¬nh</b>
/settask &lt;hÆ°á»›ng dáº«n nhiá»‡m vá»¥&gt;
/setpromo &lt;cÃ¢u copy quáº£ng cÃ¡o&gt;
/settaskphotos &lt;sá»‘ áº£nh&gt;
/settasktime &lt;giÃ¢y&gt;
/setmaint on|off [ná»™i dung]
/lockgame &lt;id&gt; Â· /unlockgame &lt;id&gt;
/lockcmd &lt;lá»‡nh&gt; Â· /unlockcmd &lt;lá»‡nh&gt;
/setbank &lt;NH&gt; &lt;STK&gt; &lt;chá»§&gt;
/addplan &lt;id&gt; &lt;nhÃ£n&gt; &lt;giÃ¡&gt; &lt;giá»&gt;
/delplan &lt;id&gt;
/plans
/settg &lt;user&gt;
/stats

VD: <code>/createkey 24 3 VIP 1N</code>`);
  }

  async function notifyAdmins(request, proofFileId) {
    if (!adminIds.size) return;
    const planText = request.type === 'payment'
      ? `ðŸ’Ž ${request.planLabel} Â· ${fmt(request.price)}Ä‘ Â· ${request.durationHours}h`
      : request.type === 'reset' ? 'ðŸ”„ Xin reset thiáº¿t bá»‹' : 'ðŸŽ¯ Key free';
    const caption =
`ðŸ“© <b>#${request.id}</b> Â· ${request.type === 'payment' ? 'ðŸ’³' : request.type === 'reset' ? 'ðŸ”„' : 'ðŸŽ¯'}
ðŸ‘¤ ${esc(request.userName)} (@${esc(request.username || 'â€”')})
ðŸ†” <code>${request.telegramId}</code>
${request.groupLink ? `ðŸ”— ${esc(request.groupLink)}\n` : ''}${request.resetKeyHint ? `ðŸ”‘ Key: <code>${esc(request.resetKeyHint)}</code>\n` : ''}${planText}
ðŸ• ${new Date(request.createdAt).toLocaleString('vi-VN')}

âœ… /approve ${request.id}
âŒ /reject ${request.id}`;
    for (const adminId of adminIds) {
      try {
        if (proofFileId) await sendPhoto(adminId, proofFileId, { caption });
        else await send(adminId, caption);
      } catch (e) {
        console.warn('[telegram] notify admin fail', adminId, e.message);
      }
    }
  }

  async function deliverReviewedKey(result, chatIdForReview) {
    if (!result || !result.ok || !result.request) return;
    const req = result.request;
    if (req.type === 'reset') {
      try {
        await send(req.telegramId,
`âœ… <b>RESET THÃ€NH CÃ”NG</b>
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ðŸ”‘ Key Ä‘Ã£ Ä‘Æ°á»£c xÃ³a háº¿t thiáº¿t bá»‹ cÅ©.
ðŸ“± Giá» Ä‘Äƒng nháº­p láº¡i tá»‘i Ä‘a <b>3 mÃ¡y</b>.`);
        if (options.markDelivered) options.markDelivered(req.id);
      } catch (e) {
        if (chatIdForReview) await send(chatIdForReview, `ÄÃ£ reset nhÆ°ng chÆ°a gá»­i Ä‘Æ°á»£c tin cho user: ${e.message}`).catch(() => null);
      }
      return;
    }
    if (!result.key) return;
    const expiresText = req.durationHours > 0
      ? new Date(Date.now() + req.durationHours * 3600000).toLocaleString('vi-VN')
      : 'KhÃ´ng háº¿t háº¡n';
    const text = '<b>âœ… KEY Sáº´N SÃ€NG</b>\n'
      + 'â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n'
      + 'ðŸ”‘ <code>' + result.key + '</code>\n\n'
      + 'ðŸ“¦ ' + esc(req.planLabel || 'Key free') + '\n'
      + 'â± ' + (req.durationHours > 0 ? req.durationHours + 'h' : 'VÄ©nh viá»…n') + '\n'
      + 'ðŸ“… ' + expiresText + '\n'
      + 'ðŸ“± 3 thiáº¿t bá»‹\n\n'
      + 'â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n'
      + 'ðŸŒ DÃ¡n key vÃ o web\n'
      + 'ðŸ”„ /resetkey khi full mÃ¡y\n'
      + 'ðŸ’¬ @SunNetWin';
    try {
      await send(req.telegramId, text);
      if (options.markDelivered) options.markDelivered(req.id);
    } catch (e) {
      console.warn('[telegram] deliver key fail', req.telegramId, e.message);
      if (chatIdForReview) await send(chatIdForReview, `Duyá»‡t OK nhÆ°ng chÆ°a gá»­i key: ${e.message}`).catch(() => null);
    }
  }

  async function createProofRequest(message, mode) {
    const from = message.from || {};
    const userId = String(from.id);
    const sessions = options.getSessions();
    const session = sessions[userId];
    if (!session || session.type !== mode) {
      await send(message.chat.id, 'âš ï¸ GÃµ /getkey hoáº·c /free hoáº·c /buy trÆ°á»›c khi gá»­i áº£nh.');
      return;
    }
    const photos = message.photo || [];
    if (!photos.length) return;
    const caption = String(message.caption || '').trim();
    const fileId = photos[photos.length - 1].file_id;
    const cfg = options.getConfig();
    const need = mode === 'group' ? (Number(cfg.groupTaskPhotos) || 3) : 1;
    const timeoutSec = Number(cfg.groupTaskTimeoutSec) || 300;

    // Timeout check for group task
    if (mode === 'group' && session.startedAt && (Date.now() - session.startedAt) > timeoutSec * 1000) {
      delete sessions[userId]; options.saveSessions(sessions);
      await send(message.chat.id, `â° Háº¿t ${timeoutSec} giÃ¢y. GÃµ /getkey Ä‘á»ƒ lÃ m láº¡i nhiá»‡m vá»¥.`);
      return;
    }

    if (mode === 'group') {
      session.proofs = session.proofs || [];
      session.proofs.push({ fileId, caption, at: Date.now() });
      options.saveSessions(sessions);
      const have = session.proofs.length;
      if (have < need) {
        await send(message.chat.id,
`ðŸ“· áº¢nh <b>${have}/${need}</b>
â³ CÃ²n <b>${need - have}</b> áº£nh
âŒ›ï¸ ~${Math.max(0, Math.ceil((timeoutSec * 1000 - (Date.now() - session.startedAt)) / 1000))}s`);
        return;
      }
      // Ä‘á»§ áº£nh
      const request = {
        id: idShort(), type: 'group', status: 'pending',
        telegramId: userId, username: from.username || '', userName: displayName(from),
        groupLink: caption || '', caption,
        proofFileId: session.proofs[0].fileId,
        proofFileIds: session.proofs.map(p => p.fileId),
        planId: null, planLabel: 'Key free',
        price: 0, durationHours: 5,
        createdAt: Date.now()
      };
      options.addRequest(request);
      delete sessions[userId]; options.saveSessions(sessions);
      await send(message.chat.id,
`âœ… ÄÃ£ ná»™p Ä‘á»§ <b>${need} áº£nh</b>
ðŸŽ« MÃ£: <b>#${request.id}</b>
â³ Chá» admin duyá»‡t â†’ nháº­n key
ðŸ“± 3 thiáº¿t bá»‹ Â· @SunNetWin`);
      // notify admins with all photos
      await notifyAdmins(request, request.proofFileId);
      for (let i = 1; i < (request.proofFileIds || []).length; i++) {
        try { await notifyAdmins(request, request.proofFileIds[i]); } catch {}
      }
      return;
    }

    // payment mode â€” 1 áº£nh
    let plan = plans().find(p => p.id === session.planId);
    if (!plan) {
      delete sessions[userId]; options.saveSessions(sessions);
      await send(message.chat.id, 'âš ï¸ GÃ³i háº¿t háº¡n. GÃµ /buy chá»n láº¡i.');
      return;
    }
    const request = {
      id: idShort(), type: 'payment', status: 'pending',
      telegramId: userId, username: from.username || '', userName: displayName(from),
      groupLink: '', caption, proofFileId: fileId,
      planId: plan.id, planLabel: plan.label || 'Key VIP',
      price: Number(plan.price || 0), durationHours: Number(plan.durationHours || 5),
      createdAt: Date.now()
    };
    options.addRequest(request);
    delete sessions[userId]; options.saveSessions(sessions);
    await send(message.chat.id, `âœ… Bill Ä‘Ã£ gá»­i Â· <b>#${request.id}</b>\nâ³ Admin duyá»‡t â†’ nháº­n key VIP`);
    await notifyAdmins(request, request.proofFileId);
  }

  function startGroupKeyTask(chatId, fromId, from) {
    const cfg = options.getConfig();
    const sessions = options.getSessions();
    const timeoutSec = Number(cfg.groupTaskTimeoutSec) || 300;
    const need = Number(cfg.groupTaskPhotos) || 3;
    const task = String(cfg.groupTaskText || 'LÃ m nhiá»‡m vá»¥ theo yÃªu cáº§u admin.');
    const promo = String(cfg.groupPromoText || '');
    sessions[fromId] = { type: 'group', startedAt: Date.now(), proofs: [] };
    options.saveSessions(sessions);
    return send(chatId,
`ðŸ“¸ <b>Nhiá»‡m vá»¥ quáº£ng cÃ¡o bot:</b>

${esc(task)}

${promo ? `ðŸ“Œ <b>CÃ¢u cáº§n sao chÃ©p:</b>\n<code>${esc(promo)}</code>\n` : ''}
ðŸ“· Gá»­i Ä‘á»§ <b>${need} áº£nh</b> chá»©ng minh vÃ o Ä‘Ã¢y
âŒ›ï¸ Báº¡n cÃ³ <b>${timeoutSec} giÃ¢y</b> Ä‘á»ƒ gá»­i áº£nh.
ðŸ“± Key free = <b>3 thiáº¿t bá»‹</b>`);
  }

  function resolveKey(query) {
    const q = String(query || '').trim();
    if (!q) return null;
    const list = options.getKeys ? options.getKeys() : [];
    let k = list.find(x => x.id === q || String(x.id).toLowerCase() === q.toLowerCase());
    if (k) return k;
    if (options.findKey) return options.findKey(q);
    return null;
  }

  // â”€â”€â”€ TikTok / Facebook lookup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function lookupTikTok(input) {
    let username = String(input || '').trim();
    const urlMatch = username.match(/tiktok\.com\/@([A-Za-z0-9._]+)/i);
    if (urlMatch) username = urlMatch[1];
    username = username.replace(/^@/, '').split(/[/?#\s]/)[0];
    if (!username || username.length < 2) throw new Error('Username/link khÃ´ng há»£p lá»‡.');
    const profileUrl = `https://www.tiktok.com/@${username}`;
    const headers = {
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'accept-language': 'vi-VN,vi;q=0.9,en;q=0.8'
    };
    let info = {
      username, nickname: username, avatar: '', bio: '', verified: false, private: false,
      followers: null, following: null, likes: null, videos: null, createTime: null, profileUrl
    };
    // 1) oEmbed â€” nickname + thumb
    try {
      const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(profileUrl)}`;
      const r = await fetch(oembedUrl, { signal: AbortSignal.timeout(8000), headers });
      if (r.ok) {
        const d = await r.json();
        info.nickname = d.author_name || d.title || username;
        info.avatar = d.thumbnail_url || '';
        info.bio = (d.title || '').slice(0, 200);
      }
    } catch {}
    // 2) HTML page â€” SIGI_STATE / universal data for stats
    try {
      const page = await fetch(profileUrl, { signal: AbortSignal.timeout(12000), headers });
      if (page.ok) {
        const html = await page.text();
        let jsonStr = null;
        const m1 = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
        const m2 = html.match(/<script id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/);
        if (m1) jsonStr = m1[1];
        else if (m2) jsonStr = m2[1];
        if (jsonStr) {
          const data = JSON.parse(jsonStr);
          // try multiple paths
          let user = null;
          const def = data?.__DEFAULT_SCOPE__ || data;
          const detail = def?.['webapp.user-detail'] || def?.UserModule || def;
          if (detail?.userInfo?.user) user = detail.userInfo;
          else if (detail?.users) {
            const first = Object.values(detail.users)[0];
            if (first) user = { user: first, stats: detail.stats?.[first.id] || detail.statsList?.[first.id] };
          }
          if (user?.user) {
            const u = user.user;
            const s = user.stats || {};
            info.nickname = u.nickname || info.nickname;
            info.avatar = u.avatarLarger || u.avatarMedium || u.avatarThumb || info.avatar;
            info.bio = u.signature || info.bio;
            info.verified = !!u.verified;
            info.private = !!u.privateAccount;
            info.followers = s.followerCount ?? null;
            info.following = s.followingCount ?? null;
            info.likes = s.heartCount ?? s.heart ?? null;
            info.videos = s.videoCount ?? null;
            if (u.createTime) info.createTime = Number(u.createTime) * (String(u.createTime).length <= 10 ? 1000 : 1);
          }
        }
      }
    } catch {}
    if (!info.nickname && !info.avatar) throw new Error('KhÃ´ng láº¥y Ä‘Æ°á»£c info (user áº©n / khÃ´ng tá»“n táº¡i).');
    return info;
  }

  async function lookupFacebook(input) {
    let raw = String(input || '').trim();
    let url = raw;
    if (!/^https?:\/\//i.test(raw)) {
      raw = raw.replace(/^@/, '');
      url = `https://www.facebook.com/${encodeURIComponent(raw)}`;
    }
    const headers = {
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'accept-language': 'vi-VN,vi;q=0.9,en;q=0.8'
    };
    const info = {
      url, author: '', avatar: '', bio: '', type: 'profile',
      followers: null, likes: null, provider: 'Facebook'
    };
    // oEmbed (works better for posts/pages)
    try {
      const oembed = `https://www.facebook.com/plugins/post/oembed.json?url=${encodeURIComponent(url)}`;
      const r = await fetch(oembed, { signal: AbortSignal.timeout(10000), headers });
      if (r.ok) {
        const d = await r.json();
        info.author = d.author_name || '';
        info.url = d.author_url || url;
        info.bio = (d.html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
        info.provider = d.provider_name || 'Facebook';
        if (d.thumbnail_url) info.avatar = d.thumbnail_url;
      }
    } catch {}
    // HTML / Open Graph
    try {
      const page = await fetch(url, { signal: AbortSignal.timeout(12000), headers, redirect: 'follow' });
      if (page.ok) {
        const html = await page.text();
        const og = (prop) => {
          const m = html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
            || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i'));
          return m ? m[1] : '';
        };
        const nameMeta = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
        if (!info.author) info.author = og('og:title') || raw.split('/').filter(Boolean).pop() || 'Facebook';
        if (!info.avatar) info.avatar = og('og:image') || '';
        if (!info.bio) info.bio = (og('og:description') || (nameMeta && nameMeta[1]) || '').slice(0, 220);
        info.type = og('og:type') || info.type;
        // try follower-ish numbers from description
        const nums = String(info.bio).match(/([\d.,]+)\s*(followers|ngÆ°á»i theo dÃµi|likes|lÆ°á»£t thÃ­ch)/i);
        if (nums) {
          const n = parseFloat(nums[1].replace(/\./g, '').replace(',', '.'));
          if (/follow|theo dÃµi/i.test(nums[2])) info.followers = n;
          else info.likes = n;
        }
      }
    } catch {}
    if (!info.author) {
      info.author = raw.replace(/^https?:\/\/(www\.)?facebook\.com\//i, '').split(/[/?#]/)[0] || 'Facebook';
      info.bio = info.bio || 'KhÃ´ng láº¥y Ä‘á»§ chi tiáº¿t (profile private / cáº§n Ä‘Äƒng nháº­p).';
    }
    return info;
  }

  // â”€â”€â”€ Admin commands â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function handleAdminCommand(message, text) {
    const chatId = message.chat.id;
    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase().replace(/^\//, '').split('@')[0];
    const args = parts.slice(1);
    const argText = text.replace(/^\/\S+\s*/, '').trim();

    if (cmd === 'admin' || cmd === 'panel') return showAdminHelp(chatId);

    if (cmd === 'stats') {
      const keys = options.getKeys ? options.getKeys() : [];
      const active = keys.filter(k => k.status === 'active' && !(options.isExpired?.(k))).length;
      const pending = (options.getRequests ? options.getRequests() : []).filter(r => r.status === 'pending').length;
      return send(chatId, `ðŸ“Š <b>STATS</b>\nðŸ”‘ Key: ${keys.length} Â· âœ… Active: ${active}\nâ³ Pending: ${pending}`);
    }

    if (cmd === 'keys') {
      const keys = (options.getKeys ? options.getKeys() : []).slice().sort((a, b) => (b.created || 0) - (a.created || 0)).slice(0, 12);
      if (!keys.length) return send(chatId, 'ðŸ“­ ChÆ°a cÃ³ key.');
      const lines = keys.map(k => {
        const d = (k.deviceHashes || []).length;
        const lim = k.deviceLimit || 3;
        const st = k.status === 'revoked' ? 'ðŸš«' : (options.isExpired?.(k) ? 'â°' : 'âœ…');
        return `${st} <code>${k.id}</code> Â· ${esc(k.label)} Â· ðŸ“±${d}/${lim}`;
      });
      return send(chatId, `ðŸ”‘ <b>KEYS</b>\n` + lines.join('\n'));
    }

    if (cmd === 'key') {
      if (!args[0]) return send(chatId, 'ðŸ“Œ <code>/key &lt;id|mÃ£&gt;</code>');
      const k = resolveKey(args[0]);
      if (!k) return send(chatId, 'âŒ KhÃ´ng tÃ¬m tháº¥y.');
      const d = (k.deviceHashes || []).length;
      return send(chatId,
`ðŸ”‘ <b>${esc(k.label)}</b>
ðŸ†” <code>${k.id}</code>
ðŸ“Š ${k.status} Â· ðŸ“± ${d}/${k.deviceLimit || 3}
â± ${k.expiresAt ? new Date(k.expiresAt).toLocaleString('vi-VN') : 'âˆž'}
ðŸ“¡ ${k.source || 'â€”'} Â· TG ${k.telegramId || 'â€”'}`);
    }

    if (cmd === 'createkey') {
      const hours = Math.max(0, parseInt(args[0], 10) || 24);
      const devices = Math.max(1, Math.min(10, parseInt(args[1], 10) || 3));
      const label = args.slice(2).join(' ') || `Key ${hours}h`;
      try {
        const issued = options.createKey({ label, durationHours: hours, deviceLimit: devices, source: 'telegram-admin' });
        return send(chatId,
`âœ… <b>Táº O KEY</b>
ðŸ”‘ <code>${issued.plainKey}</code>
ðŸ†” <code>${issued.record.id}</code>
â± ${hours || 'âˆž'}h Â· ðŸ“± ${devices} TB`);
      } catch (e) {
        return send(chatId, `âŒ ${e.message}`);
      }
    }

    if (cmd === 'resetdevice' || cmd === 'resetdevices') {
      if (!args[0]) return send(chatId, 'ðŸ“Œ <code>/resetdevice &lt;id|mÃ£&gt;</code>');
      const k = resolveKey(args[0]);
      if (!k) return send(chatId, 'âŒ KhÃ´ng tÃ¬m tháº¥y.');
      k.deviceHashes = [];
      if (options.saveKeys) options.saveKeys();
      return send(chatId, `ðŸ”„ ÄÃ£ reset ðŸ“± key <code>${k.id}</code>\nGiá»›i háº¡n: ${k.deviceLimit || 3} TB`);
    }

    if (cmd === 'revoke') {
      if (!args[0]) return send(chatId, 'ðŸ“Œ <code>/revoke &lt;id|mÃ£&gt;</code>');
      const k = resolveKey(args[0]);
      if (!k) return send(chatId, 'âŒ KhÃ´ng tÃ¬m tháº¥y.');
      k.status = 'revoked';
      if (options.saveKeys) options.saveKeys();
      return send(chatId, `ðŸš« ÄÃ£ thu há»“i <code>${k.id}</code>`);
    }

    if (cmd === 'pending') {
      const list = (options.getRequests ? options.getRequests() : []).filter(r => r.status === 'pending').slice(0, 15);
      if (!list.length) return send(chatId, 'âœ… KhÃ´ng cÃ³ pending.');
      const lines = list.map(r => {
        const icon = r.type === 'payment' ? 'ðŸ’³' : r.type === 'reset' ? 'ðŸ”„' : 'ðŸŽ¯';
        return `${icon} <code>${r.id}</code> Â· ${esc(r.userName)} Â· ${new Date(r.createdAt).toLocaleString('vi-VN')}`;
      });
      return send(chatId, `â³ <b>PENDING</b>\n` + lines.join('\n') + `\n\nâœ… /approve ID\nâŒ /reject ID`);
    }

    if (cmd === 'approve' || cmd === 'reject') {
      if (!args[0]) return send(chatId, `ðŸ“Œ <code>/${cmd} &lt;id&gt;</code>`);
      const approved = cmd === 'approve';
      // special handling for reset type
      const req = (options.getRequests ? options.getRequests() : []).find(r => r.id === args[0]);
      if (req && req.type === 'reset' && approved) {
        const k = resolveKey(req.resetKeyPlain || req.resetKeyHint || '');
        if (!k) {
          // try by id stored
          const byId = (options.getKeys ? options.getKeys() : []).find(x => x.id === req.resetKeyId);
          if (byId) {
            byId.deviceHashes = [];
            if (options.saveKeys) options.saveKeys();
          } else {
            return send(chatId, 'âŒ KhÃ´ng tÃ¬m tháº¥y key Ä‘á»ƒ reset.');
          }
        } else {
          k.deviceHashes = [];
          if (options.saveKeys) options.saveKeys();
        }
      }
      const result = options.reviewRequest(args[0], approved, `telegram-cmd:${message.from.id}`);
      if (!result.ok) return send(chatId, `âŒ ${result.error || 'Lá»—i'}`);
      if (approved) await deliverReviewedKey(result, chatId);
      else await send(result.request.telegramId, `âŒ YÃªu cáº§u #${result.request.id} bá»‹ tá»« chá»‘i.`).catch(() => null);
      return send(chatId, approved ? `âœ… #${args[0]}` : `ðŸš« #${args[0]}`);
    }

    if (cmd === 'settask') {
      if (!argText) return send(chatId, 'ðŸ“Œ <code>/settask &lt;ná»™i dung hÆ°á»›ng dáº«n&gt;</code>');
      const cfg = options.getConfig();
      cfg.groupTaskText = argText.slice(0, 2000);
      if (options.saveConfig) options.saveConfig(cfg);
      return send(chatId, `âœ… Nhiá»‡m vá»¥ nhÃ³m:\n${esc(cfg.groupTaskText)}`);
    }
    if (cmd === 'setpromo') {
      if (!argText) return send(chatId, 'ðŸ“Œ <code>/setpromo cÃ¢u quáº£ng cÃ¡o cáº§n copy</code>');
      const cfg = options.getConfig();
      cfg.groupPromoText = argText.slice(0, 500);
      if (options.saveConfig) options.saveConfig(cfg);
      return send(chatId, `âœ… CÃ¢u promo:\n<code>${esc(cfg.groupPromoText)}</code>`);
    }
    if (cmd === 'settaskphotos') {
      const n = parseInt(args[0], 10);
      if (!(n >= 1 && n <= 10)) return send(chatId, 'ðŸ“Œ <code>/settaskphotos 3</code> (1-10)');
      const cfg = options.getConfig();
      cfg.groupTaskPhotos = n;
      if (options.saveConfig) options.saveConfig(cfg);
      return send(chatId, `âœ… Cáº§n ${n} áº£nh Ä‘á»ƒ nháº­n key free`);
    }
    if (cmd === 'settasktime') {
      const n = parseInt(args[0], 10);
      if (!(n >= 60 && n <= 3600)) return send(chatId, 'ðŸ“Œ <code>/settasktime 300</code> (60-3600s)');
      const cfg = options.getConfig();
      cfg.groupTaskTimeoutSec = n;
      if (options.saveConfig) options.saveConfig(cfg);
      return send(chatId, `âœ… Thá»i gian nhiá»‡m vá»¥: ${n}s`);
    }
    if (cmd === 'setmaint') {
      const cfg = options.getConfig();
      const on = ['1','on','true','yes','bat'].includes(String(args[0]||'').toLowerCase());
      const off = ['0','off','false','no','tat'].includes(String(args[0]||'').toLowerCase());
      if (!on && !off) return send(chatId, 'ðŸ“Œ <code>/setmaint on|off [ná»™i dung]</code>\n<code>/lockgame id</code> <code>/unlockgame id</code>\n<code>/lockcmd getkey</code> <code>/unlockcmd getkey</code>');
      cfg.maintenance = cfg.maintenance || { enabled:false, message:'', lockedGames:[], lockedCommands:[] };
      cfg.maintenance.enabled = on;
      if (argText.replace(/^\S+\s*/, '').trim()) cfg.maintenance.message = argText.replace(/^\S+\s*/, '').trim().slice(0,500);
      if (options.saveConfig) options.saveConfig(cfg);
      return send(chatId, (on?'ðŸ›  Báº­t báº£o trÃ¬':'âœ… Táº¯t báº£o trÃ¬') + (cfg.maintenance.message ? '\n'+cfg.maintenance.message : ''));
    }
    if (cmd === 'lockgame' || cmd === 'unlockgame') {
      const id = String(args[0]||'').toLowerCase();
      if (!id) return send(chatId, 'ðŸ“Œ <code>/lockgame sunwin</code>');
      const cfg = options.getConfig();
      cfg.maintenance = cfg.maintenance || { enabled:false, message:'', lockedGames:[], lockedCommands:[] };
      const list = new Set(cfg.maintenance.lockedGames || []);
      if (cmd === 'lockgame') list.add(id); else list.delete(id);
      cfg.maintenance.lockedGames = [...list];
      if (options.saveConfig) options.saveConfig(cfg);
      return send(chatId, `ðŸŽ® lockedGames: <code>${cfg.maintenance.lockedGames.join(', ')||'â€”'}</code>`);
    }
    if (cmd === 'lockcmd' || cmd === 'unlockcmd') {
      const id = String(args[0]||'').toLowerCase().replace(/^\//,'');
      if (!id) return send(chatId, 'ðŸ“Œ <code>/lockcmd getkey</code>');
      const cfg = options.getConfig();
      cfg.maintenance = cfg.maintenance || { enabled:false, message:'', lockedGames:[], lockedCommands:[] };
      const list = new Set(cfg.maintenance.lockedCommands || []);
      if (cmd === 'lockcmd') list.add(id); else list.delete(id);
      cfg.maintenance.lockedCommands = [...list];
      if (options.saveConfig) options.saveConfig(cfg);
      return send(chatId, `âŒ¨ï¸ lockedCommands: <code>${cfg.maintenance.lockedCommands.join(', ')||'â€”'}</code>`);
    }

    if (cmd === 'setbank') {
      if (args.length < 3) return send(chatId, 'ðŸ“Œ <code>/setbank &lt;NH&gt; &lt;STK&gt; &lt;chá»§&gt;</code>');
      const cfg = options.getConfig();
      cfg.bankCode = args[0];
      cfg.bankAccount = args[1];
      cfg.bankAccountName = args.slice(2).join(' ');
      if (options.saveConfig) options.saveConfig(cfg);
      return send(chatId, `âœ… ðŸ¦ ${esc(cfg.bankCode)} Â· <code>${esc(cfg.bankAccount)}</code>\nðŸ‘¤ ${esc(cfg.bankAccountName)}`);
    }

    if (cmd === 'settg') {
      const u = (args[0] || '').replace(/^@/, '');
      const cfg = options.getConfig();
      cfg.telegramUsername = u;
      if (options.saveConfig) options.saveConfig(cfg);
      return send(chatId, `âœ… Bot: @${esc(u) || 'â€”'}`);
    }

    if (cmd === 'addplan') {
      if (args.length < 4) return send(chatId, 'ðŸ“Œ <code>/addplan id nhÃ£n giÃ¡ giá»</code>');
      const id = args[0].toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
      const price = parseInt(args[args.length - 2], 10);
      const hours = parseInt(args[args.length - 1], 10);
      const label = args.slice(1, -2).join(' ').replace(/^["']|["']$/g, '');
      if (!id || !label || !price || !hours) return send(chatId, 'âŒ Thiáº¿u thÃ´ng tin.');
      const cfg = options.getConfig();
      cfg.plans = cfg.plans || [];
      if (cfg.plans.some(p => p.id === id)) return send(chatId, 'âŒ ID trÃ¹ng.');
      cfg.plans.push({ id, label, price, durationHours: hours, active: true });
      if (options.saveConfig) options.saveConfig(cfg);
      return send(chatId, `âœ… ðŸ’Ž ${esc(label)} Â· ${fmt(price)}Ä‘ Â· ${hours}h`);
    }

    if (cmd === 'delplan') {
      if (!args[0]) return send(chatId, 'ðŸ“Œ <code>/delplan &lt;id&gt;</code>');
      const cfg = options.getConfig();
      const before = (cfg.plans || []).length;
      cfg.plans = (cfg.plans || []).filter(p => p.id !== args[0].toLowerCase());
      if (options.saveConfig) options.saveConfig(cfg);
      return send(chatId, cfg.plans.length < before ? `âœ… XÃ³a ${args[0]}` : 'âŒ KhÃ´ng tháº¥y.');
    }

    if (cmd === 'plans') {
      const list = plans();
      if (!list.length) return send(chatId, 'ðŸ“­ ChÆ°a cÃ³ gÃ³i.');
      return send(chatId, `ðŸ’Ž <b>GÃ“I</b>\n` + list.map(p => `â€¢ <code>${p.id}</code> ${esc(p.label)} Â· ${fmt(p.price)}Ä‘ Â· ${p.durationHours}h`).join('\n'));
    }

    return send(chatId, 'â“ GÃµ /admin');
  }

  // â”€â”€â”€ Message router â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async function showBuyMenu(chatId) {
    const available = plans();
    if (!available.length) return send(chatId, 'ðŸ“­ Táº¡m háº¿t gÃ³i.\n/getkey nháº­n free Â· @SunNetWin');
    const lines = available.map((p, i) => {
      const days = p.durationHours >= 24 ? (Math.round(p.durationHours / 24) + ' ngÃ y') : (p.durationHours + 'h');
      return '<b>' + (i + 1) + '. ' + esc(p.label) + '</b>\n    ðŸ’° ' + fmt(p.price) + 'Ä‘  Â·  â± ' + days;
    }).join('\n\n');
    const keyboard = {
      inline_keyboard: available.map(p => {
        const days = p.durationHours >= 24 ? (Math.round(p.durationHours / 24) + ' ngÃ y') : (p.durationHours + 'h');
        return [{ text: p.label + ' Â· ' + fmt(p.price) + 'Ä‘ Â· ' + days, callback_data: 'pay:' + p.id }];
      })
    };
    await send(chatId,
      'ðŸ’³ <b>MUA KEY VIP</b>\n' + 
      'â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n' + 
      'Chá»n gÃ³i ðŸ‘‡\n' + 
      '\n' + lines + '\n\n' +
      'â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n' + 
      'âœ… 3 thiáº¿t bá»‹ Â· Reset free\n' + 
      'âš¡ TX realtime Â· @SunNetWin\n',
      { reply_markup: keyboard }
    );
  }

  async function startPayment(chatId, fromId, planId) {
    const plan = plans().find(p => p.id === String(planId || '').toLowerCase());
    if (!plan) return send(chatId, 'âŒ GÃ³i khÃ´ng tá»“n táº¡i. GÃµ /buy Ä‘á»ƒ chá»n láº¡i.');
    const config = options.getConfig();
    if (!config.bankCode || !config.bankAccount || !config.bankAccountName) {
      return send(chatId, 'âš ï¸ Admin chÆ°a cáº¥u hÃ¬nh ngÃ¢n hÃ ng VietQR.\nLiÃªn há»‡ @SunNetWin');
    }
    const addInfo = `KEYVIP ${fromId}`;
    const qr = `https://img.vietqr.io/image/${encodeURIComponent(config.bankCode)}-${encodeURIComponent(config.bankAccount)}-compact2.jpg?amount=${encodeURIComponent(String(plan.price))}&addInfo=${encodeURIComponent(addInfo)}&accountName=${encodeURIComponent(config.bankAccountName)}`;
    const sessions = options.getSessions();
    sessions[fromId] = { type: 'payment', planId: plan.id, startedAt: Date.now() };
    options.saveSessions(sessions);
    const days = plan.durationHours >= 24 ? `${Math.round(plan.durationHours / 24)} ngÃ y` : `${plan.durationHours}h`;
    await sendPhoto(chatId, qr, {
      caption: '<b>ðŸ’³ THANH TOÃN</b>\n'
        + 'â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n'
        + 'ðŸ“¦ <b>' + esc(plan.label) + '</b>\n'
        + 'ðŸ’° <b>' + fmt(plan.price) + 'Ä‘</b> Â· â± ' + days + '\n\n'
        + 'ðŸ¦ <b>' + esc(config.bankCode) + '</b>\n'
        + 'ðŸ’³ <code>' + esc(config.bankAccount) + '</code>\n'
        + 'ðŸ‘¤ ' + esc(config.bankAccountName) + '\n\n'
        + 'ðŸ“ CK: <code>' + addInfo + '</code>\n\n'
        + 'â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n'
        + 'ðŸ“· Gá»­i <b>áº£nh bill</b> sau khi CK\n'
        + 'â³ Duyá»‡t xong â†’ nháº­n key\n'
        + 'ðŸ’¬ @SunNetWin'
    });
  }

  async function handleCallback(cq) {
    if (!cq) return;
    const data = String(cq.data || '');
    const chatId = cq.message?.chat?.id;
    const fromId = String(cq.from?.id || '');
    try { await tg('answerCallbackQuery', { callback_query_id: cq.id }); } catch {}
    if (!chatId) return;
    if (data.startsWith('pay:')) {
      const planId = data.slice(4);
      return startPayment(chatId, fromId, planId);
    }
  }

  async function handleMessage(message) {
    if (!message || !message.chat) return;
    const from = message.from || {};
    const text = String(message.text || '').trim();
    const chatId = message.chat.id;
    const fromId = String(from.id);
    const sessions = options.getSessions();

    // photo proofs
    if (message.photo?.length) {
      const session = sessions[fromId];
      if (session?.type === 'group') return createProofRequest(message, 'group');
      if (session?.type === 'payment') return createProofRequest(message, 'payment');
      return send(chatId, 'âš ï¸ GÃµ /free hoáº·c /buy trÆ°á»›c.');
    }

    if (!text) return;

    // admin commands first
    if (text.startsWith('/') && isAdmin(fromId)) {
      const cmd = text.split(/\s+/)[0].toLowerCase().replace(/^\//, '').split('@')[0];
      const adminCmds = new Set(['admin', 'panel', 'stats', 'keys', 'key', 'createkey', 'resetdevice', 'resetdevices', 'revoke', 'pending', 'approve', 'reject', 'settask', 'setpromo', 'settaskphotos', 'settasktime', 'setmaint', 'lockgame', 'unlockgame', 'lockcmd', 'unlockcmd', 'setbank', 'settg', 'addplan', 'delplan', 'plans']);
      if (adminCmds.has(cmd)) return handleAdminCommand(message, text);
    }

    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase().replace(/^\//, '').split('@')[0];
    const args = parts.slice(1);
    const argText = text.replace(/^\/\S+\s*/, '').trim();

    // Báº£o trÃ¬ / khÃ³a lá»‡nh (admin váº«n dÃ¹ng Ä‘Æ°á»£c)
    if (!isAdmin(fromId)) {
      const mt = (options.getConfig && options.getConfig().maintenance) || {};
      if (mt.enabled && Array.isArray(mt.lockedCommands) && mt.lockedCommands.includes(cmd)) {
        return send(chatId, 'ðŸ›  ' + (mt.message || 'Lá»‡nh Ä‘ang báº£o trÃ¬.'));
      }
      if (mt.enabled && Array.isArray(mt.lockedCommands) && mt.lockedCommands.includes('*')) {
        return send(chatId, 'ðŸ›  ' + (mt.message || 'Bot Ä‘ang báº£o trÃ¬.'));
      }
    }

    if (cmd === 'start') return showStart(chatId, displayName(from));

    if (cmd === 'status') {
      const pending = (options.getRequests ? options.getRequests() : []).filter(r => r.telegramId === fromId && r.status === 'pending');
      if (!pending.length) return send(chatId, 'âœ… KhÃ´ng cÃ³ yÃªu cáº§u chá».');
      return send(chatId, `â³ <b>${pending.length} yÃªu cáº§u</b>\n` + pending.map(r => `â€¢ #${r.id} ${r.type === 'payment' ? 'ðŸ’³' : r.type === 'reset' ? 'ðŸ”„' : 'ðŸŽ¯'}`).join('\n'));
    }

    if (cmd === 'free' || cmd === 'getkey') {
      return startGroupKeyTask(chatId, fromId, from);
    }

    if (cmd === 'buy' || cmd === 'muakeytx' || cmd === 'muakey') {
      return showBuyMenu(chatId);
    }

    if (cmd === 'pay') {
      const planId = (args[0] || '').toLowerCase();
      return startPayment(chatId, fromId, planId);
    }

    if (cmd === 'help') {
      return showStart(chatId, displayName(from));
    }

    if (cmd === 'resetkey') {
      if (!argText) {
        sessions[fromId] = { type: 'await_reset_key', startedAt: Date.now() };
        options.saveSessions(sessions);
        return send(chatId,
`ðŸ”„ <b>RESET THIáº¾T Bá»Š</b>
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
Gá»­i <b>mÃ£ key</b> cáº§n reset.
âš¡ Tá»± Ä‘á»™ng Â· khÃ´ng cáº§n admin
â± Thá»i háº¡n key <b>khÃ´ng Ä‘á»•i</b>`);
      }
      const plain = argText.trim();
      const k = options.findKey ? options.findKey(plain) : null;
      if (!k) return send(chatId, 'âŒ Key khÃ´ng há»£p lá»‡.');
      if (k.status === 'revoked') return send(chatId, 'ðŸš« Key Ä‘Ã£ bá»‹ thu há»“i.');
      if (options.isExpired?.(k)) return send(chatId, 'â° Key Ä‘Ã£ háº¿t háº¡n.');
      k.deviceHashes = [];
      if (options.saveKeys) options.saveKeys();
      delete sessions[fromId]; options.saveSessions(sessions);
      const exp = k.expiresAt ? new Date(k.expiresAt).toLocaleString('vi-VN') : 'KhÃ´ng háº¿t háº¡n';
      return send(chatId,
`âœ… <b>RESET XONG</b>
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ðŸ”‘ <code>${esc(k.id)}</code>
ðŸ“± ÄÃ£ xÃ³a háº¿t thiáº¿t bá»‹ cÅ©
â± Háº¡n key: <b>${exp}</b> (khÃ´ng Ä‘á»•i)
ðŸ‘‰ ÄÄƒng nháº­p láº¡i trÃªn web (tá»‘i Ä‘a ${k.deviceLimit || 3} mÃ¡y)`);
    }

    // waiting for reset key text â€” auto reset, no admin
    if (sessions[fromId]?.type === 'await_reset_key' && !text.startsWith('/')) {
      const plain = text.trim();
      const k = options.findKey ? options.findKey(plain) : null;
      if (!k) return send(chatId, 'âŒ Key khÃ´ng há»£p lá»‡. Gá»­i láº¡i hoáº·c /resetkey');
      if (k.status === 'revoked') return send(chatId, 'ðŸš« Key Ä‘Ã£ bá»‹ thu há»“i.');
      if (options.isExpired?.(k)) return send(chatId, 'â° Key Ä‘Ã£ háº¿t háº¡n.');
      k.deviceHashes = [];
      if (options.saveKeys) options.saveKeys();
      delete sessions[fromId]; options.saveSessions(sessions);
      const exp = k.expiresAt ? new Date(k.expiresAt).toLocaleString('vi-VN') : 'KhÃ´ng háº¿t háº¡n';
      return send(chatId,
`âœ… <b>RESET XONG</b>
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ðŸ”‘ <code>${esc(k.id)}</code>
ðŸ“± ÄÃ£ xÃ³a háº¿t thiáº¿t bá»‹ cÅ©
â± Háº¡n key: <b>${exp}</b> (khÃ´ng Ä‘á»•i)
ðŸ‘‰ ÄÄƒng nháº­p láº¡i trÃªn web (tá»‘i Ä‘a ${k.deviceLimit || 3} mÃ¡y)`);
    }

    if (cmd === 'tiktok') {
      if (!argText) return send(chatId, 'ðŸ“Œ <code>/tiktok @user</code>\nhoáº·c link profile');
      await send(chatId, 'â³ Äang láº¥y info TikTok...');
      try {
        const info = await lookupTikTok(argText);
        const fmtN = n => n == null ? 'â€”' : Number(n).toLocaleString('vi-VN');
        const created = info.createTime ? new Date(info.createTime).toLocaleString('vi-VN') : 'â€”';
        const text =
`ðŸ“± <b>TIKTOK INFO</b>
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ðŸ‘¤ <b>${esc(info.nickname)}</b> ${info.verified ? 'âœ…' : ''}
ðŸ†” @${esc(info.username)}
${info.private ? 'ðŸ”’ Private' : 'ðŸŒ Public'}
ðŸ“ ${esc((info.bio || 'â€”').slice(0, 160))}

ðŸ‘¥ Followers: <b>${fmtN(info.followers)}</b>
âž¡ï¸ Following: <b>${fmtN(info.following)}</b>
â¤ï¸ Likes: <b>${fmtN(info.likes)}</b>
ðŸŽ¬ Videos: <b>${fmtN(info.videos)}</b>
ðŸ“… Táº¡o: ${created}
ðŸ”— ${info.profileUrl}`;
        if (info.avatar) {
          try {
            await sendPhoto(chatId, info.avatar, { caption: text });
            return;
          } catch {}
        }
        return send(chatId, text);
      } catch (e) {
        return send(chatId, `âŒ ${e.message}`);
      }
    }

    if (cmd === 'fb' || cmd === 'facebook') {
      if (!argText) return send(chatId, 'ðŸ“Œ <code>/fb username</code>\nhoáº·c link profile');
      await send(chatId, 'â³ Äang láº¥y info Facebook...');
      try {
        const info = await lookupFacebook(argText);
        const fmtN = n => n == null ? 'â€”' : Number(n).toLocaleString('vi-VN');
        const text =
`ðŸ“˜ <b>FACEBOOK INFO</b>
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ðŸ‘¤ <b>${esc(info.author)}</b>
ðŸ“ ${esc((info.bio || 'â€”').slice(0, 180))}
ðŸ‘¥ Followers/Likes: <b>${fmtN(info.followers ?? info.likes)}</b>
ðŸ”— ${esc(info.url)}`;
        if (info.avatar) {
          try {
            await sendPhoto(chatId, info.avatar, { caption: text });
            return;
          } catch {}
        }
        return send(chatId, text);
      } catch (e) {
        return send(chatId, `âŒ ${e.message}`);
      }
    }

    if (text.startsWith('/')) {
      return send(chatId, 'â“ GÃµ /start xem lá»‡nh.');
    }
  }

  // reviewRequest for reset type shouldn't create a key - patch behavior via wrapper
  const originalReview = options.reviewRequest;
  options.reviewRequest = function (id, approved, reviewer) {
    const req = (options.getRequests ? options.getRequests() : []).find(r => r.id === id);
    if (req && req.type === 'reset') {
      if (!req || req.status !== 'pending') return { ok: false, error: 'YÃªu cáº§u Ä‘Ã£ xá»­ lÃ½ hoáº·c khÃ´ng tá»“n táº¡i.' };
      req.status = approved ? 'approved' : 'rejected';
      req.reviewedAt = Date.now();
      req.reviewer = String(reviewer || 'admin');
      // device reset already done in approve handler for admin cmd; also do here for safety
      if (approved) {
        const k = resolveKey(req.resetKeyPlain || '') || (options.getKeys ? options.getKeys() : []).find(x => x.id === req.resetKeyId);
        if (k) { k.deviceHashes = []; if (options.saveKeys) options.saveKeys(); }
      }
      if (options.saveRequests) {
        // requests saved inside reviewRequest normally - ensure
      }
      // persist via side effect: original list is same array
      try {
        const fsPath = null; // save handled by mark/list mutation + existing save on original
      } catch {}
      // force save requests if available
      if (typeof options.forceSaveRequests === 'function') options.forceSaveRequests();
      return { ok: true, request: req, key: null, meta: null };
    }
    return originalReview(id, approved, reviewer);
  };

  async function loop() {
    try { await tg('deleteWebhook', { drop_pending_updates: false }); } catch {}
    while (!stopped) {
      try {
        const updates = await tg('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
        for (const update of updates || []) {
          offset = Math.max(offset, Number(update.update_id) + 1);
          try {
            if (update.message) await handleMessage(update.message);
            if (update.callback_query) await handleCallback(update.callback_query);
          } catch (e) { console.warn('[telegram] handler:', e.message); }
        }
      } catch (e) {
        console.warn('[telegram] poll:', e.message);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  const bot = {
    sendKeyToUser: async (telegramId, key, meta = {}) => send(telegramId,
`âœ… <b>KEY VIP</b>
ðŸ”‘ <code>${key}</code>
ðŸ“¦ ${esc(meta.label || 'VIP')} Â· â± ${meta.durationHours || 5}h
ðŸ“± 3 thiáº¿t bá»‹`),
    sendTextToUser: async (telegramId, text) => send(telegramId, text),
    notifyAdmins,
    stop: () => { stopped = true; }
  };
  loop();
  console.log(`[telegram] cmd-only bot started; admins=${adminIds.size}`);
  return bot;
}


const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'htungdzvipmax';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const POLL_MS = Math.max(5000, Number(process.env.POLL_MS || 8000));
const BRAND = '@SunNetWin';

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.disable('x-powered-by');

// The front-end can be hosted statically on Netlify. This server also serves it for local testing.
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

const KEYS_FILE = path.join(DATA_DIR, 'keys.json');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const LOG_FILE = path.join(DATA_DIR, 'server.log');
const GAMES_FILE = path.join(DATA_DIR, 'games.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const REQUESTS_FILE = path.join(DATA_DIR, 'bot_requests.json');
const BOT_SESSIONS_FILE = path.join(DATA_DIR, 'telegram_sessions.json');

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJSON(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}
function logLine(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
  console.log(line.trim());
}
function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function secureEqual(a, b) {
  const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function validHttpUrl(value) {
  try { const u = new URL(String(value)); return ['http:', 'https:'].includes(u.protocol); } catch { return false; }
}
function newPlainKey() { return 'KYT-' + crypto.randomBytes(5).toString('hex').toUpperCase(); }

// ---------- key registry ----------
let keys = loadJSON(KEYS_FILE, []);
if (!Array.isArray(keys)) keys = [];
keys = keys.map(k => ({
  status: 'active', deviceLimit: 1, deviceHashes: [], expiresAt: null, source: 'admin',
  ...k,
  deviceHashes: Array.isArray(k.deviceHashes) ? k.deviceHashes : []
}));
function saveKeys() { saveJSON(KEYS_FILE, keys); }
function findKey(plain) { const hash = sha256(String(plain || '').trim()); return keys.find(k => k.hash === hash) || null; }
function isExpired(key, now = Date.now()) { return key.expiresAt !== null && key.expiresAt !== undefined && Number(key.expiresAt) <= now; }
function publicKeyInfo(k) {
  return {
    id: k.id, label: k.label, created: k.created, lastUsed: k.lastUsed || null, uses: k.uses || 0,
    expiresAt: k.expiresAt ?? null, deviceLimit: Math.max(1, Number(k.deviceLimit || 1)),
    deviceCount: (k.deviceHashes || []).length, expired: isExpired(k), status: k.status || 'active',
    source: k.source || 'admin', telegramId: k.telegramId || null
  };
}
function createKey({ key: requestedKey = '', label = 'Key VIP', durationHours = 0, expiresAt = null, deviceLimit = 3, source = 'admin', telegramId = null } = {}) {
  let plain = String(requestedKey || '').trim();
  if (!plain) plain = newPlainKey();
  if (plain.length < 5 || plain.length > 120) throw new Error('Key pháº£i cÃ³ Ä‘á»™ dÃ i tá»« 5 Ä‘áº¿n 120 kÃ½ tá»±.');
  if (findKey(plain)) throw new Error('Key Ä‘Ã£ tá»“n táº¡i.');
  const hours = Math.max(0, Number(durationHours || 0));
  let expiry = null;
  if (expiresAt !== null && expiresAt !== undefined && expiresAt !== '') {
    const parsed = typeof expiresAt === 'number' ? expiresAt : new Date(expiresAt).getTime();
    if (!Number.isFinite(parsed) || parsed <= Date.now()) throw new Error('NgÃ y háº¿t háº¡n khÃ´ng há»£p lá»‡ hoáº·c Ä‘Ã£ á»Ÿ quÃ¡ khá»©.');
    expiry = parsed;
  } else if (hours > 0) expiry = Date.now() + hours * 60 * 60 * 1000;
  const limit = Math.max(1, Math.min(100, Math.floor(Number(deviceLimit || 1))));
  const record = {
    id: crypto.randomUUID(), hash: sha256(plain), label: String(label || 'Key VIP').slice(0, 120),
    created: Date.now(), lastUsed: null, uses: 0, expiresAt: expiry, deviceLimit: limit,
    deviceHashes: [], status: 'active', source: String(source || 'admin'), telegramId: telegramId ? String(telegramId) : null
  };
  keys.push(record); saveKeys();
  logLine(`key created: ${record.label} | source=${record.source} | expires=${expiry || 'never'}`);
  return { plainKey: plain, record };
}

// A default key is only created for backwards compatibility. Set DEFAULT_KEY explicitly for production.
if (!keys.length && process.env.DEFAULT_KEY) {
  try { createKey({ key: process.env.DEFAULT_KEY, label: 'Default Key', source: 'environment' }); }
  catch (e) { logLine('default key initialization failed: ' + e.message); }
}

// ---------- signed sessions ----------
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function verifyToken(token) {
  try {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;
    const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
    if (!secureEqual(sig, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload.exp || payload.exp <= Date.now()) return null;
    return payload;
  } catch { return null; }
}
const attempts = Object.create(null);
function rateLimit(ip) {
  const now = Date.now();
  attempts[ip] = (attempts[ip] || []).filter(t => now - t < 60000);
  attempts[ip].push(now);
  return attempts[ip].length <= 12;
}
function bearerToken(req) {
  return (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query.token || '';
}
function requireUser(req, res, next) {
  const payload = verifyToken(bearerToken(req));
  if (!payload || payload.type !== 'user') return res.status(401).json({ error: 'PhiÃªn Ä‘Äƒng nháº­p khÃ´ng há»£p lá»‡ hoáº·c Ä‘Ã£ háº¿t háº¡n.' });
  const k = keys.find(item => item.id === payload.keyId);
  if (!k || k.status === 'revoked' || isExpired(k)) return res.status(401).json({ error: 'Key Ä‘Ã£ háº¿t háº¡n hoáº·c bá»‹ thu há»“i.' });
  if (payload.deviceHash && !(k.deviceHashes || []).includes(payload.deviceHash)) return res.status(401).json({ error: 'Thiáº¿t bá»‹ khÃ´ng cÃ²n Ä‘Æ°á»£c cáº¥p quyá»n sá»­ dá»¥ng key.' });
  req.user = payload; req.userKey = k; next();
}
function requireAdmin(req, res, next) {
  const payload = verifyToken(bearerToken(req));
  if (!payload || payload.type !== 'admin') return res.status(401).json({ error: 'YÃªu cáº§u quyá»n admin.' });
  next();
}

// ---------- configurable game feeds ----------
const DEFAULT_GAMES = [
  { id: 'sunwin', label: 'Sunwin', url: 'https://apisunwin-cocalhahaha.onrender.com/api/sunwin', parser: 'sunwin', enabled: true },
  { id: 'lc79_hu', label: 'LC79 Â· HÅ©', url: 'https://wtx.tele68.com/v1/tx/sessions', parser: 'lc79', enabled: true },
  { id: 'lc79_md5', label: 'LC79 Â· MD5', url: 'https://wtxmd52.tele68.com/v1/txmd5/sessions', parser: 'lc79', enabled: true },
  { id: 'baccarat', label: 'Baccarat', url: 'https://bcrsexy.onrender.com/api/baccarat', parser: 'baccarat', enabled: true, table: '' }
];
let gameConfigs = loadJSON(GAMES_FILE, null);
if (!Array.isArray(gameConfigs)) gameConfigs = DEFAULT_GAMES.map(g => ({ ...g }));
// Ä‘áº£m báº£o cÃ³ game baccarat náº¿u báº£n cÅ© chÆ°a cÃ³
if (!gameConfigs.some(g => g.parser === 'baccarat' || g.id === 'baccarat')) {
  const bac = DEFAULT_GAMES.find(g => g.id === 'baccarat');
  if (bac) gameConfigs.push({ ...bac });
}

const FEEDS = Object.create(null);
function createFeed(config) {
  const parser = config.parser || 'lc79';
  const engine = parser === 'baccarat' ? new BaccaratEngine() : new Engine();
  return { id: config.id, label: config.label, url: config.url, parser, table: config.table || '', enabled: config.enabled !== false,
    engine, history: [], accuracyHistory: [], lastSession: null, pendingPred: null,
    correct: 0, total: 0, lastLive: null, lastEnsemble: null, _seen: [], lastError: null };
}
function saveGameConfigs() { saveJSON(GAMES_FILE, gameConfigs); }
function initializeFeedConfigs() {
  for (const key of Object.keys(FEEDS)) delete FEEDS[key];
  for (const g of gameConfigs) {
    if (!g || !/^[a-z0-9_-]{2,32}$/i.test(String(g.id || '')) || !validHttpUrl(g.url)) continue;
    g.id = String(g.id); g.label = String(g.label || g.id); g.parser = ['sunwin','baccarat'].includes(g.parser) ? g.parser : 'lc79'; g.table = g.table || ''; g.enabled = g.enabled !== false;
    FEEDS[g.id] = createFeed(g);
  }
}
initializeFeedConfigs();

function parseSunwin(data) {
  const full = Array.isArray(data) ? data : (data?.data && Array.isArray(data.data) ? data.data : [data]);
  return full.map(item => {
    const dice = item.xuc_xac || item.dices || item.xucxac || item.dice || [0, 0, 0];
    const sum = Number(item.Tong ?? item.tong ?? item.sum ?? item.point ?? dice.reduce((a, b) => Number(a) + Number(b), 0));
    let char = sum >= 11 ? 'T' : 'X';
    const raw = String(item.ket_qua || item.ketqua || item.result || '').toLowerCase();
    if (raw.includes('tai') || raw === 't') char = 'T';
    else if (raw.includes('xiu') || raw === 'x') char = 'X';
    return { session: item.phien ?? item.session ?? item.session_id ?? item.id, sum, char, dice };
  }).filter(i => i.session !== undefined && i.session !== null && i.session !== '');
}
function parseLC79(data) {
  let full = [];
  if (Array.isArray(data)) full = data;
  else if (Array.isArray(data?.list)) full = data.list;
  else if (Array.isArray(data?.sessions)) full = data.sessions;
  else if (Array.isArray(data?.data)) full = data.data;
  else full = [data];
  return full.map(item => {
    const dice = item.dices || item.dice || item.xuc_xac || item.xucxac || [0, 0, 0];
    const sum = Number(item.point ?? item.sum ?? item.total ?? item.Tong ?? dice.reduce((a, b) => Number(a) + Number(b), 0));
    const raw = String(item.ket_qua || item.ketqua || item.result || item.outcome || '').toLowerCase();
    let char = sum >= 11 ? 'T' : 'X';
    if (raw.includes('tai') || raw === 't') char = 'T'; else if (raw.includes('xiu') || raw === 'x') char = 'X';
    return { session: item.id ?? item.session ?? item.session_id ?? item.phien, sum, char, dice };
  }).filter(i => i.session !== undefined && i.session !== null && i.session !== '');
}
function parseFeedData(feed, data) {
  if (feed.parser === 'sunwin') return parseSunwin(data);
  if (feed.parser === 'baccarat') return parseBaccarat(data, feed.table);
  return parseLC79(data);
}

function parseBaccarat(data, tableFilter) {
  // API tháº­t: { success:true, data:[ { table:"7", result:"PPBBB...", shoeId, round } ] }
  let rows = [];
  if (Array.isArray(data)) rows = data;
  else if (Array.isArray(data?.data)) rows = data.data;
  else if (Array.isArray(data?.tables)) rows = data.tables;
  if (!rows.length) return [];

  const resultStr = (r) => String(r.result || r.results || r.road || r.history || '').toUpperCase().replace(/[^BPT]/g, '');
  const tableId = (r) => String(r.table || r.ban || r.name || r.id || '').trim();

  let row = null;
  const want = String(tableFilter || '').trim().toLowerCase();
  if (want) {
    row = rows.find(r => {
      const id = tableId(r).toLowerCase();
      return id === want || id.includes(want);
    });
  }
  if (!row) {
    // bÃ n cÃ³ chuá»—i káº¿t quáº£ dÃ i nháº¥t (Ä‘á»§ data Ä‘á»ƒ Ä‘oÃ¡n)
    row = rows.slice().sort((a, b) => resultStr(b).length - resultStr(a).length)[0];
  }
  if (!row) return [];

  const results = resultStr(row);
  if (results.length < 3) return [];

  const goodRoad = row.good_road || row.goodRoad || row.road_name || '';
  const tableName = tableId(row) || 'Baccarat';
  const shoe = String(row.shoeId || row.shoe || '');

  // má»—i kÃ½ tá»± = 1 phiÃªn; session á»•n Ä‘á»‹nh theo table + index + shoe
  const list = [];
  for (let i = 0; i < results.length; i++) {
    list.push({
      session: shoe ? `${tableName}-${shoe}-${i}` : `${tableName}-${i}`,
      char: results[i],
      sum: null,
      goodRoad,
      table: tableName
    });
  }
  // má»›i nháº¥t á»Ÿ Ä‘áº§u
  return list.reverse();
}
function nextSessionNumber(session) {
  if (/^\d+$/.test(String(session))) return String(Number(session) + 1);
  return null;
}
function sessionEquals(a, b) { return a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b); }

// Load trained state after dynamic feed definitions are ready.
const savedState = loadJSON(STATE_FILE, null);
if (savedState?.feeds) {
  for (const [id, f] of Object.entries(FEEDS)) {
    const st = savedState.feeds[id];
    if (!st) continue;
    try { f.engine.loadState(st.state); } catch {}
    f.history = Array.isArray(st.history) ? st.history.slice(0, 5000) : [];
    f.accuracyHistory = Array.isArray(st.accuracyHistory) ? st.accuracyHistory.slice(0, 10000) : [];
    f.lastSession = st.lastSession ?? null;
    f.correct = Number(st.correct || 0); f.total = Number(st.total || 0);
    f.pendingPred = st.pendingPred || null;
    f.lastLive = st.lastLive || f.history[0] || null;
    f._seen = f.history.map(h => String(h.session)).slice(0, 5000);
  }
  logLine('resumed game state: ' + Object.keys(savedState.feeds).join(', '));
}

async function pollFeed(id) {
  const f = FEEDS[id];
  if (!f || !f.enabled || f.polling) return;
  f.polling = true;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 15000);
  try {
    const response = await fetch(f.url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    const list = parseFeedData(f, data);
    if (!list.length) throw new Error('API khÃ´ng tráº£ vá» danh sÃ¡ch phiÃªn phÃ¹ há»£p');
    const latest = list[0];
    if (sessionEquals(f.lastSession, latest.session)) { f.lastError = null; return; }
    const seen = new Set((f._seen || []).map(String));
    const chronological = [...list].reverse().filter(item => !seen.has(String(item.session)));
    for (const item of chronological) {
      let scoreRow = null;
      if (f.pendingPred) {
        const expected = f.pendingPred.targetSession;
        const shouldScore = expected !== null && expected !== undefined
          ? sessionEquals(expected, item.session)
          : !sessionEquals(f.pendingPred.sourceSession, item.session);
        if (shouldScore) {
          const isCorrect = f.pendingPred.predicted === item.char;
          f.total++;
          if (isCorrect) f.correct++;
          scoreRow = { session: item.session, predicted: f.pendingPred.predicted, actual: item.char, isCorrect, ts: Date.now(), sourceSession: f.pendingPred.sourceSession };
          f.accuracyHistory.unshift(scoreRow);
          f.accuracyHistory = f.accuracyHistory.slice(0, 10000);
          f.pendingPred = null;
        } else if (expected !== null && /^\d+$/.test(String(expected)) && /^\d+$/.test(String(item.session)) && Number(item.session) > Number(expected)) {
          f.accuracyHistory.unshift({ session: item.session, predicted: f.pendingPred.predicted, actual: item.char, isCorrect: null, skipped: true, ts: Date.now(), sourceSession: f.pendingPred.sourceSession });
          f.accuracyHistory = f.accuracyHistory.slice(0, 10000);
          f.pendingPred = null;
        }
      }
      f.engine.addResult(item.char, item.sum, item.goodRoad ? { goodRoad: item.goodRoad } : undefined);
      const row = { session: item.session, char: item.char, sum: item.sum, dice: item.dice, ts: Date.now() };
      if (scoreRow) { row.prediction = scoreRow.predicted; row.isCorrect = scoreRow.isCorrect; }
      f.history.unshift(row);
      f.history = f.history.slice(0, 5000);
      seen.add(String(item.session));
    }
    f._seen = [...seen].slice(-5000);
    f.lastSession = latest.session;
    f.lastLive = f.history.find(h => sessionEquals(h.session, latest.session)) || { ...latest, ts: Date.now() };
    const ensemble = f.engine.getEnsemblePrediction();
    f.lastEnsemble = ensemble;
    const pr = String(ensemble.predictedResult || '').toUpperCase();
    let predicted = 'X';
    if (pr === 'TÃ€I' || pr === 'TAI' || pr === 'T') predicted = 'T';
    else if (pr === 'Xá»ˆU' || pr === 'XIU' || pr === 'X') predicted = 'X';
    else if (pr === 'BANKER' || pr === 'B' || pr === 'CAI') predicted = 'B';
    else if (pr === 'PLAYER' || pr === 'P' || pr === 'CON') predicted = 'P';
    else if (f.parser === 'baccarat') predicted = 'B';
    f.pendingPred = { sourceSession: String(latest.session), targetSession: nextSessionNumber(latest.session), predicted, createdAt: Date.now() };
    f.lastError = null;
  } catch (e) {
    f.lastError = e.message || String(e);
    logLine(`poll ${id} error: ${f.lastError}`);
  } finally { clearTimeout(timeout); f.polling = false; }
}
function saveState() {
  const out = { updated: Date.now(), feeds: {} };
  for (const [id, f] of Object.entries(FEEDS)) {
    out.feeds[id] = {
      state: f.engine.saveState(), history: f.history.slice(0, 5000), accuracyHistory: f.accuracyHistory.slice(0, 10000),
      lastSession: f.lastSession, correct: f.correct, total: f.total, pendingPred: f.pendingPred, lastLive: f.lastLive
    };
  }
  saveJSON(STATE_FILE, out);
}

// ---------- bot settings and moderation queue ----------
let botSettings = loadJSON(SETTINGS_FILE, null) || {
  telegramUsername: '',
  groupTaskText: 'Cáº§n ráº£i quáº£ng cÃ¡o vÃ o 3 nhÃ³m báº¥t kÃ¬.\n\nðŸ“Œ CÃ¡ch lÃ m:\n1) Sao chÃ©p cÃ¢u promo admin cung cáº¥p\n2) VÃ o 3 nhÃ³m báº¥t kÃ¬ vÃ  gá»­i tin nháº¯n\n3) Chá»¥p mÃ n hÃ¬nh 3 tin nháº¯n vá»«a gá»­i\n4) Gá»­i 3 áº£nh vÃ o Ä‘Ã¢y cho Bot duyá»‡t\n\nâš ï¸ LÆ°u Ã½:\n- áº¢nh rÃµ, thá»ƒ hiá»‡n Ä‘Ã£ gá»­i thÃ nh cÃ´ng\n- Pháº£i Ä‘á»§ 3 áº£nh tá»« 3 nhÃ³m khÃ¡c nhau',
  groupPromoText: '@SunNetWin tool dá»± Ä‘oÃ¡n TX VIP â€” getkey miá»…n phÃ­, há»— trá»£ 24/7',
  groupTaskPhotos: 3,
  groupTaskTimeoutSec: 300,
  supportUrl: 'https://t.me/SunNetWin',
  watermarkText: 'SunWin Â· MD5 Â· HitClub Â· Tool tÆ°ng tá»­ng',
  siteTitle: 'Tool tÆ°ng tá»­ng',
  maintenance: {
    enabled: false,
    message: 'Há»‡ thá»‘ng Ä‘ang báº£o trÃ¬, vui lÃ²ng quay láº¡i sau.',
    lockedGames: [],
    lockedCommands: []
  },
  bankCode: '', bankAccount: '', bankAccountName: '', plans: []
};
function normalizeSettings(value) {
  const v = value || {};
  let plans = Array.isArray(v.plans) ? v.plans.map(p => ({
    id: String(p.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24),
    label: String(p.label || '').trim().slice(0, 80),
    price: Math.max(0, Math.floor(Number(p.price || 0))),
    durationHours: Math.max(0, Math.floor(Number(p.durationHours || 0))),
    active: p.active !== false
  })).filter(p => p.id && p.label && p.price > 0 && p.durationHours > 0) : [];
  if (!plans.length) {
    plans = [
      { id: '1d', label: '1 ngÃ y', price: 3000, durationHours: 24, active: true },
      { id: '3d', label: '3 ngÃ y', price: 7000, durationHours: 72, active: true },
      { id: '1w', label: '1 tuáº§n', price: 15000, durationHours: 168, active: true },
      { id: '1m', label: '1 thÃ¡ng', price: 40000, durationHours: 720, active: true },
      { id: '2m', label: '2 thÃ¡ng', price: 70000, durationHours: 1440, active: true },
      { id: 'lifetime', label: 'VÄ©nh viá»…n', price: 100000, durationHours: 87600, active: true }
    ];
  }
  const ids = new Set();
  for (const plan of plans) { if (ids.has(plan.id)) throw new Error('MÃ£ gÃ³i bá»‹ trÃ¹ng: ' + plan.id); ids.add(plan.id); }
  return {
    telegramUsername: String(v.telegramUsername || '').trim().replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 64),
    groupTaskText: String(v.groupTaskText || '').slice(0, 2000),
    groupPromoText: String(v.groupPromoText || '').slice(0, 500),
    groupTaskPhotos: Math.min(10, Math.max(1, Number(v.groupTaskPhotos) || 3)),
    groupTaskTimeoutSec: Math.min(3600, Math.max(60, Number(v.groupTaskTimeoutSec) || 300)),
    supportUrl: String(v.supportUrl || 'https://t.me/SunNetWin').trim().slice(0, 200),
    watermarkText: String(v.watermarkText || 'SunWin Â· MD5 Â· HitClub Â· Tool tÆ°ng tá»­ng').trim().slice(0, 300),
    siteTitle: String(v.siteTitle || 'Tool tÆ°ng tá»­ng').trim().slice(0, 80),
    maintenance: {
      enabled: !!(v.maintenance && v.maintenance.enabled),
      message: String((v.maintenance && v.maintenance.message) || 'Há»‡ thá»‘ng Ä‘ang báº£o trÃ¬, vui lÃ²ng quay láº¡i sau.').slice(0, 500),
      lockedGames: Array.isArray(v.maintenance && v.maintenance.lockedGames)
        ? v.maintenance.lockedGames.map(x => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 50)
        : [],
      lockedCommands: Array.isArray(v.maintenance && v.maintenance.lockedCommands)
        ? v.maintenance.lockedCommands.map(x => String(x).trim().toLowerCase().replace(/^\//, '')).filter(Boolean).slice(0, 50)
        : []
    },
    bankCode: String(v.bankCode || '').trim().slice(0, 40), bankAccount: String(v.bankAccount || '').trim().slice(0, 40),
    bankAccountName: String(v.bankAccountName || '').trim().slice(0, 120), plans
  };
}
function saveBotSettings() { saveJSON(SETTINGS_FILE, botSettings); }
try { botSettings = normalizeSettings(botSettings); } catch (e) { logLine('settings normalization warning: ' + e.message); }
let botRequests = loadJSON(REQUESTS_FILE, []);
if (!Array.isArray(botRequests)) botRequests = [];
let botSessions = loadJSON(BOT_SESSIONS_FILE, {});
if (!botSessions || typeof botSessions !== 'object') botSessions = {};
function saveRequests() { saveJSON(REQUESTS_FILE, botRequests); }
function getSessions() { return botSessions; }
function saveSessions(next) { botSessions = next || {}; saveJSON(BOT_SESSIONS_FILE, botSessions); }
function addRequest(request) { botRequests.unshift(request); botRequests = botRequests.slice(0, 5000); saveRequests(); }
function publicRequest(r) {
  return { id: r.id, type: r.type, status: r.status, telegramId: r.telegramId, username: r.username, userName: r.userName,
    groupLink: r.groupLink || '', caption: r.caption || '', planId: r.planId || null, planLabel: r.planLabel || '',
    price: r.price || 0, durationHours: r.durationHours || 5, createdAt: r.createdAt, reviewedAt: r.reviewedAt || null,
    reviewer: r.reviewer || null, deliveredAt: r.deliveredAt || null, proofAttached: !!r.proofFileId };
}
function markDelivered(id) {
  const request = botRequests.find(r => r.id === id);
  if (request) { delete request.issuedKey; request.deliveredAt = Date.now(); saveRequests(); }
}
function reviewRequest(id, approved, reviewer) {
  const request = botRequests.find(r => r.id === id);
  if (!request) return { ok: false, error: 'KhÃ´ng tÃ¬m tháº¥y yÃªu cáº§u.' };
  if (request.status !== 'pending') return { ok: false, error: 'YÃªu cáº§u nÃ y Ä‘Ã£ Ä‘Æ°á»£c xá»­ lÃ½.' };
  request.status = approved ? 'approved' : 'rejected'; request.reviewedAt = Date.now(); request.reviewer = String(reviewer || 'admin');
  let issued = null;
  if (approved && request.type === 'reset') {
    const k = findKey(request.resetKeyPlain || '') || keys.find(x => x.id === request.resetKeyId);
    if (k) { k.deviceHashes = []; saveKeys(); }
  } else if (approved) {
    const hours = Math.max(1, Number(request.durationHours || 5));
    issued = createKey({ label: `${request.planLabel || 'Key free'} Â· TG ${request.telegramId}`, durationHours: hours, deviceLimit: 3,
      source: request.type === 'payment' ? 'telegram-payment' : 'telegram-group', telegramId: request.telegramId });
    request.issuedKey = issued.plainKey;
    request.issuedKeyExpiresAt = issued.record.expiresAt;
  }
  saveRequests();
  return { ok: true, request, key: issued?.plainKey || null, meta: issued ? { label: issued.record.label, durationHours: request.durationHours, expiresAt: issued.record.expiresAt } : null };
}

// ---------- public endpoints ----------
app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now(), games: Object.keys(FEEDS) }));
app.get('/api/public/config', (req, res) => {
  const games = (Array.isArray(gameConfigs) ? gameConfigs : []).map(g => g.label || g.id).filter(Boolean);
  const wm = botSettings.watermarkText || (games.length ? games.join(' Â· ') + ' Â· Tool tÆ°ng tá»­ng' : 'Tool tÆ°ng tá»­ng');
  res.json({
    brand: BRAND,
    siteTitle: botSettings.siteTitle || 'Tool tÆ°ng tá»­ng',
    telegramUsername: botSettings.telegramUsername || '',
    telegramUrl: botSettings.telegramUsername ? `https://t.me/${botSettings.telegramUsername}` : '',
    supportUrl: botSettings.supportUrl || 'https://t.me/SunNetWin',
    watermarkText: wm,
    games,
    maintenance: {
      enabled: !!(botSettings.maintenance && botSettings.maintenance.enabled),
      message: (botSettings.maintenance && botSettings.maintenance.message) || '',
      lockedGames: (botSettings.maintenance && botSettings.maintenance.lockedGames) || []
    },
    plans: (botSettings.plans || []).filter(p => p.active !== false).map(p => ({
      id: p.id, label: p.label, price: p.price, durationHours: p.durationHours
    }))
  });
});
app.post('/api/auth', (req, res) => {
  if (!rateLimit(req.ip)) return res.status(429).json({ error: 'Báº¡n thá»­ quÃ¡ nhiá»u láº§n. Vui lÃ²ng Ä‘á»£i 1 phÃºt.' });
  const plain = String(req.body?.key || '').trim();
  if (!plain) return res.status(400).json({ error: 'Vui lÃ²ng nháº­p key VIP.' });
  const found = findKey(plain);
  if (!found || found.status === 'revoked') return res.status(401).json({ error: 'Key khÃ´ng há»£p lá»‡ hoáº·c Ä‘Ã£ bá»‹ thu há»“i.' });
  if (isExpired(found)) return res.status(401).json({ error: 'Key Ä‘Ã£ háº¿t háº¡n. HÃ£y nháº­n hoáº·c mua key má»›i trÃªn Telegram.' });
  const deviceId = String(req.body?.deviceId || '').trim();
  if (!deviceId || deviceId.length > 200) return res.status(400).json({ error: 'KhÃ´ng xÃ¡c Ä‘á»‹nh Ä‘Æ°á»£c thiáº¿t bá»‹. HÃ£y táº£i láº¡i trang vÃ  thá»­ láº¡i.' });
  const deviceHash = sha256(deviceId);
  if (!found.deviceHashes.includes(deviceHash)) {
    if (found.deviceHashes.length >= Math.max(1, Number(found.deviceLimit || 1))) return res.status(403).json({ error: `Key Ä‘Ã£ Ä‘áº¡t giá»›i háº¡n ${found.deviceLimit || 1} thiáº¿t bá»‹.` });
    found.deviceHashes.push(deviceHash);
  }
  found.lastUsed = Date.now(); found.uses = Number(found.uses || 0) + 1; saveKeys();
  const requestedExpiry = Date.now() + TOKEN_TTL_MS;
  const exp = found.expiresAt ? Math.min(requestedExpiry, found.expiresAt) : requestedExpiry;
  const token = sign({ type: 'user', keyId: found.id, deviceHash, exp });
  logLine(`user auth ok: ${found.label} device=${deviceHash.slice(0, 8)}`);
  res.json({ token, expiresIn: exp - Date.now(), label: found.label, expiresAt: found.expiresAt || null, deviceLimit: found.deviceLimit || 1 });
});
app.post('/api/admin/login', (req, res) => {
  if (!rateLimit(req.ip)) return res.status(429).json({ error: 'Báº¡n thá»­ quÃ¡ nhiá»u láº§n. Vui lÃ²ng Ä‘á»£i 1 phÃºt.' });
  const password = String(req.body?.password || '');
  if (!secureEqual(password, ADMIN_PASSWORD)) return res.status(401).json({ error: 'Máº­t kháº©u admin khÃ´ng Ä‘Ãºng.' });
  const token = sign({ type: 'admin', exp: Date.now() + TOKEN_TTL_MS });
  logLine('admin login ok');
  res.json({ token, expiresIn: TOKEN_TTL_MS });
});

// ---------- user prediction endpoints ----------
app.get('/api/games', requireUser, (req, res) => res.json({ games: gameConfigs.filter(g => g.enabled !== false && FEEDS[g.id]).map(g => ({ id: g.id, label: g.label, gameType: g.parser === 'baccarat' ? 'baccarat' : 'tx' })) }));
app.get('/api/me', requireUser, (req, res) => res.json({ label: req.userKey.label, expiresAt: req.userKey.expiresAt || null, deviceLimit: req.userKey.deviceLimit || 1 }));
app.get('/api/predict', requireUser, (req, res) => {
  const f = FEEDS[req.query.game];
  if (!f || !f.enabled) return res.status(400).json({ error: 'Game khÃ´ng tá»“n táº¡i hoáº·c Ä‘ang táº¯t.' });
  const mt = botSettings.maintenance || {};
  const gid = String(req.query.game || '').toLowerCase();
  if (mt.enabled && Array.isArray(mt.lockedGames) && mt.lockedGames.map(String).map(s=>s.toLowerCase()).includes(gid)) {
    return res.status(503).json({ error: mt.message || 'Game Ä‘ang báº£o trÃ¬.', maintenance: true });
  }
  const ensemble = f.engine.getEnsemblePrediction();
  const ms = f.engine.marketState || ensemble.market || {};
  res.json({
    game: req.query.game,
    label: f.label,
    gameType: ensemble.gameType || (f.parser === 'baccarat' ? 'baccarat' : 'tx'),
    predictedResult: ensemble.predictedResult,
    confidence: ensemble.confidence,
    taiProb: ensemble.taiProb,
    xiuProb: ensemble.xiuProb,
    activeModels: ensemble.activeModels || ensemble.modelsUsed,
    topReason: ensemble.topReason || ensemble.reason,
    reason: ensemble.reason || ensemble.topReason,
    regime: ms.regime || null,
    trend: ms.trend || null,
    nextSession: f.lastLive ? (Number.isFinite(Number(f.lastLive.session)) ? Number(f.lastLive.session) + 1 : (f.lastLive.session || null)) : null,
    live: f.lastLive || null,
    accuracy: f.total ? { correct: f.correct, total: f.total, pct: +(f.correct / f.total * 100).toFixed(1) } : null,
    feedError: f.lastError || null,
    algos: ensemble.algos || null
  });
});
app.get('/api/live', requireUser, (req, res) => {
  const f = FEEDS[req.query.game]; if (!f || !f.enabled) return res.status(400).json({ error: 'Game khÃ´ng tá»“n táº¡i hoáº·c Ä‘ang táº¯t.' });
  res.json({ live: f.lastLive || null, nextSession: f.lastLive && Number.isFinite(Number(f.lastLive.session)) ? Number(f.lastLive.session) + 1 : null });
});
app.get('/api/history', requireUser, (req, res) => {
  const f = FEEDS[req.query.game]; if (!f || !f.enabled) return res.status(400).json({ error: 'Game khÃ´ng tá»“n táº¡i hoáº·c Ä‘ang táº¯t.' });
  const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const accLimit = Math.min(100, Math.max(1, parseInt(req.query.accLimit, 10) || 30));
  res.json({
    game: req.query.game,
    history: f.history.slice(0, limit),
    accuracyHistory: (f.accuracyHistory || []).slice(0, accLimit),
    accuracy: f.total ? { correct: f.correct, total: f.total, pct: +(f.correct / f.total * 100).toFixed(1) } : null
  });
});

// ---------- admin: keys, devices, validity ----------
app.get('/api/admin/keys', requireAdmin, (req, res) => res.json({ keys: keys.map(publicKeyInfo).sort((a, b) => b.created - a.created) }));
app.post('/api/admin/keys', requireAdmin, (req, res) => {
  try {
    const result = createKey({ key: req.body?.key || '', label: req.body?.label || 'Key VIP', durationHours: req.body?.durationHours || 0,
      expiresAt: req.body?.expiresAt ?? null, deviceLimit: req.body?.deviceLimit || 3, source: 'admin' });
    res.json({ ok: true, key: result.plainKey, keyInfo: publicKeyInfo(result.record) });
  } catch (e) { res.status(400).json({ error: e.message || 'KhÃ´ng táº¡o Ä‘Æ°á»£c key.' }); }
});
app.patch('/api/admin/keys/:id', requireAdmin, (req, res) => {
  const key = keys.find(k => k.id === req.params.id);
  if (!key) return res.status(404).json({ error: 'KhÃ´ng tÃ¬m tháº¥y key.' });
  try {
    if (req.body?.label !== undefined) key.label = String(req.body.label || 'Key VIP').slice(0, 120);
    if (req.body?.deviceLimit !== undefined) key.deviceLimit = Math.max(1, Math.min(100, Math.floor(Number(req.body.deviceLimit || 1))));
    if (req.body?.durationHours !== undefined) {
      const hours = Math.max(0, Number(req.body.durationHours || 0));
      key.expiresAt = hours > 0 ? Date.now() + hours * 3600000 : null;
    } else if (req.body?.expiresAt !== undefined) {
      if (req.body.expiresAt === null || req.body.expiresAt === '') key.expiresAt = null;
      else {
        const date = typeof req.body.expiresAt === 'number' ? req.body.expiresAt : new Date(req.body.expiresAt).getTime();
        if (!Number.isFinite(date) || date <= Date.now()) throw new Error('NgÃ y háº¿t háº¡n pháº£i á»Ÿ tÆ°Æ¡ng lai.');
        key.expiresAt = date;
      }
    }
    if (req.body?.status !== undefined) key.status = req.body.status === 'revoked' ? 'revoked' : 'active';
    saveKeys(); logLine(`key updated: ${key.label}`); res.json({ ok: true, key: publicKeyInfo(key) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/admin/keys/:id/reset-devices', requireAdmin, (req, res) => {
  const key = keys.find(k => k.id === req.params.id);
  if (!key) return res.status(404).json({ error: 'KhÃ´ng tÃ¬m tháº¥y key.' });
  key.deviceHashes = []; saveKeys(); logLine('reset devices for key ' + key.id); res.json({ ok: true });
});
app.delete('/api/admin/keys/:id', requireAdmin, (req, res) => {
  const key = keys.find(k => k.id === req.params.id);
  if (!key) return res.status(404).json({ error: 'KhÃ´ng tÃ¬m tháº¥y key.' });
  key.status = 'revoked'; saveKeys(); logLine(`key revoked: ${key.label}`); res.json({ ok: true });
});

// ---------- admin: game API management ----------
app.get('/api/admin/games', requireAdmin, (req, res) => res.json({ games: gameConfigs.map(g => ({ ...g, lastSession: FEEDS[g.id]?.lastSession ?? null, historyCount: FEEDS[g.id]?.history.length || 0, lastError: FEEDS[g.id]?.lastError || null })) }));
app.post('/api/admin/games', requireAdmin, (req, res) => {
  const id = String(req.body?.id || '').trim().toLowerCase();
  const label = String(req.body?.label || '').trim();
  const url = String(req.body?.url || '').trim();
  const parser = ['sunwin','baccarat'].includes(req.body?.parser) ? req.body.parser : 'lc79';
  if (!/^[a-z0-9_-]{2,32}$/.test(id)) return res.status(400).json({ error: 'MÃ£ game chá»‰ gá»“m chá»¯ thÆ°á»ng, sá»‘, _ hoáº·c - (2â€“32 kÃ½ tá»±).' });
  if (gameConfigs.some(g => g.id === id)) return res.status(409).json({ error: 'MÃ£ game Ä‘Ã£ tá»“n táº¡i.' });
  if (!label) return res.status(400).json({ error: 'HÃ£y nháº­p tÃªn game.' });
  if (!validHttpUrl(url)) return res.status(400).json({ error: 'API pháº£i lÃ  URL HTTP hoáº·c HTTPS há»£p lá»‡.' });
  const config = { id, label: label.slice(0, 80), url, parser, table: String(req.body?.table || '').slice(0, 80), enabled: req.body?.enabled !== false };
  gameConfigs.push(config); saveGameConfigs(); FEEDS[id] = createFeed(config); logLine(`game added: ${id}`);
  res.json({ ok: true, game: config });
});
app.patch('/api/admin/games/:id', requireAdmin, (req, res) => {
  const config = gameConfigs.find(g => g.id === req.params.id);
  if (!config) return res.status(404).json({ error: 'KhÃ´ng tÃ¬m tháº¥y game.' });
  const label = req.body?.label === undefined ? config.label : String(req.body.label || '').trim();
  const url = req.body?.url === undefined ? config.url : String(req.body.url || '').trim();
  if (!label) return res.status(400).json({ error: 'TÃªn game khÃ´ng Ä‘Æ°á»£c Ä‘á»ƒ trá»‘ng.' });
  if (!validHttpUrl(url)) return res.status(400).json({ error: 'API pháº£i lÃ  URL HTTP hoáº·c HTTPS há»£p lá»‡.' });
  config.label = label.slice(0, 80); config.url = url;
  if (req.body?.parser !== undefined) config.parser = ['sunwin','baccarat'].includes(req.body.parser) ? req.body.parser : 'lc79';
  if (req.body?.table !== undefined) config.table = String(req.body.table || '').slice(0, 80);
  if (req.body?.enabled !== undefined) config.enabled = req.body.enabled !== false;
  if (FEEDS[config.id]) { Object.assign(FEEDS[config.id], { label: config.label, url: config.url, parser: config.parser, enabled: config.enabled }); }
  saveGameConfigs(); logLine(`game updated: ${config.id}`); res.json({ ok: true, game: config });
});
app.delete('/api/admin/games/:id', requireAdmin, (req, res) => {
  const i = gameConfigs.findIndex(g => g.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'KhÃ´ng tÃ¬m tháº¥y game.' });
  const [removed] = gameConfigs.splice(i, 1); delete FEEDS[removed.id]; saveGameConfigs(); saveState(); logLine(`game removed: ${removed.id}`); res.json({ ok: true });
});

// ---------- admin: stats, full result/accuracy history, logs ----------
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const games = {};
  for (const [id, f] of Object.entries(FEEDS)) {
    games[id] = { label: f.label, enabled: f.enabled, historyCount: f.history.length, accuracyHistoryCount: f.accuracyHistory.length,
      lastSession: f.lastSession, correct: f.correct, total: f.total, accuracy: f.total ? +(f.correct / f.total * 100).toFixed(1) : null,
      weights: Object.fromEntries(Object.entries(f.engine.weights).map(([m, w]) => [m, +Number(w).toFixed(3)])),
      modelEwma: Object.fromEntries(Object.entries(f.engine.modelHits || {}).map(([m, h]) => [m, { win: h.win, loss: h.loss, ewma: +Number(h.ewma).toFixed(3) }])),
      regime: f.engine.marketState.regime, trend: f.engine.marketState.trend, autocorr: +Number(f.engine.autocorr || 0).toFixed(3), lastError: f.lastError || null };
  }
  res.json({ games, totalKeys: keys.filter(k => k.status !== 'revoked' && !isExpired(k)).length, totalKeysAll: keys.length, pendingRequests: botRequests.filter(r => r.status === 'pending').length });
});
app.get('/api/admin/history', requireAdmin, (req, res) => {
  const f = FEEDS[req.query.game]; if (!f) return res.status(400).json({ error: 'Game khÃ´ng há»£p lá»‡.' });
  const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 500));
  res.json({ game: req.query.game, history: f.history.slice(0, limit) });
});
app.get('/api/admin/accuracy', requireAdmin, (req, res) => {
  const f = FEEDS[req.query.game]; if (!f) return res.status(400).json({ error: 'Game khÃ´ng há»£p lá»‡.' });
  const limit = Math.min(10000, Math.max(1, parseInt(req.query.limit, 10) || 10000));
  res.json({ game: req.query.game, history: f.accuracyHistory.slice(0, limit), correct: f.correct, total: f.total, accuracy: f.total ? +(f.correct / f.total * 100).toFixed(1) : null });
});
app.post('/api/admin/reset', requireAdmin, (req, res) => {
  const id = req.body?.game;
  const ids = id === 'all' ? Object.keys(FEEDS) : [id];
  if (!ids.length || ids.some(k => !FEEDS[k])) return res.status(400).json({ error: 'Game khÃ´ng há»£p lá»‡.' });
  for (const gameId of ids) {
    const f = FEEDS[gameId]; f.engine = (f.parser === 'baccarat') ? new BaccaratEngine() : new Engine(); f.history = []; f.accuracyHistory = []; f.lastSession = null;
    f.pendingPred = null; f.lastLive = null; f.correct = 0; f.total = 0; f._seen = [];
  }
  saveState(); logLine('reset engine(s): ' + ids.join(',')); res.json({ ok: true });
});
app.get('/api/admin/logs', requireAdmin, (req, res) => {
  try { return res.json({ logs: fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).slice(-200) }); }
  catch { return res.json({ logs: [] }); }
});

// ---------- admin: Telegram sales configuration and review queue ----------
app.get('/api/admin/settings', requireAdmin, (req, res) => res.json({ settings: botSettings, telegramConfigured: !!process.env.TELEGRAM_BOT_TOKEN, adminsConfigured: !!String(process.env.TELEGRAM_ADMIN_IDS || '').trim() }));
app.put('/api/admin/settings', requireAdmin, (req, res) => {
  try { botSettings = normalizeSettings({ ...botSettings, ...(req.body || {}) }); saveBotSettings(); logLine('bot settings updated'); res.json({ ok: true, settings: botSettings }); }
  catch (e) { res.status(400).json({ error: e.message || 'KhÃ´ng lÆ°u Ä‘Æ°á»£c cÃ i Ä‘áº·t.' }); }
});
app.get('/api/admin/requests', requireAdmin, (req, res) => {
  const status = String(req.query.status || 'all');
  const list = status === 'all' ? botRequests : botRequests.filter(r => r.status === status);
  res.json({ requests: list.slice(0, 500).map(publicRequest) });
});
app.post('/api/admin/requests/:id/review', requireAdmin, async (req, res) => {
  const approved = req.body?.approved === true;
  const result = reviewRequest(req.params.id, approved, 'web-admin');
  if (!result.ok) return res.status(400).json({ error: result.error });
  if (approved && result.key) {
    if (!telegramBot) return res.status(503).json({ error: 'Bot Telegram chÆ°a Ä‘Æ°á»£c khá»Ÿi Ä‘á»™ng; key Ä‘Ã£ táº¡o nhÆ°ng chÆ°a gá»­i Ä‘Æ°á»£c.' });
    try {
      await telegramBot.sendKeyToUser(result.request.telegramId, result.key, result.meta || {});
      markDelivered(result.request.id);
    } catch (e) { return res.status(502).json({ error: 'ÄÃ£ duyá»‡t nhÆ°ng khÃ´ng gá»­i Ä‘Æ°á»£c key qua Telegram: ' + e.message }); }
  }
  if (!approved && telegramBot) {
    try { await telegramBot.sendTextToUser(result.request.telegramId, `âŒ YÃªu cáº§u #${result.request.id} Ä‘Ã£ bá»‹ tá»« chá»‘i. Vui lÃ²ng kiá»ƒm tra láº¡i chá»©ng tá»« hoáº·c liÃªn há»‡ admin.`); } catch {}
  }
  res.json({ ok: true, request: publicRequest(result.request) });
});

// ---------- start bot + polling ----------
let telegramBot = null;
if (process.env.TELEGRAM_BOT_TOKEN) {
  telegramBot = startTelegramBot({
    token: process.env.TELEGRAM_BOT_TOKEN,
    adminIds: process.env.TELEGRAM_ADMIN_IDS || '',
    getConfig: () => botSettings,
    saveConfig: (cfg) => { botSettings = normalizeSettings(cfg); saveBotSettings(); },
    getSessions, saveSessions, addRequest,
    getRequests: () => botRequests,
    forceSaveRequests: () => saveRequests(),
    getKeys: () => keys,
    saveKeys,
    findKey,
    isExpired,
    createKey: args => createKey(args),
    reviewRequest,
    markDelivered,
  });
} else logLine('Telegram bot disabled: TELEGRAM_BOT_TOKEN is not set.');

setInterval(() => { Promise.all(Object.keys(FEEDS).map(id => pollFeed(id))); }, POLL_MS);
setInterval(saveState, 60000);
Promise.all(Object.keys(FEEDS).map(id => pollFeed(id)));
