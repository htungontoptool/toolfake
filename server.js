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
        this.marketState = { trend: 'CÂN BẰNG', regime: 'NORMAL' };

        // ===== SIÊU VIP ENGINE UPGRADE =====
        this.modelHits = {};        // EWMA do chinh xac tung model
        this.autocorr = 0;          // tu tuong quan lag-1 (+1: bet, -1: nhip)
        this.entropy = 1.0;
        this.streakSurvival = {};   // P(tiep tuc | do dai chuoi k) thuc nghiem
        this.balancedLastPreds = []; // model19 — chống bệt dự đoán
        this.initAllModels();
    }

    initAllModels() {
        for (let i = 1; i <= 10; i++) {
            if (this[`model${i}`]) {
                this.models[`model${i}`] = this[`model${i}`].bind(this);
                this.weights[`model${i}`] = i === 1 ? 0.15 : 1.0;
                this.modelHits[`model${i}`] = { win: 0, loss: 0, ewma: 0.5 };
            }
        }
        this.models['model_antiBreak'] = this.model_antiBreak.bind(this);
        this.weights['model_antiBreak'] = 1.7;
        this.modelHits['model_antiBreak'] = { win: 0, loss: 0, ewma: 0.5 };
        for (let i = 11; i <= 21; i++) {
            if (this[`model${i}`]) {
                this.models[`model${i}`] = this[`model${i}`].bind(this);
                this.weights[`model${i}`] = 1.0;
                this.modelHits[`model${i}`] = { win: 0, loss: 0, ewma: 0.5 };
            }
        }
        // Pattern-8 lookup weight hơi cao vì bảng thực nghiệm
        if (this.models['model16']) this.weights['model16'] = 1.35;
        if (this.models['model17']) this.weights['model17'] = 0.7; // RLE — giảm 1-1
        if (this.models['model18']) this.weights['model18'] = 1.25;
        if (this.models['model19']) this.weights['model19'] = 1.15;
        if (this.models['model20']) this.weights['model20'] = 1.45;
        if (this.models['model21']) this.weights['model21'] = 1.55; // đọc cầu cao cấp
        if (this.models['model_antiBreak']) this.weights['model_antiBreak'] = 1.9;
        if (this.models['model16']) this.weights['model16'] = 1.5; // pattern8 table
    }

    addResult(result, diceSum = null) {
        // Cap nhat trong so adaptive + EWMA do chinh xac tung model
        for (const [modelName, lastPred] of Object.entries(this.lastPredictions)) {
            if (lastPred && lastPred.prediction) {
                const hit = lastPred.prediction === result;
                if (hit) {
                    this.weights[modelName] = Math.min((this.weights[modelName] || 1.0) * 1.12, 3.5);
                } else {
                    const penalty = (modelName === 'model1' || modelName === 'model_antiBreak') ? 0.40 : 0.70;
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
        if (N < 8) { this.autocorr = 0; return; }
        const seq = this.history.slice(-N).map(c => c === 'T' ? 1 : -1);
        const mean = seq.reduce((a, b) => a + b, 0) / seq.length;
        let num = 0, den = 0;
        for (let i = 1; i < seq.length; i++) {
            num += (seq[i-1] - mean) * (seq[i] - mean);
            den += (seq[i] - mean) * (seq[i] - mean);
        }
        this.autocorr = den > 0 ? Math.max(-0.9, Math.min(0.9, num / den)) : 0;
    }

    updateStreakSurvival() {
        // P(chuoi tiep tuc | da chay k phien) — thuc nghiem tren toan bo lich su
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
        if (this.history.length < 10) return;
        const recent = this.history.slice(-15);
        const tCount = recent.filter(x => x === 'T').length;
        const xCount = recent.filter(x => x === 'X').length;
        const diff = Math.abs(tCount - xCount) / recent.length;

        if (this.autocorr < -0.18 || this.sessionStats.volatility > 0.7) {
            this.marketState.regime = 'Cầu Nhịp Ngắn (1-1 / 1-2)';
        } else if (diff > 0.4) {
            this.marketState.regime = tCount > xCount ? 'Cầu Nghiêng TÀI' : 'Cầu Nghiêng XỈU';
        } else if (this.sessionStats.streaks.T >= 3 || this.sessionStats.streaks.X >= 3) {
            this.marketState.regime = 'Cầu Bệt / Chuỗi Dài';
        } else {
            this.marketState.regime = 'Cầu Tách / Khuôn 2-2';
        }
        this.marketState.trend = tCount > xCount ? 'TÀI TẮC' : (xCount > tCount ? 'XỈU TẮC' : 'CÂN BẰNG');
    }

    // ===== CÁC MODEL DỰ ĐOÁN (giữ nguyên tên, nâng cấp logic) =====

    // Model 1: chỉ nhận 1-1 khi xác nhận rõ (6+ phiên đan xen) — tránh bắt 1-1 ảo
    model1() {
        const recent = this.history.slice(-10);
        if (recent.length < 8) return null;
        let flips = 0;
        for (let i = 1; i < recent.length; i++) if (recent[i] !== recent[i - 1]) flips++;
        if (flips < recent.length - 1) return null;
        const last = recent[recent.length - 1];
        const pred = last === 'T' ? 'X' : 'T';
        return { prediction: pred, confidence: 0.55, reason: `1-1 sạch ${recent.length} phiên → đảo nhẹ` };
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
                return { prediction: last, confidence: 0.85 + (streak * 0.02), reason: `Anti Bẻ Cầu: Chuỗi ${streak} (${last === 'T' ? 'TÀI' : 'XỈU'})` };
            }
            return null;
        }
        if (surv >= 0.52) {
            const conf = Math.min(0.6 + (surv - 0.5) * 1.5, 0.9);
            return { prediction: last, confidence: conf, reason: `Anti-Bẻ Thực Nghiệm: P(tiếp tục)=${(surv * 100).toFixed(0)}% @ chuỗi ${streak}` };
        } else if (surv <= 0.45) {
            const conf = Math.min(0.6 + (0.5 - surv) * 1.5, 0.9);
            return { prediction: last === 'T' ? 'X' : 'T', confidence: conf, reason: `Hazard Bẻ Cầu: P(đứt)=${((1 - surv) * 100).toFixed(0)}% @ chuỗi ${streak}` };
        }
        return null;
    }

    // Model 2: Bet dai — ket hop hazard thuc nghiem
    model2() {
        const last = this.history[this.history.length - 1];
        if (!last) return null;
        const streak = this.sessionStats.streaks[last] || 0;
        if (streak < 3) return null;
        const k = Math.min(streak, 8);
        const surv = this.streakSurvival[k];
        if (surv !== undefined) {
            if (streak <= 6 && surv >= 0.5) {
                return { prediction: last, confidence: Math.min(0.7 + surv * 0.2, 0.9), reason: `Cầu Bệt ${streak} Phiên (Hazard ${(surv * 100).toFixed(0)}% tiếp)` };
            }
            if (streak > 6 || surv < 0.42) {
                return { prediction: last === 'T' ? 'X' : 'T', confidence: 0.72, reason: `Cầu Quá Dài (${streak} Phiên) - Bẻ An Toàn` };
            }
            return null;
        }
        if (streak >= 3 && streak <= 6) return { prediction: last, confidence: 0.82, reason: `Cầu Bệt Dài ${streak} Phiên (Xu Hướng Trôi)` };
        if (streak > 6) return { prediction: last === 'T' ? 'X' : 'T', confidence: 0.70, reason: `Cầu Quá Dài (${streak} Phiên) - Bẻ An Toàn` };
        return null;
    }

    // Model 3: Khuon 2-2 / 3-1 — mo rong them mau
    model3() {
        const recent = this.history.slice(-4);
        if (recent.length < 4) return null;
        const str = recent.join('-');
        const map = {
            'T-T-X-X': { p: 'T', c: 0.80, r: 'Khuôn Cầu Đôi 2-2 (Ưu Tiên TÀI)' },
            'X-X-T-T': { p: 'X', c: 0.80, r: 'Khuôn Cầu Đôi 2-2 (Ưu Tiên XỈU)' },
            'T-X-X-T': { p: 'T', c: 0.76, r: 'Khuôn Cầu Kép 2-1-2' },
            'X-T-T-X': { p: 'X', c: 0.76, r: 'Khuôn Cầu Kép 2-1-2' },
            'T-T-T-X': { p: 'T', c: 0.70, r: 'Mẫu Cầu 3-1 (Lệch Pha)' },
            'X-X-X-T': { p: 'X', c: 0.70, r: 'Mẫu Cầu 3-1 (Lệch Pha)' },
            'T-X-T-T': { p: 'T', c: 0.68, r: 'Mẫu 1-2-1 Kéo Dài' },
            'X-T-X-X': { p: 'X', c: 0.68, r: 'Mẫu 1-2-1 Kéo Dài' }
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
        if (str === 'T-X-X-T-T') return { prediction: 'X', confidence: 0.74, reason: 'Cầu Tách Mẫu 1-2-1-1 (Hồi XỈU)' };
        if (str === 'X-T-T-X-X') return { prediction: 'T', confidence: 0.74, reason: 'Cầu Tách Mẫu 1-2-1-1 (Hồi TÀI)' };
        if (str === 'T-T-X-X-T') return { prediction: 'X', confidence: 0.72, reason: 'Mẫu 2-2-1 Đảo Chiều' };
        if (str === 'X-X-T-T-X') return { prediction: 'T', confidence: 0.72, reason: 'Mẫu 2-2-1 Đảo Chiều' };
        return null;
    }

    // Model 5: Diem nut cuc han
    model5() {
        if (this.detailedHistory.length === 0) return null;
        const lastSum = this.detailedHistory[this.detailedHistory.length - 1];
        if (lastSum <= 4) return { prediction: 'T', confidence: 0.88, reason: `Nút Cực Thấp (${lastSum} Nút) - Hồi Quy TÀI` };
        if (lastSum >= 17) return { prediction: 'X', confidence: 0.88, reason: `Nút Cực Cao (${lastSum} Nút) - Hồi Quy XỈU` };
        return null;
    }

    // Model 6: Trung binh diem nut
    model6() {
        if (this.detailedHistory.length < 4) return null;
        const avg = this.sessionStats.sumAverage;
        if (avg > 11.8) {
            return { prediction: 'X', confidence: Math.min(0.65 + (avg - 10.5) * 0.08, 0.85), reason: `Điểm Trung Bình Cao (${avg.toFixed(1)}) - Ép XỈU` };
        } else if (avg < 9.2) {
            return { prediction: 'T', confidence: Math.min(0.65 + (10.5 - avg) * 0.08, 0.85), reason: `Điểm Trung Bình Thấp (${avg.toFixed(1)}) - Ép TÀI` };
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
        if (tot < 6) return null;
        const pCont = (cCont + 0.5) / (tot + 1);
        if (Math.abs(pCont - 0.5) < 0.08) return null;
        const pred = pCont > 0.5 ? last : other;
        const conf = Math.min(0.55 + Math.abs(pCont - 0.5) * 1.2, 0.85);
        return { prediction: pred, confidence: conf, reason: `Markov Bậc 1: P(${pred === 'T' ? 'TÀI' : 'XỈU'})=${(Math.max(pCont, 1 - pCont) * 100).toFixed(0)}% (${tot} mẫu)` };
    }

    // Model 8: N-gram Markov bac bien (2..5) co trong so thoi gian — model manh nhat
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
        return { prediction: pred, confidence: conf, reason: `N-gram Markov Bậc ${bestOrder} (${bestSupport.toFixed(1)} mẫu có trọng số)` };
    }

    // Model 9: Regime adapter dua tren tu tuong quan (bet vs nhip)
    model9() {
        if (this.history.length < 15) return null;
        const ac = this.autocorr;
        if (Math.abs(ac) < 0.18) return null;
        const last = this.history[this.history.length - 1];
        if (ac > 0) {
            return { prediction: last, confidence: Math.min(0.55 + ac * 0.8, 0.82), reason: `Regime Xu Hướng (autocorr=${ac.toFixed(2)}) → Theo Chuỗi` };
        } else {
            return { prediction: last === 'T' ? 'X' : 'T', confidence: Math.min(0.55 + (-ac) * 0.8, 0.82), reason: `Regime Nhịp (autocorr=${ac.toFixed(2)}) → Đảo Chiều` };
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
        return { prediction: pred, confidence: conf, reason: `Tỷ Lệ Thực Tế ${n} phiên: TÀI ${(pT * 100).toFixed(0)}%` };
    }

    // ===== CHẾ ĐỘ TIẾP TỤC HUẤN LUYỆN (không ảnh hưởng giao diện) =====
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
            // dam bao cac model moi deu co trong so / EWMA mac dinh
            for (const k in this.models) {
                if (!(k in this.weights)) {
                    this.weights[k] = (k === 'model1') ? 0.25
                        : (k === 'model_antiBreak' ? 1.55
                        : (k === 'model19' ? 1.15
                        : (k === 'model17' ? 0.85 : 1.0)));
                }
                if (!(k in this.modelHits)) this.modelHits[k] = { win: 0, loss: 0, ewma: 0.5 };
            }
            // Chống bias 1-1 từ state cũ: hạ model1, nâng antiBreak
            if (this.weights['model1'] && this.weights['model1'] > 0.2) this.weights['model1'] = 0.08;
            if (this.weights['model17'] && this.weights['model17'] > 0.75) this.weights['model17'] = 0.7;
            if (this.models['model_antiBreak'] && (!this.weights['model_antiBreak'] || this.weights['model_antiBreak'] < 1.3))
                this.weights['model_antiBreak'] = 1.9;
        } catch (e) { console.warn('loadState failed:', e); }
    }

    // ===== MODEL 11-15: tích hợp từ thuattoan8.txt + thuattoan123/sun_algo =====
    // Model 11: Bảng tra cứu 8-gram (4950 mẫu, majority vote trên 256 tổ hợp)
    model11() {
        if (this.history.length < 8) return null;
        const key = this.history.slice(-8).join('');
        if (!this._gram8) this._gram8 = {"TTTTTTTT":"T","TTTTTTTX":"X","TTTTTTXT":"X","TTTTTTXX":"X","TTTTTXTT":"X","TTTTTXTX":"T","TTTTTXXT":"T","TTTTTXXX":"X","TTTTXTTT":"T","TTTTXTTX":"X","TTTTXTXT":"T","TTTTXTXX":"T","TTTTXXTT":"T","TTTTXXTX":"X","TTTTXXXT":"X","TTTTXXXX":"X","TTTXTTTT":"X","TTTXTTTX":"X","TTTXTTXT":"X","TTTXTTXX":"X","TTTXTXTT":"X","TTTXTXTX":"T","TTTXTXXT":"X","TTTXTXXX":"X","TTTXXTTT":"T","TTTXXTTX":"T","TTTXXTXT":"T","TTTXXTXX":"X","TTTXXXTT":"X","TTTXXXTX":"X","TTTXXXXT":"T","TTTXXXXX":"X","TTXTTTTT":"X","TTXTTTTX":"X","TTXTTTXT":"T","TTXTTTXX":"T","TTXTTXTT":"T","TTXTTXTX":"T","TTXTTXXT":"X","TTXTTXXX":"T","TTXTXTTT":"T","TTXTXTTX":"T","TTXTXTXT":"X","TTXTXTXX":"X","TTXTXXTT":"T","TTXTXXTX":"T","TTXTXXXT":"X","TTXTXXXX":"T","TTXXTTTT":"T","TTXXTTTX":"X","TTXXTTXT":"X","TTXXTTXX":"T","TTXXTXTT":"T","TTXXTXTX":"T","TTXXTXXT":"X","TTXXTXXX":"T","TTXXXTTT":"X","TTXXXTTX":"T","TTXXXTXT":"T","TTXXXTXX":"X","TTXXXXTT":"X","TTXXXXTX":"X","TTXXXXXT":"X","TTXXXXXX":"T","TXTTTTTT":"X","TXTTTTTX":"X","TXTTTTXT":"X","TXTTTTXX":"X","TXTTTXTT":"T","TXTTTXTX":"X","TXTTTXXT":"X","TXTTTXXX":"X","TXTTXTTT":"T","TXTTXTTX":"X","TXTTXTXT":"X","TXTTXTXX":"T","TXTTXXTT":"T","TXTTXXTX":"T","TXTTXXXT":"X","TXTTXXXX":"T","TXTXTTTT":"T","TXTXTTTX":"T","TXTXTTXT":"T","TXTXTTXX":"T","TXTXTXTT":"X","TXTXTXTX":"X","TXTXTXXT":"X","TXTXTXXX":"T","TXTXXTTT":"X","TXTXXTTX":"X","TXTXXTXT":"T","TXTXXTXX":"T","TXTXXXTT":"X","TXTXXXTX":"T","TXTXXXXT":"X","TXTXXXXX":"X","TXXTTTTT":"T","TXXTTTTX":"X","TXXTTTXT":"T","TXXTTTXX":"T","TXXTTXTT":"X","TXXTTXTX":"T","TXXTTXXT":"X","TXXTTXXX":"X","TXXTXTTT":"T","TXXTXTTX":"X","TXXTXTXT":"X","TXXTXTXX":"T","TXXTXXTT":"T","TXXTXXTX":"X","TXXTXXXT":"X","TXXTXXXX":"X","TXXXTTTT":"T","TXXXTTTX":"X","TXXXTTXT":"T","TXXXTTXX":"T","TXXXTXTT":"X","TXXXTXTX":"T","TXXXTXXT":"X","TXXXTXXX":"T","TXXXXTTT":"T","TXXXXTTX":"X","TXXXXTXT":"T","TXXXXTXX":"T","TXXXXXTT":"X","TXXXXXTX":"X","TXXXXXXT":"T","TXXXXXXX":"T","XTTTTTTT":"T","XTTTTTTX":"T","XTTTTTXT":"T","XTTTTTXX":"X","XTTTTXTT":"T","XTTTTXTX":"T","XTTTTXXT":"X","XTTTTXXX":"X","XTTTXTTT":"X","XTTTXTTX":"T","XTTTXTXT":"T","XTTTXTXX":"X","XTTTXXTT":"T","XTTTXXTX":"T","XTTTXXXT":"T","XTTTXXXX":"X","XTTXTTTT":"T","XTTXTTTX":"T","XTTXTTXT":"X","XTTXTTXX":"T","XTTXTXTT":"X","XTTXTXTX":"X","XTTXTXXT":"T","XTTXTXXX":"X","XTTXXTTT":"T","XTTXXTTX":"T","XTTXXTXT":"X","XTTXXTXX":"X","XTTXXXTT":"X","XTTXXXTX":"T","XTTXXXXT":"X","XTTXXXXX":"T","XTXTTTTT":"T","XTXTTTTX":"T","XTXTTTXT":"X","XTXTTTXX":"T","XTXTTXTT":"T","XTXTTXTX":"T","XTXTTXXT":"X","XTXTTXXX":"X","XTXTXTTT":"T","XTXTXTTX":"T","XTXTXTXT":"T","XTXTXTXX":"X","XTXTXXTT":"T","XTXTXXTX":"X","XTXTXXXT":"T","XTXTXXXX":"T","XTXXTTTT":"X","XTXXTTTX":"T","XTXXTTXT":"T","XTXXTTXX":"T","XTXXTXTT":"X","XTXXTXTX":"T","XTXXTXXT":"T","XTXXTXXX":"T","XTXXXTTT":"T","XTXXXTTX":"X","XTXXXTXT":"X","XTXXXTXX":"T","XTXXXXTT":"T","XTXXXXTX":"T","XTXXXXXT":"X","XTXXXXXX":"T","XXTTTTTT":"X","XXTTTTTX":"T","XXTTTTXT":"T","XXTTTTXX":"X","XXTTTXTT":"T","XXTTTXTX":"X","XXTTTXXT":"X","XXTTTXXX":"T","XXTTXTTT":"X","XXTTXTTX":"X","XXTTXTXT":"X","XXTTXTXX":"T","XXTTXXTT":"T","XXTTXXTX":"T","XXTTXXXT":"T","XXTTXXXX":"X","XXTXTTTT":"T","XXTXTTTX":"X","XXTXTTXT":"T","XXTXTTXX":"T","XXTXTXTT":"T","XXTXTXTX":"X","XXTXTXXT":"T","XXTXTXXX":"T","XXTXXTTT":"T","XXTXXTTX":"X","XXTXXTXT":"X","XXTXXTXX":"X","XXTXXXTT":"T","XXTXXXTX":"X","XXTXXXXT":"X","XXTXXXXX":"T","XXXTTTTT":"T","XXXTTTTX":"X","XXXTTTXT":"T","XXXTTTXX":"T","XXXTTXTT":"T","XXXTTXTX":"X","XXXTTXXT":"X","XXXTTXXX":"X","XXXTXTTT":"X","XXXTXTTX":"X","XXXTXTXT":"T","XXXTXTXX":"X","XXXTXXTT":"T","XXXTXXTX":"X","XXXTXXXT":"T","XXXTXXXX":"T","XXXXTTTT":"T","XXXXTTTX":"T","XXXXTTXT":"T","XXXXTTXX":"T","XXXXTXTT":"T","XXXXTXTX":"T","XXXXTXXT":"T","XXXXTXXX":"T","XXXXXTTT":"T","XXXXXTTX":"T","XXXXXTXT":"T","XXXXXTXX":"X","XXXXXXTT":"X","XXXXXXTX":"T","XXXXXXXT":"T","XXXXXXXX":"X"};
        const pred = this._gram8[key];
        if (!pred) return null;
        return { prediction: pred, confidence: 0.72, reason: `Bảng Tra Cứu 8-Gram: [${key}] → ${pred === 'T' ? 'TÀI' : 'XỈU'}` };
    }
    // Model 12: Cyclic-7 — 7 phiên cuối trùng hoàn toàn 7 phiên liền trước → theo chu kỳ
    model12() {
        if (this.history.length < 14) return null;
        const a = this.history.slice(-7).join('');
        const b = this.history.slice(-14, -7).join('');
        if (a !== b) return null;
        const pred = this.history[this.history.length - 7];
        return { prediction: pred, confidence: 0.75, reason: `Chu Kỳ 7 Phiên Lặp Lại → theo chu kỳ ${pred === 'T' ? 'TÀI' : 'XỈU'}` };
    }
    // Model 13: Momentum-break — 6 phiên lệch mạnh, 3 phiên cuối ngược chiều → quay lại momentum
    model13() {
        if (this.history.length < 9) return null;
        const first6 = this.history.slice(-9, -3);
        const last3 = this.history.slice(-3);
        const t6 = first6.filter(x => x === 'T').length;
        if (Math.abs(t6 - (6 - t6)) < 4) return null;
        if (!(last3[0] === last3[1] && last3[1] === last3[2])) return null;
        const momSide = t6 > 3 ? 'T' : 'X';
        if (last3[0] === momSide) return null;
        return { prediction: momSide, confidence: 0.71, reason: `Momentum Bị Phá Vỡ (3 phiên ngược) → Quay Lại ${momSide === 'T' ? 'TÀI' : 'XỈU'}` };
    }
    // Model 14: 5 phiên đan xen hoàn hảo → tiếp tục nhịp (đảo chiều)
    model14() {
        if (this.history.length < 5) return null;
        const last5 = this.history.slice(-5);
        for (let i = 1; i < 5; i++) if (last5[i] === last5[i-1]) return null;
        const pred = last5[4] === 'T' ? 'X' : 'T';
        return { prediction: pred, confidence: 0.68, reason: '5 Phiên Đan Xen Hoàn Hảo → Tiếp Tục Nhịp (Đảo Chiều)' };
    }
    // Model 15: Mất cân bằng động — 6/8 hoặc 4/6 nghiêng một bên, phiên cuối là bên đó → hồi quy
    model15() {
        if (this.history.length < 8) return null;
        const last8 = this.history.slice(-8);
        const t8 = last8.filter(x => x === 'T').length;
        const last = last8[7];
        if (t8 >= 6 && last === 'T') return { prediction: 'X', confidence: 0.78, reason: `Mất Cân Nặng Mạnh (${t8}/8 TÀI, cuối TÀI) → Hồi Quy XỈU` };
        if ((8 - t8) >= 6 && last === 'X') return { prediction: 'T', confidence: 0.78, reason: `Mất Cân Nặng Mạnh (${8 - t8}/8 XỈU, cuối XỈU) → Hồi Quy TÀI` };
        const last6 = last8.slice(-6);
        const t6 = last6.filter(x => x === 'T').length;
        if (t6 >= 4 && last === 'T') return { prediction: 'X', confidence: 0.72, reason: `Mất Cân Nặng (${t6}/6 TÀI, cuối TÀI) → Hồi Quy XỈU` };
        if ((6 - t6) >= 4 && last === 'X') return { prediction: 'T', confidence: 0.72, reason: `Mất Cân Nặng (${6 - t6}/6 XỈU, cuối XỈU) → Hồi Quy TÀI` };
        return null;
    }

    getAllPredictions() {
        const predictions = {};
        for (const [modelName, modelFunc] of Object.entries(this.models)) {
            try {
                const res = modelFunc();
                if (res) {
                    predictions[modelName] = res;
                    this.lastPredictions[modelName] = res;
                }
            } catch (e) {
                console.error(`Error in ${modelName}:`, e);
            }
        }
        return predictions;
    }

    // MODEL 16: Bảng pattern 8-ký tự (thuattoan8) — lookup chuỗi gần nhất
    model16() {
        if (this.history.length < 4) return null;
        const table = Engine.PATTERN8 || {};
        // thử từ dài → ngắn
        for (let len = 8; len >= 4; len--) {
            if (this.history.length < len) continue;
            const key = this.history.slice(-len).join('');
            if (table[key]) {
                const pred = table[key];
                return {
                    prediction: pred,
                    confidence: len >= 8 ? 0.78 : (len >= 6 ? 0.68 : 0.58),
                    reason: `Pattern-${len} khớp bảng cầu (${key} → ${pred === 'T' ? 'TÀI' : 'XỈU'})`
                };
            }
        }
        return null;
    }

    // MODEL 17: RLE — đọc cầu thật (bệt / 2-2 / 3-3 / a-b), KHÔNG mặc định 1-1
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

        // --- Bệt đang chạy (count >= 2): ưu tiên TIẾP tục, không vội đảo ---
        if (last[1] >= 2) {
            // nhịp a-b ổn định: prev.count == last.count và prev2 cùng pattern
            if (prev && last[1] === prev[1] && last[1] >= 2) {
                // vừa khép nhịp a-b (vd 2-2 vừa đủ) → đảo sang cửa kia bắt nhịp mới
                const pred = last[0] === 'T' ? 'X' : 'T';
                return { prediction: pred, confidence: 0.70, reason: `Nhịp ${prev[1]}-${last[1]} vừa khép → sang cửa kia` };
            }
            // đang trong bệt / nhịp chưa đủ so với nhịp trước → TIẾP
            if (prev && last[1] < prev[1]) {
                return { prediction: last[0], confidence: 0.68 + Math.min(0.1, last[1] * 0.02), reason: `Theo nhịp ${prev[1]}-${last[1]}: tiếp ${last[0] === 'T' ? 'TÀI' : 'XỈU'}` };
            }
            // bệt thuần (không có prev hoặc prev ngắn)
            if (last[1] >= 3 && last[1] <= 6) {
                return { prediction: last[0], confidence: 0.72 + Math.min(0.12, (last[1] - 3) * 0.03), reason: `Cầu bệt ${last[1]} → tiếp ${last[0] === 'T' ? 'TÀI' : 'XỈU'}` };
            }
            // bệt quá dài (>=7) mới nghiêng gãy
            if (last[1] >= 7) {
                const pred = last[0] === 'T' ? 'X' : 'T';
                return { prediction: pred, confidence: Math.min(0.78, 0.55 + last[1] * 0.03), reason: `Bệt ${last[1]} dài → nghiêng gãy` };
            }
            // streak 2: tiếp nhẹ
            return { prediction: last[0], confidence: 0.62, reason: `Streak 2 → nghiêng tiếp ${last[0] === 'T' ? 'TÀI' : 'XỈU'}` };
        }

        // --- last count === 1: vừa flip ---
        if (last[1] === 1 && prev) {
            // Nếu trước đó là bệt dài (>=3) rồi mới 1 nhịp ngược → có thể gãy cầu, chưa chắc 1-1
            // → dự đoán theo hướng "xác nhận gãy" (tiếp cửa mới) với conf thấp-trung
            if (prev[1] >= 3) {
                return { prediction: last[0], confidence: 0.60, reason: `Bệt ${prev[1]} gãy 1 nhịp → xác nhận cửa ${last[0] === 'T' ? 'TÀI' : 'XỈU'}` };
            }
            // True 1-1: nhiều đoạn count=1 liên tiếp
            const ones = [];
            for (let i = rle.length - 1; i >= 0 && rle[i][1] === 1; i--) ones.push(rle[i]);
            if (ones.length >= 6) {
                const pred = last[0] === 'T' ? 'X' : 'T';
                return { prediction: pred, confidence: 0.60, reason: `1-1 xác nhận (${ones.length} nhịp) → đảo` };
            }
            // 2-1 hoặc nhiễu: không ép 1-1 — theo cửa vừa ra (xác nhận)
            if (prev[1] === 2) {
                return { prediction: last[0], confidence: 0.58, reason: 'Nhịp 2-1: xác nhận cửa mới' };
            }
            // mặc định: không đoán 1-1 ảo
            return null;
        }

        return null;
    }

    // MODEL 18: Dynamic patterns (từ UltraDice — mất cân / chu kỳ / momentum break)
    model18() {
        const h = this.history;
        if (h.length < 6) return null;
        // 4T/6 cuối T → X
        const last6 = h.slice(-6);
        if (last6.filter(x => x === 'T').length >= 4 && last6[5] === 'T') {
            return { prediction: 'X', confidence: 0.72, reason: '4+T/6 phiên, cuối T → hồi XỈU' };
        }
        if (last6.filter(x => x === 'X').length >= 4 && last6[5] === 'X') {
            return { prediction: 'T', confidence: 0.72, reason: '4+X/6 phiên, cuối X → hồi TÀI' };
        }
        if (h.length >= 8) {
            const last8 = h.slice(-8);
            const t8 = last8.filter(x => x === 'T').length;
            if (t8 >= 6 && last8[7] === 'T') return { prediction: 'X', confidence: 0.78, reason: '6+T/8, cuối T → X mạnh' };
            if ((8 - t8) >= 6 && last8[7] === 'X') return { prediction: 'T', confidence: 0.78, reason: '6+X/8, cuối X → T mạnh' };
        }
        // 5 phiên đan xen
        if (h.length >= 5) {
            const last5 = h.slice(-5);
            let alt = true;
            for (let i = 1; i < 5; i++) if (last5[i] === last5[i - 1]) { alt = false; break; }
            if (alt) {
                const pred = last5[4] === 'T' ? 'X' : 'T';
                return { prediction: pred, confidence: 0.68, reason: '5 phiên đan xen → đảo' };
            }
        }
        // chu kỳ 7
        if (h.length >= 14) {
            const a = h.slice(-14, -7).join('');
            const b = h.slice(-7).join('');
            if (a === b) {
                return { prediction: h[h.length - 7], confidence: 0.75, reason: 'Chu kỳ 7 lặp → theo chu kỳ' };
            }
        }
        return null;
    }

    // MODEL 19: Balanced Predictor v3 — tỷ lệ cửa sổ + Markov + streak + random có kiểm soát
    model19() {
        const h = this.history;
        if (!h || h.length < 10) return null;

        // history engine: cũ → mới; balanced gốc dùng mới → cũ → đảo
        const results = h.slice().reverse(); // [0] = mới nhất
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

        // streak từ phiên mới nhất
        let streak = 1;
        const currentSide = results[0];
        for (let i = 1; i < results.length; i++) {
            if (results[i] === currentSide) streak++;
            else break;
        }

        // Markov bậc 1 (trên chuỗi mới→cũ vẫn đúng transition nếu duyệt i → i+1 theo hướng thời gian ngược... 
        // Dùng chuỗi theo thời gian tăng: h
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
        markovT = markovT * 0.7 + 0.15; // làm mượt về 0.5

        // trend score
        const avgRatio = (totalRatio + recent10 + recent20 + recent50) / 4;
        let trendScore = (avgRatio - 0.5) * 2;
        const markovScore = (markovT - 0.5) * 2;
        trendScore = trendScore * 0.7 + markovScore * 0.3;

        // streak ngắn-trung (2-5): CỘNG theo hướng bệt, không vội đảo
        if (streak >= 2 && streak <= 5) {
            const direction = currentSide === 'T' ? 1 : -1;
            trendScore += direction * (0.08 + streak * 0.03);
        }
        // chỉ khi bệt rất dài (>=6) mới nghiêng gãy nhẹ
        if (streak >= 6) {
            const direction = currentSide === 'T' ? 1 : -1;
            if (trendScore * direction > 0) {
                trendScore -= direction * 0.15 * Math.min(1, (streak - 5) / 4);
            }
        }

        // random có kiểm soát
        let finalScore;
        if (Math.abs(trendScore) < 0.15) {
            const base = (totalRatio - 0.5) * 2;
            const noise = (Math.random() * 0.3) - 0.15;
            finalScore = base * 0.5 + noise;
        } else {
            const noise = (Math.random() * 0.2) - 0.1;
            finalScore = Math.min(0.6, Math.max(-0.6, trendScore + noise));
        }

        // chống bệt dự đoán model này
        const recent = this.balancedLastPreds.slice(-3);
        if (recent.length === 3 && recent.every(p => p === recent[0])) {
            finalScore = -finalScore * 0.8;
        }

        const prediction = finalScore > 0 ? 'T' : 'X';
        this.balancedLastPreds.push(prediction);
        if (this.balancedLastPreds.length > 20) this.balancedLastPreds.shift();

        const confidence = Math.min(0.85, Math.max(0.5, 0.5 + Math.abs(finalScore) * 0.4));
        let reason;
        if (streak >= 6) reason = `Balanced: bệt ${streak} ${currentSide === 'T' ? 'Tài' : 'Xỉu'} → nghiêng gãy`;
        else if (streak >= 2) reason = `Balanced: theo bệt ${streak} ${currentSide === 'T' ? 'Tài' : 'Xỉu'}`;
        else reason = `Balanced v3 · trend ${trendScore.toFixed(2)}`;

        return { prediction, confidence, reason };
    }


    // MODEL 20: VIP Pattern Reader — đọc cầu đa khung + majority + streak context
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

        // Cầu bệt rõ
        if (streak >= 3 && streak <= 5) {
            return { prediction: last, confidence: 0.74 + Math.min(0.1, streak * 0.02), reason: `VIP: bệt ${streak} → theo ${last === 'T' ? 'TÀI' : 'XỈU'}` };
        }
        if (streak >= 6) {
            // hazard: long streak often breaks but not always
            const breakP = Math.min(0.55, 0.35 + (streak - 6) * 0.04);
            if (breakP > 0.48) {
                return { prediction: last === 'T' ? 'X' : 'T', confidence: 0.62 + (streak - 6) * 0.02, reason: `VIP: bệt ${streak} dài → nghiêng gãy` };
            }
            return { prediction: last, confidence: 0.6, reason: `VIP: bệt ${streak} còn giữ` };
        }

        // Nhịp đều a-a (2-2, 3-3)
        if (segs.length >= 4) {
            const a = segs[segs.length - 1], b = segs[segs.length - 2], c2 = segs[segs.length - 3];
            if (a[1] === b[1] && a[1] >= 2 && a[1] === c2[1]) {
                // vừa đủ nhịp → đảo
                if (a[1] === b[1]) {
                    return { prediction: a[0] === 'T' ? 'X' : 'T', confidence: 0.71, reason: `VIP: nhịp ${a[1]}-${a[1]} đều → sang cửa` };
                }
            }
            if (b[1] >= 2 && a[1] < b[1] && a[1] >= 1) {
                return { prediction: a[0], confidence: 0.66, reason: `VIP: theo nhịp ${b[1]} → tiếp` };
            }
        }

        // Majority cửa sổ 8/12/20 lệch rõ
        const votes = { T: 0, X: 0 };
        [8, 12, 20].forEach(sz => {
            if (h.length < sz) return;
            const sl = h.slice(-sz);
            const tC = sl.filter(x => x === 'T').length;
            if (tC / sz >= 0.62) votes.T++;
            else if (tC / sz <= 0.38) votes.X++;
        });
        if (votes.T >= 2) return { prediction: 'T', confidence: 0.64, reason: 'VIP: đa khung nghiêng TÀI' };
        if (votes.X >= 2) return { prediction: 'X', confidence: 0.64, reason: 'VIP: đa khung nghiêng XỈU' };

        // True 1-1 only
        const last6 = h.slice(-6).join('');
        if (last6 === 'TXTXTX' || last6 === 'XTXTXT') {
            return { prediction: last === 'T' ? 'X' : 'T', confidence: 0.63, reason: 'VIP: 1-1 sạch 6 phiên' };
        }
        return null;
    }


    // MODEL 21: Đọc cầu chất lượng cao — phân loại cầu + độ tin theo độ ổn định nhịp
    model21() {
        const h = this.history;
        if (!h || h.length < 10) return null;
        const segs = [];
        let c = h[0], n = 1;
        for (let i = 1; i < h.length; i++) {
            if (h[i] === c) n++; else { segs.push([c, n]); c = h[i]; n = 1; }
        }
        segs.push([c, n]);
        const last = segs[segs.length - 1];
        const prev = segs.length >= 2 ? segs[segs.length - 2] : null;
        // Cầu bệt ổn định 3-5
        if (last[1] >= 3 && last[1] <= 5) {
            return { prediction: last[0], confidence: 0.76 + Math.min(0.08, (last[1] - 3) * 0.02), reason: `Cầu bệt ${last[1]} rõ → theo ${last[0] === 'T' ? 'TÀI' : 'XỈU'}` };
        }
        // Nhịp k-k đều (2-2, 3-3)
        if (prev && last[1] === prev[1] && last[1] >= 2 && segs.length >= 4) {
            const p2 = segs[segs.length - 3];
            if (p2[1] === last[1]) {
                return { prediction: last[0] === 'T' ? 'X' : 'T', confidence: 0.73, reason: `Nhịp ${last[1]}-${last[1]} khép → sang cửa` };
            }
        }
        // Đang dở nhịp so với prev
        if (prev && last[1] < prev[1] && last[1] >= 1 && prev[1] >= 2) {
            return { prediction: last[0], confidence: 0.70, reason: `Theo nhịp ${prev[1]}: tiếp ${last[0] === 'T' ? 'TÀI' : 'XỈU'} (${last[1]}/${prev[1]})` };
        }
        // 1-1 thật: ≥5 đoạn count=1
        let ones = 0;
        for (let i = segs.length - 1; i >= 0 && segs[i][1] === 1; i--) ones++;
        if (ones >= 7) {
            return { prediction: last[0] === 'T' ? 'X' : 'T', confidence: 0.62, reason: `1-1 sạch ${ones} nhịp → đảo` };
        }
        return null;
    }

    // Ensemble: Log-odds pooling + trong so EWMA accuracy + shrink + cooling
    getEnsemblePrediction() {
        const allPreds = this.getAllPredictions();
        let logOdds = 0;   // >0 ung voi TAI
        let totalWeight = 0;
        let activeCount = 0;
        let topReason = 'Thuật Toán Engine @SunNetWin';
        let highestW = 0;

        const regime = (this.marketState && this.marketState.regime) || '';
        const isBet = /Bệt|Chuỗi/.test(regime);
        const isNhip = /Nhịp|1-1/.test(regime);

        for (const [modelName, pred] of Object.entries(allPreds)) {
            if (!pred || !pred.prediction) continue;
            let baseW = (this.weights[modelName] !== undefined ? this.weights[modelName] : 1.0);
            // Regime-aware: bệt → boost antiBreak/model20; 1-1 regime → modest model1
            if (isBet && (modelName === 'model_antiBreak' || modelName === 'model20' || modelName === 'model17')) baseW *= 1.25;
            if (isNhip && modelName === 'model1') baseW *= 1.1;
            if (isBet && modelName === 'model1') baseW *= 0.25;
            if (isBet && modelName === 'model_antiBreak') baseW *= 1.35; // đừng bắt 1-1 khi đang bệt
            const ewma = this.modelHits[modelName] ? this.modelHits[modelName].ewma : 0.5;
            const accMult = 0.5 + ewma;
            const w = baseW * accMult * pred.confidence;
            activeCount++;

            const p = pred.prediction === 'T' ? pred.confidence : (1 - pred.confidence);
            const pc = Math.min(Math.max(p, 0.1), 0.9);
            logOdds += w * Math.log(pc / (1 - pc));
            totalWeight += w;

            if (w > highestW) { highestW = w; topReason = pred.reason; }
        }

        if (totalWeight === 0) {
            // Fallback: dung ty le co so tu lich su gan nhat (khong random nhu ban cu)
            const recent = this.history.slice(-20);
            const tFreq = recent.length ? recent.filter(c => c === 'T').length / recent.length : 0.5;
            const pT = (tFreq * recent.length + 1) / (recent.length + 2);
            let taiProb = Math.round(pT * 100);
            taiProb = Math.min(Math.max(taiProb, 35), 65);
            const xiuProb = 100 - taiProb;
            const isTai = taiProb >= 50;
            return {
                predictedResult: isTai ? 'TÀI' : 'XỈU',
                confidence: isTai ? taiProb : xiuProb,
                taiProb: taiProb,
                xiuProb: xiuProb,
                activeModels: 0,
                topReason: 'Đang phân tích dữ liệu & khởi tạo Engine @SunNetWin...'
            };
        }

        // Shrink ve 0.5 khi tong trong so thap (it chung khoan)
        const shrink = Math.min(1, totalWeight / 5);
        const aggLo = logOdds * shrink;
        let pT = 1 / (1 + Math.exp(-aggLo));

        // Cooling: khi thua lien tiep, keo xac suat ve 50% (giam tu tin)
        const cool = Math.max(0.5, 1 - this.consecutiveLosses * 0.12);
        pT = 0.5 + (pT - 0.5) * cool;

        let taiProb = Math.round(pT * 100);
        taiProb = Math.min(Math.max(taiProb, 22), 94);
        const xiuProb = 100 - taiProb;
        const isTai = taiProb >= 50;
        const finalConfidence = isTai ? taiProb : xiuProb;

        return {
            predictedResult: isTai ? 'TÀI' : 'XỈU',
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
    // pattern8 nhúng sẵn — không cần file pattern8.json
    Engine.PATTERN8 = {"TXXTTXTX": "X", "XXTTXTXX": "X", "XTTXTXXT": "X", "TTXTXXTT": "X", "TXTXXTTT": "X", "XTXXTTTX": "T", "TXXTTTXX": "X", "XXTTTXXT": "T", "XTTTXXTX": "T", "TTTXXTXX": "X", "TTXXTXXX": "X", "TXXTXXXX": "X", "XXTXXXXX": "X", "XTXXXXXT": "T", "TXXXXXTX": "T", "XXXXXTXX": "X", "XXXXTXXX": "T", "XXXTXXXT": "T", "XXTXXXTX": "X", "XTXXXTXX": "T", "TXXXTXXX": "T", "XXXTXXXX": "X", "XXTXXXXT": "X", "XTXXXXTT": "X", "TXXXXTTX": "X", "XXXXTTXX": "X", "XXXTTXXX": "T", "XXTTXXXT": "T", "XTTXXXTX": "T", "TTXXXTXT": "T", "TXXXTXTX": "T", "XXXTXTXT": "X", "XXTXTXTT": "T", "XTXTXTTT": "X", "TXTXTTTT": "T", "XTXTTTTT": "X", "TXTTTTTT": "X", "XTTTTTTX": "X", "TTTTTTXT": "X", "TTTTTXTX": "X", "TTTTXTXT": "X", "TTTXTXTT": "X", "TTXTXTTX": "X", "TXTXTTXT": "X", "XTXTTXTX": "T", "TXTTXTXT": "T", "XTTXTXTT": "X", "TXTTXTXX": "X", "XTTXTXXX": "X", "TTXTXXXT": "T", "TXTXXXTT": "X", "XTXXXTTX": "T", "TXXXTTXX": "T", "XXXTTXXT": "X", "XXTTXXTX": "T", "XTTXXTXX": "X", "TXXTXXXT": "X", "XXTXXXTT": "T", "XTXXXTTT": "T", "TXXXTTTT": "X", "XXXTTTTT": "T", "XXTTTTTT": "X", "TTTTTTXX": "X", "TTTTTXXX": "T", "TTTTXXXT": "X", "TTTXXXTX": "X", "TXXXTXTT": "X", "XXXTXTTX": "X", "XXTXTTXX": "T", "XTXTTXXT": "T", "TXTTXXTT": "T", "XTTXXTTT": "X", "TTXXTTTX": "T", "TXXTTTXT": "X", "XXTTTXTX": "T", "XTTTXTXX": "X", "TTTXTXXX": "X", "XTXTTXXX": "X", "TXTTXXXT": "X", "TTXXXTXX": "X", "TXXXTXXT": "T", "XXXTXXTX": "X", "XXTXXTXT": "X", "XTXXTXTX": "T", "TXXTXTXT": "X", "XTXTXTTX": "X", "XTXTTXTT": "T", "TXTTXTTT": "T", "XTTXTTTX": "X", "TTXTTTXT": "X", "TXTTTXTT": "X", "XTTTXTTX": "T", "TTTXTTXT": "X", "TTXTTXTX": "T", "TTXTXXTX": "T", "TXTXXTXT": "X", "XTXXTXTT": "T", "TXXTXTTT": "T", "XXTXTTTT": "X", "TXTTTTTX": "T", "XTTTTTXX": "T", "TTTTXXXX": "T", "TTTXXXXX": "X", "TTXXXXXX": "X", "TXXXXXXT": "T", "XXXXXXTT": "X", "XXXXXTTX": "X", "XTTXXTXT": "X", "TTXXTXTT": "T", "XTXTTTTX": "T", "TXTTTTXT": "X", "XTTTTXTX": "T", "TTTTXTXX": "X", "TTTXTXXT": "T", "TXTXTTTX": "T", "XTXTTTXX": "T", "TXTTTXXT": "T", "XTTTXXTT": "T", "TTTXXTTT": "T", "TTXXTTTT": "X", "TXXTTTTX": "T", "XXTTTTXT": "X", "TXTXTTXX": "X", "TXTTXXXX": "T", "XTTXXXXT": "X", "TTXXXXTX": "X", "TXXXXTXT": "X", "XXXXTXTX": "T", "TXTTTTXX": "T", "XTTTTXXT": "T", "TTTTXXTX": "T", "XXXTXXTT": "T", "XXTXXTTT": "X", "XXTTTXTT": "X", "TTTXTTXX": "T", "TTXTTXXX": "X", "XTTXXXXX": "T", "TTXXXXXT": "T", "TXXXXXTT": "T", "XXXXXTTT": "X", "XXXXTTTT": "T", "XXXTTTTX": "T", "XTTXTXTX": "T", "TTXTXTXT": "X", "TXTXTXTX": "X", "XTXTXTXT": "X", "XTXTXTXX": "X", "TXTXTXXT": "X", "XTXTXXTX": "T", "XXTXTXTX": "X", "TXTXTXTT": "X", "TXTTTXXX": "T", "XTTTXXXX": "X", "TTTXXXXT": "X", "TTXXXXTT": "X", "XXXTXTXX": "T", "XXTXTXXX": "X", "XTXTXXXT": "X", "XXTTXXTT": "T", "TXXTTTTT": "X", "TTTTTXTT": "X", "TTTTXTTT": "T", "TTTXTTTT": "X", "TTXTTTTX": "X", "XTXXTTTT": "T", "XTTTTXTT": "T", "XTTTTXXX": "X", "TXXXXTTT": "X", "XXXXTTTX": "T", "XXXTTTXX": "X", "TXTXTXXX": "X", "XXTTTTXX": "X", "TTTXXXTT": "T", "TTXXXTTX": "T", "TXXXTTXT": "X", "XXXTTXTT": "T", "XXTTXTTX": "X", "XTTXTTXX": "X", "TTXTTXXT": "T", "TTTXXTXT": "X", "TTXXTXTX": "X", "TXTXXXTX": "X", "TTTTXXTT": "T", "XTTTTTTT": "T", "TTTTTTTT": "X", "TTTTTTTX": "T", "TTTTTXXT": "T", "TTTXXTTX": "T", "TTXXTTXX": "T", "TXXTTXXT": "X", "TTXXTXXT": "T", "TXXTXXTX": "T", "XXTXXTXX": "X", "XTXXTXXX": "X", "XTXXXXTX": "T", "XXXXTXTT": "T", "XXXTXTTT": "X", "TXXTXXTT": "T", "XXXXXTXT": "T", "XTTXXXTT": "T", "XXTTXXXX": "X", "TXTTXTTX": "T", "XTTXTTXT": "X", "TTXTTXTT": "T", "XTTXTTTT": "X", "TTXTTTTT": "X", "TTTTXTTX": "X", "TTXTXXXX": "T", "TXTXXXXT": "T", "XXTTTTTX": "X", "XTTTTTXT": "T", "TTTXTXTX": "X", "TXTXXTXX": "X", "XTXXTXXT": "T", "XTXTXXXX": "T", "TXXXXTXX": "T", "TTXTXTXX": "X", "XTXTXXTT": "T", "TXXXTTTX": "X", "XXXTTTXT": "X", "XXTTTXXX": "T", "XTTTXXXT": "X", "TTXXXTTT": "X", "TXXTXTTX": "T", "TXTTXXTX": "X", "XXTXTTTX": "X", "XTXXXXXX": "T", "TXXXXXXX": "X", "XXXXXXXT": "X", "XXXXTTXT": "T", "XXXTTXTX": "X", "TXTXXXXX": "X", "XXXXTXXT": "X", "TXXTXTXX": "T", "XXTXTXXT": "T", "TXTXXTTX": "X", "XTXXTTXX": "X", "TXXTTXXX": "X", "XXTTXTTT": "T", "TTXTTTXX": "T", "XXXXXXTX": "X", "TTTXTTTX": "X", "XTTTXTTT": "T", "TXTTTXTX": "X", "XTXXXTXT": "X", "XTTXXTTX": "T", "TTXXTTXT": "X", "XXTTXTXT": "X", "XXTXXTTX": "X", "TXTT": "X", "TXTTT": "X", "TXTTTX": "X", "TXTTTXX": "X", "XXTXTTXT": "X", "TTXTXTTT": "X", "XTXTTTXT": "T", "XTTTXTXT": "X", "XTXXTTXT": "X", "TXXTTXTT": "X", "XXTT": "T", "XXTTT": "T", "XXTTTT": "X", "XXTTTTX": "X", "XTXX": "T", "XTXXT": "T", "XTXXTT": "T", "XTXXTTT": "T", "XXXXXXXX": "T", "TXXT": "T", "TXXTT": "T", "TXXTTT": "X", "TXXTTTX": "T", "XTTT": "X", "XTTTX": "X", "XTTTXX": "T", "XTTTXXX": "T", "TTXT": "X", "TTXTX": "X", "TTXTXX": "X", "TTXTXXX": "X", "XTTTXXT": "T", "TXTTX": "T", "TXTTXT": "T", "TXTTXTT": "T", "TXXX": "T", "TXXXT": "T", "TXXXTT": "T", "TXXXTTT": "X", "XXTX": "T", "XXTXT": "X", "XXTXTX": "X", "XXTXTXX": "X"};
} catch { Engine.PATTERN8 = Engine.PATTERN8 || {}; }


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
    return { pred: dom, conf: this._clamp(52 + Math.round((ratio - .6) * 80), 52, 78), reason: `Gần: ${dom}${Math.max(b, p)}/${r5.length}`, type: 'trend', name: 'Xu hướng' };
  }
  a_revert(arr) {
    const r8 = this._lastN(arr, 8).filter(c => c !== 'T'); if (r8.length < 5) return null;
    const b = r8.filter(c => c === 'B').length, p = r8.length - b;
    const ratio = Math.max(b, p) / r8.length; if (ratio < 0.75) return null;
    const dom = b > p ? 'B' : 'P', opp = b > p ? 'P' : 'B';
    return { pred: opp, conf: this._clamp(54 + Math.round((ratio - .75) * 100), 54, 84), reason: `Quá lệch ${dom}${Math.round(ratio * 100)}%→đảo`, type: 'counter', name: 'Đảo chiều' };
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
    return { pred, conf, reason: `${last}→${pred}: ${mx}/${tot}`, type: 'pattern', name: 'Markov-1' };
  }
  a_markov2(arr) {
    if (arr.length < 8) return null;
    const n = arr.length, last2 = arr[n - 2] + arr[n - 1]; const cnt = {};
    for (let i = 0; i < n - 2; i++) { const k = arr[i] + arr[i + 1]; if (!cnt[k]) cnt[k] = { B: 0, P: 0, T: 0 }; if (cnt[k][arr[i + 2]] !== undefined) cnt[k][arr[i + 2]]++; }
    const row = cnt[last2]; if (!row) return null;
    const tot = row.B + row.P + row.T; if (tot < 3) return null;
    const pred = row.B >= row.P ? 'B' : 'P'; const mx = Math.max(row.B, row.P);
    const conf = this._wilson(mx, tot, 1.5); if (conf < 55) return null;
    return { pred, conf, reason: `${last2}→${pred}: ${mx}/${tot}`, type: 'pattern', name: 'Markov-2' };
  }
  a_markov3(arr) {
    if (arr.length < 12) return null;
    const n = arr.length, last3 = arr[n - 3] + arr[n - 2] + arr[n - 1]; const cnt = {};
    for (let i = 0; i < n - 3; i++) { const k = arr[i] + arr[i + 1] + arr[i + 2]; if (!cnt[k]) cnt[k] = { B: 0, P: 0, T: 0 }; if (cnt[k][arr[i + 3]] !== undefined) cnt[k][arr[i + 3]]++; }
    const row = cnt[last3]; if (!row) return null;
    const tot = row.B + row.P + row.T; if (tot < 2) return null;
    const pred = row.B >= row.P ? 'B' : 'P'; const mx = Math.max(row.B, row.P);
    const conf = this._wilson(mx, tot, 1.3) + 2; if (conf < 56) return null;
    return { pred, conf, reason: `${last3}→${pred}: ${mx}/${tot}`, type: 'pattern', name: 'Markov-3' };
  }
  a_stkFollow(arr) {
    const { val, len } = this._streak(arr); if (val === 'T' || len < 2 || len > 5) return null;
    return { pred: val, conf: this._clamp(58 + len * 4, 58, 82), reason: `Bệt ${val}×${len}→theo`, type: 'trend', name: 'Streak+' };
  }
  a_stkBreak(arr) {
    const { val, len } = this._streak(arr); if (val === 'T' || len < 4) return null;
    return { pred: val === 'B' ? 'P' : 'B', conf: this._clamp(56 + len * 3, 56, 86), reason: `Bệt ${val}×${len}→bẻ`, type: 'counter', name: 'Streak-' };
  }
  a_dragon(arr) {
    const { val, len } = this._streak(arr); if (val === 'T' || len < 7) return null;
    return { pred: val === 'B' ? 'P' : 'B', conf: this._clamp(72 + len * 2, 72, 92), reason: `Dragon ${val}×${len}→đảo`, type: 'counter', name: 'Dragon' };
  }
  a_pingpong(arr) {
    const tail = this._lastN(arr.filter(c => c !== 'T'), 6); if (tail.length < 5) return null;
    let alt = 0; for (let i = 0; i < tail.length - 1; i++) if (tail[i] !== tail[i + 1]) alt++;
    if (alt < tail.length - 1) return null;
    const last = tail[tail.length - 1];
    return { pred: last === 'B' ? 'P' : 'B', conf: this._clamp(58 + alt * 3, 58, 80), reason: `Ping-Pong ×${alt + 1}`, type: 'pattern', name: 'Ping-Pong' };
  }
  a_pattern46(arr) {
    const noT = arr.filter(c => c !== 'T'); if (noT.length < 5) return null;
    const n = noT, L = n.length;
    if (L >= 5 && n[L - 1] === n[L - 2] && n[L - 3] === n[L - 4] && n[L - 1] !== n[L - 3])
      return { pred: n[L - 1], conf: 64, reason: 'AABB→tiếp đôi', type: 'pattern', name: 'AABB' };
    if (L >= 6) {
      let ok = true; for (let i = L - 5; i < L - 1; i++) if (n[i] === n[i + 1]) { ok = false; break; }
      if (ok) return { pred: n[L - 1] === 'B' ? 'P' : 'B', conf: 68, reason: 'ABABAB→xen', type: 'pattern', name: 'ABAB' };
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
    return { pred, conf: this._clamp(56 + str * 6, 56, 76), reason: `Đà ${pred} +${str}`, type: 'trend', name: 'Momentum' };
  }
  a_hotzone(arr) {
    if (arr.length < 12) return null;
    const z1 = this._lastN(arr, 4).filter(c => c !== 'T'), z2 = arr.slice(arr.length - 8, arr.length - 4).filter(c => c !== 'T');
    if (z1.length < 3 || z2.length < 3) return null;
    const b1 = z1.filter(c => c === 'B').length / z1.length, b2 = z2.filter(c => c === 'B').length / z2.length;
    const p1 = 1 - b1, p2 = 1 - b2;
    if (b1 > b2 + .25 && b1 > .6) return { pred: 'B', conf: this._clamp(56 + Math.round((b1 - .6) * 80), 56, 78), reason: `Hot B↑${Math.round(b1 * 100)}%`, type: 'trend', name: 'Hot Zone' };
    if (p1 > p2 + .25 && p1 > .6) return { pred: 'P', conf: this._clamp(56 + Math.round((p1 - .6) * 80), 56, 78), reason: `Hot P↑${Math.round(p1 * 100)}%`, type: 'trend', name: 'Hot Zone' };
    if (b1 >= .9) return { pred: 'P', conf: this._clamp(60 + Math.round((b1 - .75) * 80), 60, 86), reason: `Cháy B→đảo`, type: 'counter', name: 'Hot Zone' };
    if (p1 >= .9) return { pred: 'B', conf: this._clamp(60 + Math.round((p1 - .75) * 80), 60, 86), reason: `Cháy P→đảo`, type: 'counter', name: 'Hot Zone' };
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
    if (last.n >= avg * 2) return { pred: last.v === 'B' ? 'P' : 'B', conf: this._clamp(58 + Math.round((last.n / avg - 2) * 10), 58, 82), reason: `Run ${last.n}→bẻ`, type: 'counter', name: 'Run-Len' };
    if (last.n <= 1 && avg > 2) return { pred: last.v, conf: 60, reason: `Run ngắn→tiếp`, type: 'trend', name: 'Run-Len' };
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
        reason: 'Baccarat: chờ đủ dữ liệu', gameType: 'baccarat',
        modelsUsed: 0, market: { regime: 'Chờ', trend: '—' }
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
      if ((l.includes('bệt') || l.includes('dính')) && l.includes('cái')) ap = 'B';
      else if ((l.includes('bệt') || l.includes('dính')) && l.includes('con')) ap = 'P';
      else if (l.includes('đảo') || l.includes('xen')) {
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
      reason: `Baccarat · ${topName} (${win.cnt}/${hits.length} vote)`,
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
  const displayName = from => [from?.first_name, from?.last_name].filter(Boolean).join(' ') || from?.username || 'Bạn';
  const plans = () => (options.getConfig().plans || []).filter(p => p.active !== false && Number(p.price) > 0 && Number(p.durationHours) > 0);
  const idShort = () => crypto.randomBytes(5).toString('hex').toUpperCase();
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fmt = n => Number(n || 0).toLocaleString('vi-VN');
  const ensureHttps = u => { let s = String(u || '').trim(); if (!s) return ''; if (!/^https?:\/\//i.test(s)) s = 'https://' + s; return s.replace(/\/+$/, ''); };

  // ─── USER MENU (command only, no buttons) ───────────────
  async function showStart(chatId, name, from) {
    const base = ensureHttps(process.env.PUBLIC_URL || process.env.WEB_URL || '');
    const admin = isAdmin(from && from.id);
    let text = '';
    text += '⚡ <b>TOOL TƯNG TỬNG</b>\n';
    text += '────────────────────\n';
    text += 'Xin chào <b>' + esc(name) + '</b>\n\n';
    if (admin) {
      text += '🛠 <b>Chế độ ADMIN</b>\n';
      text += '• Mở Mini App quản trị\n';
      text += '• Duyệt key nhanh bằng nút\n';
      text += '• Lệnh: /admin /pending /keys /approveall\n\n';
    } else {
      text += '🎮 Mở tool ngay trong Telegram\n';
      text += '🎁 Key free: /getkeyv1\n';
      text += '💎 Mua key: /muakeytx\n';
      text += '🔄 Reset máy: /resetkeytx\n\n';
    }
    text += '────────────────────\n';
    text += '💬 Hỗ trợ @SunNetWin · /menu';
    const rows = [];
    if (base) {
      const adminBase = String(process.env.PUBLIC_ADMIN_URL || '').replace(/\/+$/, '') || (base + '/admin.html');
      const url = admin ? adminBase : (base.endsWith('.html') ? base : base + '/');
      rows.push([{ text: admin ? '🛠 Mở Admin (Mini App)' : 'ToolTungTung', web_app: { url: url } }]);
    }
    if (admin) {
      rows.push([
        { text: '📩 Pending', callback_data: 'adm:pending' },
        { text: '✅ Duyệt all', callback_data: 'adm:approveall' }
      ]);
      rows.push([
        { text: '🔑 Keys', callback_data: 'adm:keys' },
        { text: '📖 Lệnh admin', callback_data: 'adm:help' }
      ]);
    }
    // User thường: chỉ 1 nút duy nhất mở Mini App
    if (!admin) {
      // chỉ giữ nút web_app ở trên, không thêm nút nào khác
    }
    if (admin) {
      rows.push([{ text: '📋 Menu lệnh', callback_data: 'cmd:menu' }]);
    }
    const extra = { reply_markup: { inline_keyboard: rows } };
    if (!base) {
      text += '\n\n⚠️ Chưa set <code>PUBLIC_URL</code> — Mini App chưa gắn domain HTTPS.';
    }
    await send(chatId, text, extra);
  }

  async function showUserMenu(chatId) {
    await send(chatId,
      '📋 <b>MENU NHANH</b>\n' +
      '────────────────────\n' +
      '🚀 Mini App — mở tool\n' +
      '🎁 /getkeyv1 — key free\n' +
      '💎 /muakeytx — mua key\n' +
      '🔄 /resetkeytx — reset key\n' +
      '⏳ /status — yêu cầu đang chờ\n' +
      '🔎 /infotik @user · /infofb link\n' +
      '────────────────────\n' +
      '💬 @SunNetWin',
      { reply_markup: { inline_keyboard: [
        [{ text: '💳 Mua key', callback_data: 'buy_menu' }, { text: '🎁 Key free', callback_data: 'cmd:getkey' }],
        [{ text: '🏠 Về trang chủ bot', callback_data: 'cmd:start' }]
      ] } }
    );
  }

  async function showAdminHelp(chatId) {
    await send(chatId,
`🛠 <b>ADMIN</b>
────────────────
🔑 <b>Key</b>
/keys — danh sách
/key &lt;id|mã&gt; — chi tiết
/createkey [giờ] [TB] [nhãn]
/resetdevice &lt;id|mã&gt;
/revoke &lt;id|mã&gt;

📩 <b>Yêu cầu</b>
/pending
/approve &lt;id&gt;
/reject &lt;id&gt;
/approveall — duyệt tất cả pending

⚙️ <b>Cấu hình</b>
/settask &lt;hướng dẫn nhiệm vụ&gt;
/setpromo &lt;câu copy quảng cáo&gt;
/settaskphotos &lt;số ảnh&gt;
/settasktime &lt;giây&gt;
/setmaint on|off [nội dung]
/lockgame &lt;id&gt; · /unlockgame &lt;id&gt;
/lockcmd &lt;lệnh&gt; · /unlockcmd &lt;lệnh&gt;
/setbank &lt;NH&gt; &lt;STK&gt; &lt;chủ&gt;
/addplan &lt;id&gt; &lt;nhãn&gt; &lt;giá&gt; &lt;giờ&gt;
/delplan &lt;id&gt;
/plans
/settg &lt;user&gt;
/stats

VD: <code>/createkey 24 3 VIP 1N</code>`);
  }

  async function notifyAdmins(request, proofFileId) {
    if (!adminIds.size) return;
    const planText = request.type === 'payment'
      ? `💎 ${esc(request.planLabel)} · ${fmt(request.price)}đ · ${request.durationHours}h`
      : request.type === 'reset' ? '🔄 Reset thiết bị' : '🎁 Key free (nhiệm vụ)';
    const text =
`📩 <b>YÊU CẦU MỚI</b> #${request.id}
────────────────────
👤 ${esc(request.userName)} (@${esc(request.username || '—')})
🆔 <code>${request.telegramId}</code>
📦 ${planText}
${request.groupLink ? '🔗 ' + esc(request.groupLink) + '\n' : ''}
Bấm nút hoặc gõ lệnh:`;
    const keyboard = {
      inline_keyboard: [[
        { text: '✅ Duyệt', callback_data: 'ap:' + request.id },
        { text: '❌ Từ chối', callback_data: 'rj:' + request.id }
      ]]
    };
    for (const aid of adminIds) {
      try {
        if (proofFileId) {
          await sendPhoto(aid, proofFileId, { caption: text, reply_markup: keyboard });
        } else {
          await send(aid, text, { reply_markup: keyboard });
        }
      } catch (e) {
        console.warn('[telegram] notify admin fail', aid, e.message);
      }
    }
  }

  async function deliverReviewedKey(result, chatIdForReview) {
    if (!result || !result.ok || !result.request) return;
    const req = result.request;
    if (req.type === 'reset') {
      try {
        await send(req.telegramId,
`✅ <b>RESET THÀNH CÔNG</b>
────────────────
🔑 Key đã được xóa hết thiết bị cũ.
📱 Giờ đăng nhập lại tối đa <b>3 máy</b>.`);
        if (options.markDelivered) options.markDelivered(req.id);
      } catch (e) {
        if (chatIdForReview) await send(chatIdForReview, `Đã reset nhưng chưa gửi được tin cho user: ${e.message}`).catch(() => null);
      }
      return;
    }
    if (!result.key) return;
    const expiresText = req.durationHours > 0
      ? new Date(Date.now() + req.durationHours * 3600000).toLocaleString('vi-VN')
      : 'Không hết hạn';
    const text = '<b>✅ KEY SẴN SÀNG</b>\n'
      + '────────────────────\n'
      + '🔑 <code>' + result.key + '</code>\n\n'
      + '📦 ' + esc(req.planLabel || 'Key free') + '\n'
      + '⏱ ' + (req.durationHours > 0 ? req.durationHours + 'h' : 'Vĩnh viễn') + '\n'
      + '📅 ' + expiresText + '\n'
      + '📱 3 thiết bị\n\n'
      + '────────────────────\n'
      + '🌐 Dán key vào web\n'
      + '🔄 /resetkeytx khi full máy\n'
      + '💬 @SunNetWin';
    try {
      await send(req.telegramId, text);
      if (options.markDelivered) options.markDelivered(req.id);
    } catch (e) {
      console.warn('[telegram] deliver key fail', req.telegramId, e.message);
      if (chatIdForReview) await send(chatIdForReview, `Duyệt OK nhưng chưa gửi key: ${e.message}`).catch(() => null);
    }
  }

  async function createProofRequest(message, mode) {
    const from = message.from || {};
    const userId = String(from.id);
    const sessions = options.getSessions();
    const session = sessions[userId];
    if (!session || session.type !== mode) {
      await send(message.chat.id, '⚠️ Gõ /getkeyv1 hoặc /muakeytx trước khi gửi ảnh.');
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
      await send(message.chat.id, `⏰ Hết ${timeoutSec} giây. Gõ /getkeyv1 để làm lại.`);
      return;
    }

    if (mode === 'group') {
      session.proofs = session.proofs || [];
      session.proofs.push({ fileId, caption, at: Date.now() });
      options.saveSessions(sessions);
      const have = session.proofs.length;
      if (have < need) {
        await send(message.chat.id,
`📷 Ảnh <b>${have}/${need}</b>
⏳ Còn <b>${need - have}</b> ảnh
⌛️ ~${Math.max(0, Math.ceil((timeoutSec * 1000 - (Date.now() - session.startedAt)) / 1000))}s`);
        return;
      }
      // đủ ảnh
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
`✅ Đã nộp đủ <b>${need} ảnh</b>
🎫 Mã: <b>#${request.id}</b>
⏳ Chờ admin duyệt → nhận key
📱 3 thiết bị · @SunNetWin`);
      // notify admins with all photos
      await notifyAdmins(request, request.proofFileId);
      for (let i = 1; i < (request.proofFileIds || []).length; i++) {
        try { await notifyAdmins(request, request.proofFileIds[i]); } catch {}
      }
      return;
    }

    // payment mode — 1 ảnh
    let plan = plans().find(p => p.id === session.planId);
    if (!plan) {
      delete sessions[userId]; options.saveSessions(sessions);
      await send(message.chat.id, '⚠️ Gói hết hạn. Gõ /muakeytx chọn lại.');
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
    await send(message.chat.id, `✅ Bill đã gửi · <b>#${request.id}</b>\n⏳ Admin duyệt → nhận key`);
    await notifyAdmins(request, request.proofFileId);
  }

  function startGroupKeyTask(chatId, fromId, from) {
    const cfg = options.getConfig();
    const sessions = options.getSessions();
    const timeoutSec = Number(cfg.groupTaskTimeoutSec) || 300;
    const need = Number(cfg.groupTaskPhotos) || 3;
    const task = String(cfg.groupTaskText || 'Làm nhiệm vụ theo yêu cầu admin.');
    const promo = String(cfg.groupPromoText || '');
    sessions[fromId] = { type: 'group', startedAt: Date.now(), proofs: [] };
    options.saveSessions(sessions);
    return send(chatId,
`📸 <b>Nhiệm vụ quảng cáo bot:</b>

${esc(task)}

${promo ? `📌 <b>Câu cần sao chép:</b>\n<code>${esc(promo)}</code>\n` : ''}
📷 Gửi đủ <b>${need} ảnh</b> chứng minh vào đây
⌛️ Bạn có <b>${timeoutSec} giây</b> để gửi ảnh.
📱 Key free = <b>3 thiết bị</b>`);
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

  // ─── TikTok / Facebook lookup ───────────────────────────
  async function lookupTikTok(input) {
    let username = String(input || '').trim();
    const urlMatch = username.match(/tiktok\.com\/@([A-Za-z0-9._]+)/i);
    if (urlMatch) username = urlMatch[1];
    username = username.replace(/^@/, '').split(/[/?#\s]/)[0];
    if (!username || username.length < 2) throw new Error('Username/link không hợp lệ.');
    const profileUrl = `https://www.tiktok.com/@${username}`;
    const headers = {
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'accept-language': 'vi-VN,vi;q=0.9,en;q=0.8'
    };
    let info = {
      username, nickname: username, avatar: '', bio: '', verified: false, private: false,
      followers: null, following: null, likes: null, videos: null, createTime: null, profileUrl
    };
    // 1) oEmbed — nickname + thumb
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
    // 2) HTML page — SIGI_STATE / universal data for stats
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
    if (!info.nickname && !info.avatar) throw new Error('Không lấy được info (user ẩn / không tồn tại).');
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
        const nums = String(info.bio).match(/([\d.,]+)\s*(followers|người theo dõi|likes|lượt thích)/i);
        if (nums) {
          const n = parseFloat(nums[1].replace(/\./g, '').replace(',', '.'));
          if (/follow|theo dõi/i.test(nums[2])) info.followers = n;
          else info.likes = n;
        }
      }
    } catch {}
    if (!info.author) {
      info.author = raw.replace(/^https?:\/\/(www\.)?facebook\.com\//i, '').split(/[/?#]/)[0] || 'Facebook';
      info.bio = info.bio || 'Không lấy đủ chi tiết (profile private / cần đăng nhập).';
    }
    return info;
  }

  // ─── Admin commands ─────────────────────────────────────
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
      return send(chatId, `📊 <b>STATS</b>\n🔑 Key: ${keys.length} · ✅ Active: ${active}\n⏳ Pending: ${pending}`);
    }

    if (cmd === 'keys') {
      const keys = (options.getKeys ? options.getKeys() : []).slice().sort((a, b) => (b.created || 0) - (a.created || 0)).slice(0, 12);
      if (!keys.length) return send(chatId, '📭 Chưa có key.');
      const lines = keys.map(k => {
        const d = (k.deviceHashes || []).length;
        const lim = k.deviceLimit || 3;
        const st = k.status === 'revoked' ? '🚫' : (options.isExpired?.(k) ? '⏰' : '✅');
        return `${st} <code>${k.id}</code> · ${esc(k.label)} · 📱${d}/${lim}`;
      });
      return send(chatId, `🔑 <b>KEYS</b>\n` + lines.join('\n'));
    }

    if (cmd === 'key') {
      if (!args[0]) return send(chatId, '📌 <code>/key &lt;id|mã&gt;</code>');
      const k = resolveKey(args[0]);
      if (!k) return send(chatId, '❌ Không tìm thấy.');
      const d = (k.deviceHashes || []).length;
      return send(chatId,
`🔑 <b>${esc(k.label)}</b>
🆔 <code>${k.id}</code>
📊 ${k.status} · 📱 ${d}/${k.deviceLimit || 3}
⏱ ${k.expiresAt ? new Date(k.expiresAt).toLocaleString('vi-VN') : '∞'}
📡 ${k.source || '—'} · TG ${k.telegramId || '—'}`);
    }

    if (cmd === 'createkey') {
      const hours = Math.max(0, parseInt(args[0], 10) || 24);
      const devices = Math.max(1, Math.min(10, parseInt(args[1], 10) || 3));
      const label = args.slice(2).join(' ') || `Key ${hours}h`;
      try {
        const issued = options.createKey({ label, durationHours: hours, deviceLimit: devices, source: 'telegram-admin' });
        return send(chatId,
`✅ <b>TẠO KEY</b>
🔑 <code>${issued.plainKey}</code>
🆔 <code>${issued.record.id}</code>
⏱ ${hours || '∞'}h · 📱 ${devices} TB`);
      } catch (e) {
        return send(chatId, `❌ ${e.message}`);
      }
    }

    if (cmd === 'resetdevice' || cmd === 'resetdevices') {
      if (!args[0]) return send(chatId, '📌 <code>/resetdevice &lt;id|mã&gt;</code>');
      const k = resolveKey(args[0]);
      if (!k) return send(chatId, '❌ Không tìm thấy.');
      k.deviceHashes = [];
      if (options.saveKeys) options.saveKeys();
      return send(chatId, `🔄 Đã reset 📱 key <code>${k.id}</code>\nGiới hạn: ${k.deviceLimit || 3} TB`);
    }

    if (cmd === 'revoke') {
      if (!args[0]) return send(chatId, '📌 <code>/revoke &lt;id|mã&gt;</code>');
      const k = resolveKey(args[0]);
      if (!k) return send(chatId, '❌ Không tìm thấy.');
      k.status = 'revoked';
      if (options.saveKeys) options.saveKeys();
      return send(chatId, `🚫 Đã thu hồi <code>${k.id}</code>`);
    }

    if (cmd === 'pending') {
      const list = (options.getRequests ? options.getRequests() : []).filter(r => r.status === 'pending').slice(0, 15);
      if (!list.length) return send(chatId, '✅ Không có pending.');
      const lines = list.map(r => {
        const icon = r.type === 'payment' ? '💳' : r.type === 'reset' ? '🔄' : '🎯';
        return `${icon} <code>${r.id}</code> · ${esc(r.userName)} · ${new Date(r.createdAt).toLocaleString('vi-VN')}`;
      });
      return send(chatId, `⏳ <b>PENDING</b>\n` + lines.join('\n') + `\n\n✅ /approve ID · ❌ /reject ID\n⚡ /approveall — duyệt hết`);
    }

    if (cmd === 'approve' || cmd === 'reject') {
      if (!args[0]) return send(chatId, `📌 <code>/${cmd} &lt;id&gt;</code>`);
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
            return send(chatId, '❌ Không tìm thấy key để reset.');
          }
        } else {
          k.deviceHashes = [];
          if (options.saveKeys) options.saveKeys();
        }
      }
      const result = options.reviewRequest(args[0], approved, `telegram-cmd:${message.from.id}`);
      if (!result.ok) return send(chatId, `❌ ${result.error || 'Lỗi'}`);
      if (approved) await deliverReviewedKey(result, chatId);
      else await send(result.request.telegramId, `❌ Yêu cầu #${result.request.id} bị từ chối.`).catch(() => null);
      return send(chatId, approved ? `✅ #${args[0]}` : `🚫 #${args[0]}`);
    }

    if (cmd === 'approveall') {
      const list = (options.getRequests ? options.getRequests() : []).filter(r => r.status === 'pending');
      if (!list.length) return send(chatId, '✅ Không có pending.');
      let ok = 0, fail = 0;
      for (const r of list) {
        const result = options.reviewRequest(r.id, true, 'telegram-approveall:' + fromId);
        if (result.ok) {
          ok++;
          try { await deliverReviewedKey(result, chatId); } catch {}
        } else fail++;
      }
      return send(chatId, `✅ Duyệt all: ${ok} OK · ${fail} lỗi`);
    }

    if (cmd === 'settask') {
      if (!argText) return send(chatId, '📌 <code>/settask &lt;nội dung hướng dẫn&gt;</code>');
      const cfg = options.getConfig();
      cfg.groupTaskText = argText.slice(0, 2000);
      if (options.saveConfig) options.saveConfig(cfg);
      return send(chatId, `✅ Nhiệm vụ nhóm:\n${esc(cfg.groupTaskText)}`);
    }
    if (cmd === 'setpromo') {
      if (!argText) return send(chatId, '📌 <code>/setpromo câu quảng cáo cần copy</code>');
      const cfg = options.getConfig();
      cfg.groupPromoText = argText.slice(0, 500);
      if (options.saveConfig) options.saveConfig(cfg);
      return send(chatId, `✅ Câu promo:\n<code>${esc(cfg.groupPromoText)}</code>`);
    }
    if (cmd === 'settaskphotos') {
      const n = parseInt(args[0], 10);
      if (!(n >= 1 && n <= 10)) return send(chatId, '📌 <code>/settaskphotos 3</code> (1-10)');
      const cfg = options.getConfig();
      cfg.groupTaskPhotos = n;
      if (options.saveConfig) options.saveConfig(cfg);
      return send(chatId, `✅ Cần ${n} ảnh để nhận key free`);
    }
    if (cmd === 'settasktime') {
      const n = parseInt(args[0], 10);
      if (!(n >= 60 && n <= 3600)) return send(chatId, '📌 <code>/settasktime 300</code> (60-3600s)');
      const cfg = options.getConfig();
      cfg.groupTaskTimeoutSec = n;
      if (options.saveConfig) options.saveConfig(cfg);
      return send(chatId, `✅ Thời gian nhiệm vụ: ${n}s`);
    }
    if (cmd === 'setmaint') {
      const cfg = options.getConfig();
      const on = ['1','on','true','yes','bat'].includes(String(args[0]||'').toLowerCase());
      const off = ['0','off','false','no','tat'].includes(String(args[0]||'').toLowerCase());
      if (!on && !off) return send(chatId, '📌 <code>/setmaint on|off [nội dung]</code>\n<code>/lockgame id</code> <code>/unlockgame id</code>\n<code>/lockcmd getkey</code> <code>/unlockcmd getkey</code>');
      cfg.maintenance = cfg.maintenance || { enabled:false, message:'', lockedGames:[], lockedCommands:[] };
      cfg.maintenance.enabled = on;
      if (argText.replace(/^\S+\s*/, '').trim()) cfg.maintenance.message = argText.replace(/^\S+\s*/, '').trim().slice(0,500);
      if (options.saveConfig) options.saveConfig(cfg);
      return send(chatId, (on?'🛠 Bật bảo trì':'✅ Tắt bảo trì') + (cfg.maintenance.message ? '\n'+cfg.maintenance.message : ''));
    }
    if (cmd === 'lockgame' || cmd === 'unlockgame') {
      const id = String(args[0]||'').toLowerCase();
      if (!id) return send(chatId, '📌 <code>/lockgame sunwin</code>');
      const cfg = options.getConfig();
      cfg.maintenance = cfg.maintenance || { enabled:false, message:'', lockedGames:[], lockedCommands:[] };
      const list = new Set(cfg.maintenance.lockedGames || []);
      if (cmd === 'lockgame') list.add(id); else list.delete(id);
      cfg.maintenance.lockedGames = [...list];
      if (options.saveConfig) options.saveConfig(cfg);
      return send(chatId, `🎮 lockedGames: <code>${cfg.maintenance.lockedGames.join(', ')||'—'}</code>`);
    }
    if (cmd === 'lockcmd' || cmd === 'unlockcmd') {
      const id = String(args[0]||'').toLowerCase().replace(/^\//,'');
      if (!id) return send(chatId, '📌 <code>/lockcmd getkey</code>');
      const cfg = options.getConfig();
      cfg.maintenance = cfg.maintenance || { enabled:false, message:'', lockedGames:[], lockedCommands:[] };
      const list = new Set(cfg.maintenance.lockedCommands || []);
      if (cmd === 'lockcmd') list.add(id); else list.delete(id);
      cfg.maintenance.lockedCommands = [...list];
      if (options.saveConfig) options.saveConfig(cfg);
      return send(chatId, `⌨️ lockedCommands: <code>${cfg.maintenance.lockedCommands.join(', ')||'—'}</code>`);
    }

    if (cmd === 'setbank') {
      if (args.length < 3) return send(chatId, '📌 <code>/setbank &lt;NH&gt; &lt;STK&gt; &lt;chủ&gt;</code>');
      const cfg = options.getConfig();
      cfg.bankCode = args[0];
      cfg.bankAccount = args[1];
      cfg.bankAccountName = args.slice(2).join(' ');
      if (options.saveConfig) options.saveConfig(cfg);
      return send(chatId, `✅ 🏦 ${esc(cfg.bankCode)} · <code>${esc(cfg.bankAccount)}</code>\n👤 ${esc(cfg.bankAccountName)}`);
    }

    if (cmd === 'settg') {
      const u = (args[0] || '').replace(/^@/, '');
      const cfg = options.getConfig();
      cfg.telegramUsername = u;
      if (options.saveConfig) options.saveConfig(cfg);
      return send(chatId, `✅ Bot: @${esc(u) || '—'}`);
    }

    if (cmd === 'addplan') {
      if (args.length < 4) return send(chatId, '📌 <code>/addplan id nhãn giá giờ</code>');
      const id = args[0].toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
      const price = parseInt(args[args.length - 2], 10);
      const hours = parseInt(args[args.length - 1], 10);
      const label = args.slice(1, -2).join(' ').replace(/^["']|["']$/g, '');
      if (!id || !label || !price || !hours) return send(chatId, '❌ Thiếu thông tin.');
      const cfg = options.getConfig();
      cfg.plans = cfg.plans || [];
      if (cfg.plans.some(p => p.id === id)) return send(chatId, '❌ ID trùng.');
      cfg.plans.push({ id, label, price, durationHours: hours, active: true });
      if (options.saveConfig) options.saveConfig(cfg);
      return send(chatId, `✅ 💎 ${esc(label)} · ${fmt(price)}đ · ${hours}h`);
    }

    if (cmd === 'delplan') {
      if (!args[0]) return send(chatId, '📌 <code>/delplan &lt;id&gt;</code>');
      const cfg = options.getConfig();
      const before = (cfg.plans || []).length;
      cfg.plans = (cfg.plans || []).filter(p => p.id !== args[0].toLowerCase());
      if (options.saveConfig) options.saveConfig(cfg);
      return send(chatId, cfg.plans.length < before ? `✅ Xóa ${args[0]}` : '❌ Không thấy.');
    }

    if (cmd === 'plans') {
      const list = plans();
      if (!list.length) return send(chatId, '📭 Chưa có gói.');
      return send(chatId, `💎 <b>GÓI</b>\n` + list.map(p => `• <code>${p.id}</code> ${esc(p.label)} · ${fmt(p.price)}đ · ${p.durationHours}h`).join('\n'));
    }

    return send(chatId, '❓ Gõ /admin');
  }

  // ─── Message router ─────────────────────────────────────

  async function showBuyMenu(chatId) {
    const available = plans();
    if (!available.length) return send(chatId, '📭 Tạm hết gói.\n/getkeyv1 nhận free · @SunNetWin');
    const lines = available.map((p, i) => {
      const days = p.durationHours >= 24 ? (Math.round(p.durationHours / 24) + ' ngày') : (p.durationHours + 'h');
      return '<b>' + (i + 1) + '. ' + esc(p.label) + '</b>\n    💰 ' + fmt(p.price) + 'đ  ·  ⏱ ' + days;
    }).join('\n\n');
    const keyboard = {
      inline_keyboard: available.map(p => {
        const days = p.durationHours >= 24 ? (Math.round(p.durationHours / 24) + ' ngày') : (p.durationHours + 'h');
        return [{ text: p.label + ' · ' + fmt(p.price) + 'đ · ' + days, callback_data: 'pay:' + p.id }];
      })
    };
    await send(chatId,
      '💳 <b>MUA KEY VIP</b>\n' + 
      '────────────────────\n' + 
      'Chọn gói 👇\n' + 
      '\n' + lines + '\n\n' +
      '────────────────────\n' + 
      '✅ 3 thiết bị · Reset free\n' + 
      '⚡ TX realtime · @SunNetWin\n',
      { reply_markup: keyboard }
    );
  }

  async function startPayment(chatId, fromId, planId) {
    const plan = plans().find(p => p.id === String(planId || '').toLowerCase());
    if (!plan) return send(chatId, '❌ Gói không tồn tại. Gõ /muakeytx để chọn lại.');
    const config = options.getConfig();
    if (!config.bankCode || !config.bankAccount || !config.bankAccountName) {
      return send(chatId, '⚠️ Admin chưa cấu hình ngân hàng VietQR.\nLiên hệ @SunNetWin');
    }
    const addInfo = `KEYVIP ${fromId}`;
    const qr = `https://img.vietqr.io/image/${encodeURIComponent(config.bankCode)}-${encodeURIComponent(config.bankAccount)}-compact2.jpg?amount=${encodeURIComponent(String(plan.price))}&addInfo=${encodeURIComponent(addInfo)}&accountName=${encodeURIComponent(config.bankAccountName)}`;
    const sessions = options.getSessions();
    sessions[fromId] = { type: 'payment', planId: plan.id, startedAt: Date.now() };
    options.saveSessions(sessions);
    const days = plan.durationHours >= 24 ? `${Math.round(plan.durationHours / 24)} ngày` : `${plan.durationHours}h`;
    await sendPhoto(chatId, qr, {
      caption: '<b>💳 THANH TOÁN</b>\n'
        + '────────────────────\n'
        + '📦 <b>' + esc(plan.label) + '</b>\n'
        + '💰 <b>' + fmt(plan.price) + 'đ</b> · ⏱ ' + days + '\n\n'
        + '🏦 <b>' + esc(config.bankCode) + '</b>\n'
        + '💳 <code>' + esc(config.bankAccount) + '</code>\n'
        + '👤 ' + esc(config.bankAccountName) + '\n\n'
        + '📝 CK: <code>' + addInfo + '</code>\n\n'
        + '────────────────────\n'
        + '📷 Gửi <b>ảnh bill</b> sau khi CK\n'
        + '⏳ Duyệt xong → nhận key\n'
        + '💬 @SunNetWin'
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
    if (data === 'buy_menu') return showBuyMenu(chatId);
    if (data === 'cmd:getkey') return startGroupKeyTask(chatId, fromId, cq.from);
    if (data === 'cmd:resetkey') {
      const sessions = options.getSessions();
      sessions[fromId] = { type: 'await_reset_key', startedAt: Date.now() };
      options.saveSessions(sessions);
      return send(chatId, '🔄 Gửi <b>mã key</b> cần reset:\n<code>KYT-...</code>');
    }
    if (data === 'cmd:status') {
      const pending = (options.getRequests ? options.getRequests() : []).filter(r => String(r.telegramId) === fromId && r.status === 'pending');
      if (!pending.length) return send(chatId, '✅ Không có yêu cầu chờ.');
      return send(chatId, '⏳ <b>' + pending.length + ' yêu cầu</b>\n' + pending.map(r => '• #' + r.id + ' ' + (r.type || '')).join('\n'));
    }
    if (data === 'cmd:start') return showStart(chatId, displayName(cq.from), cq.from);
    if (data === 'cmd:menu') return showUserMenu(chatId);
    if (data === 'adm:pending' && isAdmin(fromId)) return send(chatId, '📩 Gõ /pending để xem list + nút duyệt từng yêu cầu.');
    if (data === 'adm:approveall' && isAdmin(fromId)) {
      const list = (options.getRequests ? options.getRequests() : []).filter(r => r.status === 'pending');
      let n = 0;
      for (const r of list) {
        try {
          const result = options.reviewRequest(r.id, true, 'telegram-btn-approveall:' + fromId);
          if (result && result.ok) { n++; try { await deliverReviewedKey(result, chatId); } catch (e) {} }
        } catch (e) {}
      }
      return send(chatId, '✅ Duyệt nhanh <b>' + n + '</b> yêu cầu.');
    }
    if (data === 'adm:keys' && isAdmin(fromId)) return send(chatId, '🔑 Gõ /keys để xem danh sách.');
    if (data === 'adm:help' && isAdmin(fromId)) return showAdminHelp(chatId);
    // Admin quick approve / reject
    if (data.startsWith('ap:') || data.startsWith('rj:')) {
      if (!isAdmin(fromId)) {
        try { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Không có quyền', show_alert: true }); } catch {}
        return;
      }
      const id = data.slice(3);
      const approved = data.startsWith('ap:');
      const result = options.reviewRequest(id, approved, 'telegram-btn:' + fromId);
      if (!result.ok) return send(chatId, '❌ ' + (result.error || 'Lỗi'));
      if (approved) await deliverReviewedKey(result, chatId);
      else if (result.request) await send(result.request.telegramId, '❌ Yêu cầu #' + result.request.id + ' bị từ chối.').catch(() => null);
      return send(chatId, approved ? ('✅ Đã duyệt #' + id) : ('🚫 Đã từ chối #' + id));
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
      return send(chatId, '⚠️ Gõ /getkeyv1 hoặc /muakeytx trước.');
    }

    if (!text) return;

    // admin commands first
    if (text.startsWith('/') && isAdmin(fromId)) {
      const cmd = text.split(/\s+/)[0].toLowerCase().replace(/^\//, '').split('@')[0];
      const adminCmds = new Set(['admin', 'panel', 'stats', 'keys', 'key', 'createkey', 'resetdevice', 'resetdevices', 'revoke', 'pending', 'approve', 'reject', 'approveall', 'settask', 'setpromo', 'settaskphotos', 'settasktime', 'setmaint', 'lockgame', 'unlockgame', 'lockcmd', 'unlockcmd', 'setbank', 'settg', 'addplan', 'delplan', 'plans']);
      if (adminCmds.has(cmd)) return handleAdminCommand(message, text);
    }

    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase().replace(/^\//, '').split('@')[0];
    const args = parts.slice(1);
    const argText = text.replace(/^\/\S+\s*/, '').trim();

    // Bảo trì / khóa lệnh (admin vẫn dùng được)
    if (!isAdmin(fromId)) {
      const mt = (options.getConfig && options.getConfig().maintenance) || {};
      if (mt.enabled && Array.isArray(mt.lockedCommands) && mt.lockedCommands.includes(cmd)) {
        return send(chatId, '🛠 ' + (mt.message || 'Lệnh đang bảo trì.'));
      }
      if (mt.enabled && Array.isArray(mt.lockedCommands) && mt.lockedCommands.includes('*')) {
        return send(chatId, '🛠 ' + (mt.message || 'Bot đang bảo trì.'));
      }
    }

    if (cmd === 'start') return showStart(chatId, displayName(from), from);
    if (cmd === 'menu' || cmd === 'help') return showUserMenu(chatId);

    if (cmd === 'status') {
      const pending = (options.getRequests ? options.getRequests() : []).filter(r => r.telegramId === fromId && r.status === 'pending');
      if (!pending.length) return send(chatId, '✅ Không có yêu cầu chờ.');
      return send(chatId, `⏳ <b>${pending.length} yêu cầu</b>\n` + pending.map(r => `• #${r.id} ${r.type === 'payment' ? '💳' : r.type === 'reset' ? '🔄' : '🎯'}`).join('\n'));
    }

    if (cmd === 'getkeyv1') {
      return startGroupKeyTask(chatId, fromId, from);
    }

    if (cmd === 'muakeytx') {
      return showBuyMenu(chatId);
    }

    if (cmd === 'pay') {
      const planId = (args[0] || '').toLowerCase();
      return startPayment(chatId, fromId, planId);
    }

    if (cmd === 'help') {
      return showStart(chatId, displayName(from), from);
    }

    if (cmd === 'resetkeytx') {
      if (!argText) {
        sessions[fromId] = { type: 'await_reset_key', startedAt: Date.now() };
        options.saveSessions(sessions);
        return send(chatId,
`🔄 <b>RESET THIẾT BỊ</b>
────────────────
Gửi <b>mã key</b> cần reset.
⚡ Tự động · không cần admin
⏱ Thời hạn key <b>không đổi</b>`);
      }
      const plain = argText.trim();
      const k = options.findKey ? options.findKey(plain) : null;
      if (!k) return send(chatId, '❌ Key không hợp lệ.');
      if (k.status === 'revoked') return send(chatId, '🚫 Key đã bị thu hồi.');
      if (options.isExpired?.(k)) return send(chatId, '⏰ Key đã hết hạn.');
      k.deviceHashes = [];
      if (options.saveKeys) options.saveKeys();
      delete sessions[fromId]; options.saveSessions(sessions);
      const exp = k.expiresAt ? new Date(k.expiresAt).toLocaleString('vi-VN') : 'Không hết hạn';
      return send(chatId,
`✅ <b>RESET XONG</b>
────────────────
🔑 <code>${esc(k.id)}</code>
📱 Đã xóa hết thiết bị cũ
⏱ Hạn key: <b>${exp}</b> (không đổi)
👉 Đăng nhập lại trên web (tối đa ${k.deviceLimit || 3} máy)`);
    }

    // waiting for reset key text — auto reset, no admin
    if (sessions[fromId]?.type === 'await_reset_key' && !text.startsWith('/')) {
      const plain = text.trim();
      const k = options.findKey ? options.findKey(plain) : null;
      if (!k) return send(chatId, '❌ Key không hợp lệ. Gửi lại hoặc /resetkeytx');
      if (k.status === 'revoked') return send(chatId, '🚫 Key đã bị thu hồi.');
      if (options.isExpired?.(k)) return send(chatId, '⏰ Key đã hết hạn.');
      k.deviceHashes = [];
      if (options.saveKeys) options.saveKeys();
      delete sessions[fromId]; options.saveSessions(sessions);
      const exp = k.expiresAt ? new Date(k.expiresAt).toLocaleString('vi-VN') : 'Không hết hạn';
      return send(chatId,
`✅ <b>RESET XONG</b>
────────────────
🔑 <code>${esc(k.id)}</code>
📱 Đã xóa hết thiết bị cũ
⏱ Hạn key: <b>${exp}</b> (không đổi)
👉 Đăng nhập lại trên web (tối đa ${k.deviceLimit || 3} máy)`);
    }

    if (cmd === 'infotik') {
      if (!argText) return send(chatId, '📌 <code>/infotik @user</code>\nhoặc link profile');
      await send(chatId, '⏳ Đang lấy info TikTok...');
      try {
        const info = await lookupTikTok(argText);
        const fmtN = n => n == null ? '—' : Number(n).toLocaleString('vi-VN');
        const created = info.createTime ? new Date(info.createTime).toLocaleString('vi-VN') : '—';
        const text =
`📱 <b>TIKTOK INFO</b>
────────────────
👤 <b>${esc(info.nickname)}</b> ${info.verified ? '✅' : ''}
🆔 @${esc(info.username)}
${info.private ? '🔒 Private' : '🌐 Public'}
📝 ${esc((info.bio || '—').slice(0, 160))}

👥 Followers: <b>${fmtN(info.followers)}</b>
➡️ Following: <b>${fmtN(info.following)}</b>
❤️ Likes: <b>${fmtN(info.likes)}</b>
🎬 Videos: <b>${fmtN(info.videos)}</b>
📅 Tạo: ${created}
🔗 ${info.profileUrl}`;
        if (info.avatar) {
          try {
            await sendPhoto(chatId, info.avatar, { caption: text });
            return;
          } catch {}
        }
        return send(chatId, text);
      } catch (e) {
        return send(chatId, `❌ ${e.message}`);
      }
    }

    if (cmd === 'infofb') {
      if (!argText) return send(chatId, '📌 <code>/fb username</code>\nhoặc link profile');
      await send(chatId, '⏳ Đang lấy info Facebook...');
      try {
        const info = await lookupFacebook(argText);
        const fmtN = n => n == null ? '—' : Number(n).toLocaleString('vi-VN');
        const text =
`📘 <b>FACEBOOK INFO</b>
────────────────
👤 <b>${esc(info.author)}</b>
📝 ${esc((info.bio || '—').slice(0, 180))}
👥 Followers/Likes: <b>${fmtN(info.followers ?? info.likes)}</b>
🔗 ${esc(info.url)}`;
        if (info.avatar) {
          try {
            await sendPhoto(chatId, info.avatar, { caption: text });
            return;
          } catch {}
        }
        return send(chatId, text);
      } catch (e) {
        return send(chatId, `❌ ${e.message}`);
      }
    }

    if (text.startsWith('/')) {
      return send(chatId, '❓ Gõ /start xem lệnh.');
    }
  }

  // reviewRequest for reset type shouldn't create a key - patch behavior via wrapper
  const originalReview = options.reviewRequest;
  options.reviewRequest = function (id, approved, reviewer) {
    const req = (options.getRequests ? options.getRequests() : []).find(r => r.id === id);
    if (req && req.type === 'reset') {
      if (!req || req.status !== 'pending') return { ok: false, error: 'Yêu cầu đã xử lý hoặc không tồn tại.' };
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
`✅ <b>KEY</b>
🔑 <code>${key}</code>
📦 ${esc(meta.label || 'VIP')} · ⏱ ${meta.durationHours || 5}h
📱 3 thiết bị`),
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
app.use(express.static(path.join(__dirname, 'public')));
app.disable('x-powered-by');

// The front-end can be hosted statically on Netlify. This server also serves it for local testing.
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => { const f = path.join(__dirname, 'public', 'admin.html'); if (fs.existsSync(f)) res.sendFile(f); else res.send('Admin page not found. Upload public/admin.html.'); });
app.get('/admin.html', (req, res) => { const f = path.join(__dirname, 'public', 'admin.html'); if (fs.existsSync(f)) res.sendFile(f); else res.send('Admin page not found.'); });

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
  if (plain.length < 5 || plain.length > 120) throw new Error('Key phải có độ dài từ 5 đến 120 ký tự.');
  if (findKey(plain)) throw new Error('Key đã tồn tại.');
  const hours = Math.max(0, Number(durationHours || 0));
  let expiry = null;
  if (expiresAt !== null && expiresAt !== undefined && expiresAt !== '') {
    const parsed = typeof expiresAt === 'number' ? expiresAt : new Date(expiresAt).getTime();
    if (!Number.isFinite(parsed) || parsed <= Date.now()) throw new Error('Ngày hết hạn không hợp lệ hoặc đã ở quá khứ.');
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
  if (!payload || payload.type !== 'user') return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' });
  const k = keys.find(item => item.id === payload.keyId);
  if (!k || k.status === 'revoked' || isExpired(k)) return res.status(401).json({ error: 'Key đã hết hạn hoặc bị thu hồi.' });
  if (payload.deviceHash && !(k.deviceHashes || []).includes(payload.deviceHash)) return res.status(401).json({ error: 'Thiết bị không còn được cấp quyền sử dụng key.' });
  req.user = payload; req.userKey = k; next();
}
function requireAdmin(req, res, next) {
  const payload = verifyToken(bearerToken(req));
  if (!payload || payload.type !== 'admin') return res.status(401).json({ error: 'Yêu cầu quyền admin.' });
  next();
}

// ---------- configurable game feeds ----------
const DEFAULT_GAMES = [
  // Sunwin
  { id: 'sunwin', label: 'Sunwin · TX', brand: 'sunwin', brandLabel: 'Sunwin', variant: 'TX', url: 'https://apisunwin-cocalhahaha.onrender.com/api/sunwin', parser: 'sunwin', group: 'tx', icon: 'sunwin', enabled: true, playUrl: '' },
  { id: 'sicbo_sunwin', label: 'Sunwin · Sicbo', brand: 'sunwin', brandLabel: 'Sunwin', variant: 'Sicbo', url: 'https://apitaixiu-6jjn.onrender.com/api/sicbo/sunwin', parser: 'max789', group: 'sicbo', icon: 'sicbo', historyUrl: 'https://apitaixiu-6jjn.onrender.com/api/sicsun/history', enabled: true, playUrl: '' },
  // LC79
  { id: 'lc79_hu', label: 'LC79 · TX', brand: 'lc79', brandLabel: 'LC79', variant: 'TX', url: 'https://wtx.tele68.com/v1/tx/sessions', parser: 'lc79', group: 'tx', icon: 'lc79', enabled: true, playUrl: '' },
  { id: 'lc79_md5', label: 'LC79 · MD5', brand: 'lc79', brandLabel: 'LC79', variant: 'MD5', url: 'https://wtxmd52.tele68.com/v1/txmd5/sessions', parser: 'lc79', group: 'tx', icon: 'lc79', enabled: true, playUrl: '' },
  // Max789
  { id: 'max789_hu', label: 'Max789 · TX', brand: 'max789', brandLabel: 'Max789', variant: 'TX', url: 'https://apitaixiu-6jjn.onrender.com/max789/tx', parser: 'max789', group: 'tx', icon: 'max789', enabled: true, playUrl: '' },
  { id: 'max789_md5', label: 'Max789 · MD5', brand: 'max789', brandLabel: 'Max789', variant: 'MD5', url: 'https://max789-nqfd.onrender.com/api/taixiumd5/max789', parser: 'max789', group: 'tx', icon: 'max789', enabled: true, playUrl: '' },
  // Hitclub
  { id: 'hitclub_hu', label: 'Hitclub · TX', brand: 'hitclub', brandLabel: 'Hitclub', variant: 'TX', url: 'https://apihitclubhihi.onrender.com/api/hitclub/hu', parser: 'sunwin', group: 'tx', icon: 'hitclub', enabled: true, playUrl: '' },
  { id: 'hitclub_md5', label: 'Hitclub · MD5', brand: 'hitclub', brandLabel: 'Hitclub', variant: 'MD5', url: 'https://apihitclubhihi.onrender.com/api/hitclub/md5', parser: 'sunwin', group: 'tx', icon: 'hitclub', enabled: true, playUrl: '' },
  { id: 'sicbo_hitclub', label: 'Hitclub · Sicbo', brand: 'hitclub', brandLabel: 'Hitclub', variant: 'Sicbo', url: 'https://apitaixiu-6jjn.onrender.com/api/sicbo/hitclub', parser: 'max789', group: 'sicbo', icon: 'sicbo', enabled: true, playUrl: '' },
  // BetVIP
  { id: 'betvip_hu', label: 'BetVIP · TX', brand: 'betvip', brandLabel: 'BetVIP', variant: 'TX', url: 'https://apitaixiu-6jjn.onrender.com/betvip/tx', parser: 'max789', group: 'tx', icon: 'betvip', enabled: true, playUrl: '' },
  { id: 'betvip_md5', label: 'BetVIP · MD5', brand: 'betvip', brandLabel: 'BetVIP', variant: 'MD5', url: 'https://apitaixiu-6jjn.onrender.com/betvip/md5', parser: 'max789', group: 'tx', icon: 'betvip', enabled: true, playUrl: '' },
  // B52
  { id: 'b52_tx', label: 'B52 · TX', brand: 'b52', brandLabel: 'B52', variant: 'TX', url: 'https://apitaixiu-6jjn.onrender.com/b52/history', parser: 'b52hist', group: 'tx', icon: 'b52', enabled: true, playUrl: '' },
  { id: 'sicbo_b52', label: 'B52 · Sicbo', brand: 'b52', brandLabel: 'B52', variant: 'Sicbo', url: 'https://apitaixiu-6jjn.onrender.com/api/sicbo/b52', parser: 'max789', group: 'sicbo', icon: 'sicbo', historyUrl: 'https://apitaixiu-6jjn.onrender.com/api/sicbo/history', enabled: true, playUrl: '' },
  // Baccarat
  { id: 'baccarat', label: 'Baccarat', brand: 'baccarat', brandLabel: 'Baccarat', variant: 'Live', url: 'https://bcrsexy.onrender.com/api/baccarat', parser: 'baccarat', group: 'baccarat', icon: 'baccarat', enabled: true, table: '', playUrl: '' }
];


let gameConfigs = loadJSON(GAMES_FILE, null);
if (!Array.isArray(gameConfigs)) gameConfigs = DEFAULT_GAMES.map(g => ({ ...g }));
// đảm bảo có game baccarat nếu bản cũ chưa có
if (!gameConfigs.some(g => g.parser === 'baccarat' || g.id === 'baccarat')) {
  const bac = DEFAULT_GAMES.find(g => g.id === 'baccarat');
  if (bac) gameConfigs.push({ ...bac });
}
if (!gameConfigs.some(g => g.id === 'max789_md5' || (g.parser === 'max789' && g.id === 'max789_md5'))) {
  const mx = DEFAULT_GAMES.find(g => g.id === 'max789_md5');
  if (mx) gameConfigs.push({ ...mx });
}
for (const def of DEFAULT_GAMES) {
  if (!gameConfigs.some(g => g.id === def.id)) gameConfigs.push({ ...def });
}


const FEEDS = Object.create(null);
function createFeed(config) {
  const parser = config.parser || 'lc79';
  const engine = parser === 'baccarat' ? new BaccaratEngine() : new Engine();
  return { id: config.id, label: config.label, url: config.url, parser, table: config.table || '', playUrl: config.playUrl || '', group: config.group || 'tx', icon: config.icon || '', historyUrl: config.historyUrl || '', enabled: config.enabled !== false,
    engine, history: [], accuracyHistory: [], lastSession: null, pendingPred: null,
    correct: 0, total: 0, lastLive: null, lastEnsemble: null, _seen: [], lastError: null };
}
function saveGameConfigs() { saveJSON(GAMES_FILE, gameConfigs); }
function initializeFeedConfigs() {
  for (const key of Object.keys(FEEDS)) delete FEEDS[key];
  for (const g of gameConfigs) {
    if (!g || !/^[a-z0-9_-]{2,32}$/i.test(String(g.id || '')) || !validHttpUrl(g.url)) continue;
    g.id = String(g.id); g.label = String(g.label || g.id); g.parser = ['sunwin','baccarat','max789','b52hist'].includes(g.parser) ? g.parser : 'lc79'; g.table = g.table || ''; g.playUrl = String(g.playUrl || g.play_url || g.gameLink || '').trim().slice(0, 500); g.group = g.group || (g.parser === 'baccarat' ? 'baccarat' : 'tx'); g.icon = g.icon || ''; g.historyUrl = g.historyUrl || ''; g.brand = g.brand || g.id; g.brandLabel = g.brandLabel || g.label; g.variant = g.variant || ''; g.enabled = g.enabled !== false;
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
  if (feed.parser === 'max789') return parseMax789(data);
  if (feed.parser === 'b52hist') return parseB52Hist(data);
  return parseLC79(data);
}

function parseB52Hist(data) {
  // { Total, Data: [ { Phien, Xuc_xac_1..3, Tong, Ket_qua } ] } or Lich_su
  let rows = [];
  if (Array.isArray(data)) rows = data;
  else if (Array.isArray(data?.Data)) rows = data.Data;
  else if (Array.isArray(data?.Lich_su)) rows = data.Lich_su;
  else if (Array.isArray(data?.data)) rows = data.data;
  else if (data && typeof data === 'object' && (data.Phien || data.phien)) rows = [data];
  return rows.map(item => {
    const dice = [
      Number(item.Xuc_xac_1 ?? item.xuc_xac1 ?? item.xuc_xac?.[0] ?? 0),
      Number(item.Xuc_xac_2 ?? item.xuc_xac2 ?? item.xuc_xac?.[1] ?? 0),
      Number(item.Xuc_xac_3 ?? item.xuc_xac3 ?? item.xuc_xac?.[2] ?? 0)
    ];
    const sum = Number(item.Tong ?? item.tong ?? dice.reduce((a,b)=>a+b,0));
    const raw = String(item.Ket_qua || item.ket_qua || '').toLowerCase();
    let char = sum >= 11 ? 'T' : 'X';
    if (raw.includes('tai') || raw === 't') char = 'T';
    else if (raw.includes('xiu') || raw.includes('xỉu') || raw === 'x') char = 'X';
    else if (raw.includes('bao')) char = sum >= 11 ? 'T' : 'X'; // triple still map TX by sum
    const isBao = dice[0] === dice[1] && dice[1] === dice[2] && dice[0] > 0;
    return {
      session: item.Phien ?? item.phien ?? item.id,
      sum, char, dice, isBao,
      vi: dice.filter(Boolean).join('-')
    };
  }).filter(i => i.session !== undefined && i.session !== null && i.session !== '');
}


/** Max789 MD5: 1 object { phien_truoc, ket_qua, pattern: "ttxxt...", phien_hien_tai, xuc_xac1..3, tong } */
function parseMax789(data) {
  const item = Array.isArray(data) ? data[0] : (data?.data && !Array.isArray(data.data) ? data.data : data);
  if (!item || typeof item !== 'object') return [];
  const pattern = String(item.pattern || item.cau || item.history || '').toLowerCase().replace(/[^tx]/g, '');
  const phienTruoc = item.phien_truoc ?? item.phienTruoc ?? item.session_prev ?? item.Phien ?? item.phien;
  const phienNow = item.phien_hien_tai ?? item.phienHienTai ?? item.session ?? item.Phien;
  const dice = [
    Number(item.xuc_xac1 ?? item.Xuc_xac_1 ?? item.dice1 ?? 0),
    Number(item.xuc_xac2 ?? item.Xuc_xac_2 ?? item.dice2 ?? 0),
    Number(item.xuc_xac3 ?? item.Xuc_xac_3 ?? item.dice3 ?? 0)
  ];
  const sum = Number(item.tong ?? item.Tong ?? item.sum ?? dice.reduce((a, b) => a + b, 0));
  const raw = String(item.ket_qua || item.Ket_qua || item.ketqua || item.result || '').toLowerCase();
  let lastChar = sum >= 11 ? 'T' : 'X';
  if (raw.includes('tai') || raw === 't') lastChar = 'T';
  else if (raw.includes('xiu') || raw.includes('xỉu') || raw === 'x') lastChar = 'X';

  // Build history from pattern (oldest → newest in string left→right typically)
  // pattern ends with latest; use indices relative to phien_truoc
  const list = [];
  if (pattern.length >= 2) {
    const base = Number(phienTruoc);
    const hasBase = Number.isFinite(base);
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i] === 't' ? 'T' : 'X';
      // last char of pattern should align with phien_truoc result
      const sess = hasBase ? (base - (pattern.length - 1 - i)) : (`p-${i}`);
      list.push({ session: sess, char: ch, sum: i === pattern.length - 1 ? sum : null, dice: i === pattern.length - 1 ? dice : null });
    }
    // force last to match ket_qua
    if (list.length) {
      list[list.length - 1].char = lastChar;
      list[list.length - 1].sum = sum;
      list[list.length - 1].dice = dice;
      if (hasBase) list[list.length - 1].session = base;
    }
  } else if (phienTruoc !== undefined && phienTruoc !== null && phienTruoc !== '') {
    const isBao = dice[0] > 0 && dice[0] === dice[1] && dice[1] === dice[2];
    list.push({ session: phienTruoc, char: lastChar, sum, dice, isBao, vi: dice.join('-') });
  }
  // newest first
  return list.reverse().filter(i => i.session !== undefined && i.session !== null && i.session !== '');
}


function listBaccaratTables(data) {
  let rows = [];
  if (Array.isArray(data)) rows = data;
  else if (Array.isArray(data?.data)) rows = data.data;
  else if (Array.isArray(data?.tables)) rows = data.tables;
  const resultStr = (r) => String(r.result || r.results || r.road || '').toUpperCase().replace(/[^BPT]/g, '');
  const tableId = (r) => String(r.table || r.ban || r.name || r.id || '').trim();
  const out = [];
  for (const r of rows) {
    const results = resultStr(r);
    if (results.length < 5) continue;
    const eng = new BaccaratEngine();
    for (const ch of results) eng.addResult(ch, null, { goodRoad: r.good_road || r.goodRoad || '' });
    const pred = eng.getEnsemblePrediction();
    const conf = Number(pred.confidence) || 0;
    const score = conf + (pred.market?.regime === 'Super' ? 8 : 0) + Math.min(results.length, 40) * 0.15;
    out.push({
      table: tableId(r) || '?',
      results,
      length: results.length,
      predictedResult: pred.predictedResult,
      confidence: conf,
      reason: pred.reason || '',
      regime: pred.market?.regime || '',
      score,
      recommend: conf >= 68 && results.length >= 12
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

function parseBaccarat(data, tableFilter) {
  // API thật: { success:true, data:[ { table:"7", result:"PPBBB...", shoeId, round } ] }
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
    // bàn có chuỗi kết quả dài nhất (đủ data để đoán)
    row = rows.slice().sort((a, b) => resultStr(b).length - resultStr(a).length)[0];
  }
  if (!row) return [];

  const results = resultStr(row);
  if (results.length < 3) return [];

  const goodRoad = row.good_road || row.goodRoad || row.road_name || '';
  const tableName = tableId(row) || 'Baccarat';
  const shoe = String(row.shoeId || row.shoe || '');

  // mỗi ký tự = 1 phiên; session ổn định theo table + index + shoe
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
  // mới nhất ở đầu
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


/** Sicbo: VỊ = đoán TỔNG 3 xúc xắc (3–18). Bão hiếm → ít/không đoán bão. TX vẫn là cửa chính. */
function enhanceSicbo(feed, ensemble) {
  const hist = feed.history || [];
  const rows = hist.filter(h => Number.isFinite(Number(h.sum))).slice(0, 60);
  const baoCount = hist.slice(0, 50).filter(h => h.isBao).length;
  const baoRate = hist.length ? baoCount / Math.min(hist.length, 50) : 0.02;
  const baoProb = Math.round(Math.min(6, Math.max(1, baoRate * 100)));

  // Phân bố tổng gần đây (3–18)
  const sumFreq = {};
  for (let s = 3; s <= 18; s++) sumFreq[s] = 0;
  for (const r of rows.slice(0, 40)) {
    const s = Math.round(Number(r.sum));
    if (s >= 3 && s <= 18) sumFreq[s]++;
  }
  // Trọng số: phiên mới hơn quan trọng hơn
  const weighted = {};
  for (let s = 3; s <= 18; s++) weighted[s] = 0;
  rows.slice(0, 30).forEach((r, i) => {
    const s = Math.round(Number(r.sum));
    if (s < 3 || s > 18) return;
    const w = 1 + (30 - i) * 0.08;
    weighted[s] += w;
  });

  // Top 3 tổng có trọng số cao
  const ranked = Object.entries(weighted)
    .map(([s, w]) => ({ sum: Number(s), w, n: sumFreq[s] || 0 }))
    .sort((a, b) => b.w - a.w);
  const top3 = ranked.slice(0, 3).filter(x => x.w > 0);

  // Vị chính = tổng điểm cao nhất; lệch theo cửa TX nếu mâu thuẫn mạnh
  let viTong = top3.length ? top3[0].sum : null;
  const isTai = String(ensemble.predictedResult || '').toUpperCase().includes('T');
  if (viTong != null) {
    const tongIsTai = viTong >= 11;
    // Nếu top1 ngược cửa TX quá mạnh → chọn top trong cùng phía TX
    if (tongIsTai !== isTai && top3.length > 1) {
      const sameSide = ranked.find(x => (x.sum >= 11) === isTai && x.w > 0);
      if (sameSide) viTong = sameSide.sum;
    }
  }
  // Độ tin vị: conf thấp hơn TX, không overclaim
  let viConf = 0;
  if (viTong != null && ranked[0]) {
    const totalW = ranked.reduce((a, b) => a + b.w, 0) || 1;
    viConf = Math.round(Math.min(62, Math.max(28, (ranked[0].w / totalW) * 100 + 15)));
  }

  // Không đoán bão (hiếm)
  return {
    ...ensemble,
    gameType: 'sicbo',
    sicbo: {
      baoProb,
      baoHint: false,
      viTong,           // TỔNG 3 viên (vị)
      viConf,
      viTop3: top3.map(x => x.sum),
      note: 'Vị = tổng 3 XX · Bão hiếm, không ép đoán bão'
    }
  };
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
    if (!list.length) throw new Error('API không trả về danh sách phiên phù hợp');
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
      const row = { session: item.session, char: item.char, sum: item.sum, dice: item.dice, isBao: item.isBao, vi: item.vi, ts: Date.now() };
      if (scoreRow) { row.prediction = scoreRow.predicted; row.isCorrect = scoreRow.isCorrect; }
      f.history.unshift(row);
      f.history = f.history.slice(0, 5000);
      seen.add(String(item.session));
    }
    f._seen = [...seen].slice(-5000);

    // Nếu có historyUrl (sicbo) — hydrate thêm lịch sử
    if (f.historyUrl && f.history.length < 15) {
      try {
        const hr = await fetch(f.historyUrl, { signal: ctrl.signal, headers: { accept: 'application/json' } });
        if (hr.ok) {
          const hd = await hr.json();
          const hlist = parseB52Hist(hd);
          const seen = new Set((f._seen || []).map(String));
          for (const item of [...hlist].reverse()) {
            if (seen.has(String(item.session))) continue;
            f.engine.addResult(item.char, item.sum, undefined);
            f.history.unshift({ session: item.session, char: item.char, sum: item.sum, dice: item.dice, isBao: item.isBao, vi: item.vi, ts: Date.now() });
            seen.add(String(item.session));
          }
          f.history = f.history.slice(0, 5000);
          f._seen = [...seen].slice(-5000);
        }
      } catch (_) {}
    }

    f.lastSession = latest.session;
    f.lastLive = f.history.find(h => sessionEquals(h.session, latest.session)) || { ...latest, ts: Date.now() };
    const ensemble = f.engine.getEnsemblePrediction();
    f.lastEnsemble = ensemble;
    const pr = String(ensemble.predictedResult || '').toUpperCase();
    let predicted = 'X';
    if (pr === 'TÀI' || pr === 'TAI' || pr === 'T') predicted = 'T';
    else if (pr === 'XỈU' || pr === 'XIU' || pr === 'X') predicted = 'X';
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
  groupTaskText: 'Cần rải quảng cáo vào 3 nhóm bất kì.\n\n📌 Cách làm:\n1) Sao chép câu promo admin cung cấp\n2) Vào 3 nhóm bất kì và gửi tin nhắn\n3) Chụp màn hình 3 tin nhắn vừa gửi\n4) Gửi 3 ảnh vào đây cho Bot duyệt\n\n⚠️ Lưu ý:\n- Ảnh rõ, thể hiện đã gửi thành công\n- Phải đủ 3 ảnh từ 3 nhóm khác nhau',
  groupPromoText: '@SunNetWin tool dự đoán TX VIP — getkey miễn phí, hỗ trợ 24/7',
  groupTaskPhotos: 3,
  groupTaskTimeoutSec: 300,
  supportUrl: 'https://t.me/SunNetWin',
  watermarkText: 'SunWin · MD5 · HitClub · Tool tưng tửng',
  siteTitle: 'Tool tưng tửng',
  maintenance: {
    enabled: false,
    message: 'Hệ thống đang bảo trì, vui lòng quay lại sau.',
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
      { id: '1d', label: '1 ngày', price: 3000, durationHours: 24, active: true },
      { id: '3d', label: '3 ngày', price: 7000, durationHours: 72, active: true },
      { id: '1w', label: '1 tuần', price: 15000, durationHours: 168, active: true },
      { id: '1m', label: '1 tháng', price: 40000, durationHours: 720, active: true },
      { id: '2m', label: '2 tháng', price: 70000, durationHours: 1440, active: true },
      { id: 'lifetime', label: 'Vĩnh viễn', price: 100000, durationHours: 87600, active: true }
    ];
  }
  const ids = new Set();
  for (const plan of plans) { if (ids.has(plan.id)) throw new Error('Mã gói bị trùng: ' + plan.id); ids.add(plan.id); }
  return {
    telegramUsername: String(v.telegramUsername || '').trim().replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 64),
    groupTaskText: String(v.groupTaskText || '').slice(0, 2000),
    groupPromoText: String(v.groupPromoText || '').slice(0, 500),
    groupTaskPhotos: Math.min(10, Math.max(1, Number(v.groupTaskPhotos) || 3)),
    groupTaskTimeoutSec: Math.min(3600, Math.max(60, Number(v.groupTaskTimeoutSec) || 300)),
    supportUrl: String(v.supportUrl || 'https://t.me/SunNetWin').trim().slice(0, 200),
    watermarkText: String(v.watermarkText || 'SunWin · MD5 · HitClub · Tool tưng tửng').trim().slice(0, 300),
    siteTitle: String(v.siteTitle || 'Tool tưng tửng').trim().slice(0, 80),
    maintenance: {
      enabled: !!(v.maintenance && v.maintenance.enabled),
      message: String((v.maintenance && v.maintenance.message) || 'Hệ thống đang bảo trì, vui lòng quay lại sau.').slice(0, 500),
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
  if (!request) return { ok: false, error: 'Không tìm thấy yêu cầu.' };
  if (request.status !== 'pending') return { ok: false, error: 'Yêu cầu này đã được xử lý.' };
  request.status = approved ? 'approved' : 'rejected'; request.reviewedAt = Date.now(); request.reviewer = String(reviewer || 'admin');
  let issued = null;
  if (approved && request.type === 'reset') {
    const k = findKey(request.resetKeyPlain || '') || keys.find(x => x.id === request.resetKeyId);
    if (k) { k.deviceHashes = []; saveKeys(); }
  } else if (approved) {
    const hours = Math.max(1, Number(request.durationHours || 5));
    issued = createKey({ label: `${request.planLabel || 'Key free'} · TG ${request.telegramId}`, durationHours: hours, deviceLimit: 3,
      source: request.type === 'payment' ? 'telegram-payment' : 'telegram-group', telegramId: request.telegramId });
    request.issuedKey = issued.plainKey;
    request.issuedKeyExpiresAt = issued.record.expiresAt;
  }
  saveRequests();
  return { ok: true, request, key: issued?.plainKey || null, meta: issued ? { label: issued.record.label, durationHours: request.durationHours, expiresAt: issued.record.expiresAt } : null };
}

// ---------- public endpoints ----------
app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now(), games: Object.keys(FEEDS) }));

// ---------- Telegram Mini App helpers ----------
function getPublicBase() {
  let s = String(process.env.PUBLIC_URL || process.env.WEB_URL || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  return s.replace(/\/+$/, '');
}
function isTelegramAdmin(tgId) {
  const ids = String(process.env.TELEGRAM_ADMIN_IDS || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
  return ids.includes(String(tgId));
}
async function answerTelegram(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('no bot token');
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) console.warn('[tg]', method, j.description || j);
  return j;
}

app.get('/api/public/miniapp', (req, res) => {
  const base = getPublicBase() || (req.protocol + '://' + req.get('host'));
  res.json({
    userUrl: base + '/',
    adminUrl: base + '/admin',
    brand: 'Tool tưng tửng',
    support: '@SunNetWin'
  });
});

// Mini App: xác thực sơ bộ bằng initDataUnsafe user id (production nên verify hash HMAC)
app.post('/api/auth/telegram-webapp', express.json(), (req, res) => {
  const user = req.body?.user || {};
  const tgId = user.id || user.user_id;
  if (!tgId) return res.status(400).json({ error: 'Thiếu Telegram user' });
  const admin = isTelegramAdmin(tgId);
  const base = getPublicBase() || (req.protocol + '://' + req.get('host'));
  // IP từ proxy
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  res.json({
    ok: true,
    telegramId: tgId,
    isAdmin: admin,
    ip,
    openUrl: admin ? (base + '/admin') : (base + '/'),
    role: admin ? 'admin' : 'user'
  });
});


app.get('/api/public/config', (req, res) => {
  const games = (Array.isArray(gameConfigs) ? gameConfigs : []).map(g => g.label || g.id).filter(Boolean);
  const wm = botSettings.watermarkText || (games.length ? games.join(' · ') + ' · Tool tưng tửng' : 'Tool tưng tửng');
  res.json({
    brand: BRAND,
    siteTitle: botSettings.siteTitle || 'Tool tưng tửng',
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
  if (!rateLimit(req.ip)) return res.status(429).json({ error: 'Bạn thử quá nhiều lần. Vui lòng đợi 1 phút.' });
  const plain = String(req.body?.key || '').trim();
  if (!plain) return res.status(400).json({ error: 'Vui lòng nhập key VIP.' });
  const found = findKey(plain);
  if (!found || found.status === 'revoked') return res.status(401).json({ error: 'Key không hợp lệ hoặc đã bị thu hồi.' });
  if (isExpired(found)) return res.status(401).json({ error: 'Key đã hết hạn. Hãy nhận hoặc mua key mới trên Telegram.' });
  const deviceId = String(req.body?.deviceId || '').trim();
  if (!deviceId || deviceId.length > 200) return res.status(400).json({ error: 'Không xác định được thiết bị. Hãy tải lại trang và thử lại.' });
  const deviceHash = sha256(deviceId);
  if (!found.deviceHashes.includes(deviceHash)) {
    if (found.deviceHashes.length >= Math.max(1, Number(found.deviceLimit || 1))) return res.status(403).json({ error: `Key đã đạt giới hạn ${found.deviceLimit || 1} thiết bị.` });
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
  if (!rateLimit(req.ip)) return res.status(429).json({ error: 'Bạn thử quá nhiều lần. Vui lòng đợi 1 phút.' });
  const password = String(req.body?.password || '');
  if (!secureEqual(password, ADMIN_PASSWORD)) return res.status(401).json({ error: 'Mật khẩu admin không đúng.' });
  const token = sign({ type: 'admin', exp: Date.now() + TOKEN_TTL_MS });
  logLine('admin login ok');
  res.json({ token, expiresIn: TOKEN_TTL_MS });
});

// ---------- user prediction endpoints ----------

app.get('/api/baccarat/tables', requireUser, async (req, res) => {
  const gid = String(req.query.game || 'baccarat');
  const f = FEEDS[gid];
  if (!f || !f.enabled || f.parser !== 'baccarat') {
    return res.status(400).json({ error: 'Game Baccarat không khả dụng.' });
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const response = await fetch(f.url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    clearTimeout(t);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    const tables = listBaccaratTables(data);
    res.json({
      game: gid,
      tables,
      recommended: tables.filter(x => x.recommend).slice(0, 6),
      updatedAt: Date.now()
    });
  } catch (e) {
    res.status(502).json({ error: 'Không lấy được danh sách bàn: ' + (e.message || e) });
  }
});

app.post('/api/baccarat/select', requireUser, async (req, res) => {
  const gid = String(req.body?.game || req.query.game || 'baccarat');
  const table = String(req.body?.table || req.query.table || '').trim();
  const f = FEEDS[gid];
  if (!f || !f.enabled || f.parser !== 'baccarat') {
    return res.status(400).json({ error: 'Game Baccarat không khả dụng.' });
  }
  if (!table) return res.status(400).json({ error: 'Thiếu tên bàn.' });
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 15000);
    const response = await fetch(f.url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    clearTimeout(to);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    // set table filter and rebuild engine from that table
    f.table = table;
    const cfg = gameConfigs.find(g => g.id === gid);
    if (cfg) { cfg.table = table; saveGameConfigs(); }
    const list = parseBaccarat(data, table);
    if (!list.length) return res.status(400).json({ error: 'Không có dữ liệu bàn ' + table });
    f.engine = new BaccaratEngine();
    f.history = [];
    f._seen = [];
    f.pendingPred = null;
    // oldest first then add
    const chrono = [...list].reverse();
    for (const item of chrono) {
      f.engine.addResult(item.char, item.sum, item.goodRoad ? { goodRoad: item.goodRoad } : undefined);
      f.history.unshift({ session: item.session, char: item.char, sum: item.sum, ts: Date.now() });
    }
    f.history = f.history.slice(0, 5000);
    f.lastSession = list[0].session;
    f.lastLive = { ...list[0], ts: Date.now() };
    f._seen = f.history.map(h => String(h.session)).slice(0, 5000);
    const ensemble = f.engine.getEnsemblePrediction();
    res.json({
      ok: true,
      table,
      predictedResult: ensemble.predictedResult,
      confidence: ensemble.confidence,
      reason: ensemble.reason,
      gameType: 'baccarat',
      live: f.lastLive
    });
  } catch (e) {
    res.status(502).json({ error: e.message || String(e) });
  }
});


app.get('/api/games', requireUser, (req, res) => res.json({ games: gameConfigs.filter(g => g.enabled !== false && FEEDS[g.id]).map(g => ({ id: g.id, label: g.label, gameType: g.parser === 'baccarat' ? 'baccarat' : (g.group === 'sicbo' ? 'sicbo' : 'tx'), group: g.group || 'tx', icon: g.icon || '', brand: g.brand || g.id, brandLabel: g.brandLabel || g.label, variant: g.variant || '', playUrl: g.parser === 'baccarat' ? '' : (g.playUrl || '') })) }));
app.get('/api/me', requireUser, (req, res) => {
  const k = req.userKey;
  res.json({
    label: k.label,
    expiresAt: k.expiresAt || null,
    deviceLimit: k.deviceLimit || 1,
    devicesUsed: Array.isArray(k.deviceHashes) ? k.deviceHashes.length : 0,
    keyId: k.id || null,
    status: k.status || 'active'
  });
});
app.get('/api/predict', requireUser, (req, res) => {
  const f = FEEDS[req.query.game];
  if (!f || !f.enabled) return res.status(400).json({ error: 'Game không tồn tại hoặc đang tắt.' });
  const mt = botSettings.maintenance || {};
  const gid = String(req.query.game || '').toLowerCase();
  if (mt.enabled && Array.isArray(mt.lockedGames) && mt.lockedGames.map(String).map(s=>s.toLowerCase()).includes(gid)) {
    return res.status(503).json({ error: mt.message || 'Game đang bảo trì.', maintenance: true });
  }
  let ensemble = f.engine.getEnsemblePrediction();
  const cfg = gameConfigs.find(g => g.id === f.id) || {};
  if (cfg.group === 'sicbo' || f.group === 'sicbo') {
    ensemble = enhanceSicbo(f, ensemble);
  }
  const ms = f.engine.marketState || ensemble.market || {};
  const gameType = ensemble.gameType || (f.parser === 'baccarat' ? 'baccarat' : (cfg.group === 'sicbo' ? 'sicbo' : 'tx'));
  res.json({
    game: req.query.game,
    label: f.label,
    gameType,
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
    algos: ensemble.algos || null,
    sicbo: ensemble.sicbo || null,
    verdict: (Number(ensemble.confidence) || 0) >= 68 ? 'NÊN VÀO' : (Number(ensemble.confidence) || 0) >= 58 ? 'CÂN NHẮC' : 'BỎ QUA'
  });
});
app.get('/api/live', requireUser, (req, res) => {
  const f = FEEDS[req.query.game]; if (!f || !f.enabled) return res.status(400).json({ error: 'Game không tồn tại hoặc đang tắt.' });
  res.json({ live: f.lastLive || null, nextSession: f.lastLive && Number.isFinite(Number(f.lastLive.session)) ? Number(f.lastLive.session) + 1 : null });
});
app.get('/api/history', requireUser, (req, res) => {
  const f = FEEDS[req.query.game]; if (!f || !f.enabled) return res.status(400).json({ error: 'Game không tồn tại hoặc đang tắt.' });
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
  } catch (e) { res.status(400).json({ error: e.message || 'Không tạo được key.' }); }
});
app.patch('/api/admin/keys/:id', requireAdmin, (req, res) => {
  const key = keys.find(k => k.id === req.params.id);
  if (!key) return res.status(404).json({ error: 'Không tìm thấy key.' });
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
        if (!Number.isFinite(date) || date <= Date.now()) throw new Error('Ngày hết hạn phải ở tương lai.');
        key.expiresAt = date;
      }
    }
    if (req.body?.status !== undefined) key.status = req.body.status === 'revoked' ? 'revoked' : 'active';
    saveKeys(); logLine(`key updated: ${key.label}`); res.json({ ok: true, key: publicKeyInfo(key) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/admin/keys/:id/reset-devices', requireAdmin, (req, res) => {
  const key = keys.find(k => k.id === req.params.id);
  if (!key) return res.status(404).json({ error: 'Không tìm thấy key.' });
  key.deviceHashes = []; saveKeys(); logLine('reset devices for key ' + key.id); res.json({ ok: true });
});
app.delete('/api/admin/keys/:id', requireAdmin, (req, res) => {
  const key = keys.find(k => k.id === req.params.id);
  if (!key) return res.status(404).json({ error: 'Không tìm thấy key.' });
  key.status = 'revoked'; saveKeys(); logLine(`key revoked: ${key.label}`); res.json({ ok: true });
});

// ---------- admin: game API management ----------
app.get('/api/admin/games', requireAdmin, (req, res) => res.json({ games: gameConfigs.map(g => ({ ...g, lastSession: FEEDS[g.id]?.lastSession ?? null, historyCount: FEEDS[g.id]?.history.length || 0, lastError: FEEDS[g.id]?.lastError || null })) }));
app.post('/api/admin/games', requireAdmin, (req, res) => {
  const id = String(req.body?.id || '').trim().toLowerCase();
  const label = String(req.body?.label || '').trim();
  const url = String(req.body?.url || '').trim();
  const parser = ['sunwin','baccarat','max789','b52hist'].includes(req.body?.parser) ? req.body.parser : 'lc79';
  if (!/^[a-z0-9_-]{2,32}$/.test(id)) return res.status(400).json({ error: 'Mã game chỉ gồm chữ thường, số, _ hoặc - (2–32 ký tự).' });
  if (gameConfigs.some(g => g.id === id)) return res.status(409).json({ error: 'Mã game đã tồn tại.' });
  if (!label) return res.status(400).json({ error: 'Hãy nhập tên game.' });
  if (!validHttpUrl(url)) return res.status(400).json({ error: 'API phải là URL HTTP hoặc HTTPS hợp lệ.' });
  const config = { id, label: label.slice(0, 80), url, parser, table: String(req.body?.table || '').slice(0, 80), playUrl: String(req.body?.playUrl || '').trim().slice(0, 500), enabled: req.body?.enabled !== false };
  gameConfigs.push(config); saveGameConfigs(); FEEDS[id] = createFeed(config); logLine(`game added: ${id}`);
  res.json({ ok: true, game: config });
});
app.patch('/api/admin/games/:id', requireAdmin, (req, res) => {
  const config = gameConfigs.find(g => g.id === req.params.id);
  if (!config) return res.status(404).json({ error: 'Không tìm thấy game.' });
  const label = req.body?.label === undefined ? config.label : String(req.body.label || '').trim();
  const url = req.body?.url === undefined ? config.url : String(req.body.url || '').trim();
  if (!label) return res.status(400).json({ error: 'Tên game không được để trống.' });
  if (!validHttpUrl(url)) return res.status(400).json({ error: 'API phải là URL HTTP hoặc HTTPS hợp lệ.' });
  config.label = label.slice(0, 80); config.url = url;
  if (req.body?.parser !== undefined) config.parser = ['sunwin','baccarat','max789','b52hist'].includes(req.body.parser) ? req.body.parser : 'lc79';
  if (req.body?.table !== undefined) config.table = String(req.body.table || '').slice(0, 80);
  if (req.body?.enabled !== undefined) config.enabled = req.body.enabled !== false;
  if (FEEDS[config.id]) { Object.assign(FEEDS[config.id], { label: config.label, url: config.url, parser: config.parser, enabled: config.enabled, playUrl: config.playUrl || '', table: config.table || '', group: config.group || 'tx', historyUrl: config.historyUrl || '' }); }
  saveGameConfigs(); logLine(`game updated: ${config.id}`); res.json({ ok: true, game: config });
});
app.delete('/api/admin/games/:id', requireAdmin, (req, res) => {
  const i = gameConfigs.findIndex(g => g.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Không tìm thấy game.' });
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
  const f = FEEDS[req.query.game]; if (!f) return res.status(400).json({ error: 'Game không hợp lệ.' });
  const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 500));
  res.json({ game: req.query.game, history: f.history.slice(0, limit) });
});
app.get('/api/admin/accuracy', requireAdmin, (req, res) => {
  const f = FEEDS[req.query.game]; if (!f) return res.status(400).json({ error: 'Game không hợp lệ.' });
  const limit = Math.min(10000, Math.max(1, parseInt(req.query.limit, 10) || 10000));
  res.json({ game: req.query.game, history: f.accuracyHistory.slice(0, limit), correct: f.correct, total: f.total, accuracy: f.total ? +(f.correct / f.total * 100).toFixed(1) : null });
});
app.post('/api/admin/reset', requireAdmin, (req, res) => {
  const id = req.body?.game;
  const ids = id === 'all' ? Object.keys(FEEDS) : [id];
  if (!ids.length || ids.some(k => !FEEDS[k])) return res.status(400).json({ error: 'Game không hợp lệ.' });
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
  catch (e) { res.status(400).json({ error: e.message || 'Không lưu được cài đặt.' }); }
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
    if (!telegramBot) return res.status(503).json({ error: 'Bot Telegram chưa được khởi động; key đã tạo nhưng chưa gửi được.' });
    try {
      await telegramBot.sendKeyToUser(result.request.telegramId, result.key, result.meta || {});
      markDelivered(result.request.id);
    } catch (e) { return res.status(502).json({ error: 'Đã duyệt nhưng không gửi được key qua Telegram: ' + e.message }); }
  }
  if (!approved && telegramBot) {
    try { await telegramBot.sendTextToUser(result.request.telegramId, `❌ Yêu cầu #${result.request.id} đã bị từ chối. Vui lòng kiểm tra lại chứng từ hoặc liên hệ admin.`); } catch {}
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


// ---------- AUTO PAYMENT: VietQR orders + webhook (SePay/Casso/PayOS) ----------
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
let orders = loadJSON(ORDERS_FILE, []);
if (!Array.isArray(orders)) orders = [];
const saveOrders = () => saveJSON(ORDERS_FILE, orders);

function genOrderId() { return 'TT' + crypto.randomBytes(3).toString('hex').toUpperCase(); }

function buildVietQr(amount, addInfo) {
  const cfg = botSettings || {};
  if (!cfg.bankCode || !cfg.bankAccount) return null;
  return 'https://img.vietqr.io/image/' + encodeURIComponent(cfg.bankCode) + '-' + encodeURIComponent(cfg.bankAccount) + '-compact2.jpg?amount=' + encodeURIComponent(String(Math.round(Number(amount)||0))) + '&addInfo=' + encodeURIComponent(addInfo) + '&accountName=' + encodeURIComponent(cfg.bankAccountName || '');
}

async function tgSendMessage(chatId, text, extra) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return false;
  try {
    const r = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(Object.assign({ chat_id: chatId, text: text, parse_mode: 'HTML', disable_web_page_preview: true }, extra || {}))
    });
    return r.ok;
  } catch(e) { return false; }
}

async function fulfillOrder(order, transactionRef) {
  if (order.status === 'paid') return order;
  order.status = 'paid'; order.paidAt = Date.now(); order.transactionRef = transactionRef || '';
  const plan = (botSettings.plans || []).find(p => p.id === order.planId);
  const hours = Math.max(1, Number(plan && plan.durationHours || order.durationHours || 24));
  const devices = Math.max(1, Number(plan && plan.deviceLimit || 3));
  const issued = createKey({ label: (plan && plan.label || 'Key') + ' · Auto ' + order.id, durationHours: hours, deviceLimit: devices, source: 'auto-payment', telegramId: order.telegramId || null });
  order.issuedKey = issued.plainKey; order.issuedKeyExpiresAt = issued.record.expiresAt;
  saveOrders(); saveKeys();
  if (order.telegramId) {
    const days = hours >= 24 ? Math.round(hours/24) + ' ngày' : hours + ' giờ';
    await tgSendMessage(order.telegramId,
      '✅ <b>THANH TOÁN THÀNH CÔNG</b>\n────────────────────\n📦 <b>' + (plan && plan.label || 'Key VIP') + '</b> · ⏱ ' + days + '\n🔑 Mã của bạn:\n<code>' + issued.plainKey + '</code>\n\n🎮 Mở tool: ' + (getPublicBase() || '') + '\n💬 @SunNetWin');
  }
  return order;
}

// Tạo đơn hàng từ Mini App → trả VietQR + nội dung CK
app.post('/api/shop/order', (req, res) => {
  const planId = String(req.body && req.body.planId || '').toLowerCase();
  const telegramId = req.body && req.body.telegramId ? String(req.body.telegramId) : null;
  const plan = (botSettings.plans || []).find(p => p.id === planId && p.active !== false);
  if (!plan) return res.status(400).json({ error: 'Gói không tồn tại.' });
  if (!botSettings.bankCode || !botSettings.bankAccount) return res.status(503).json({ error: 'Admin chưa cấu hình ngân hàng VietQR. Dùng /setbank trên bot.' });
  const orderId = genOrderId();
  const order = { id: orderId, planId: planId, planLabel: plan.label, price: Number(plan.price), durationHours: Number(plan.durationHours), deviceLimit: Number(plan.deviceLimit || 3), telegramId: telegramId, status: 'pending', createdAt: Date.now(), content: orderId };
  orders.push(order); if (orders.length > 500) orders.splice(0, orders.length - 500); saveOrders();
  res.json({ ok: true, orderId: orderId, content: orderId, amount: order.price, planLabel: plan.label, durationHours: order.durationHours, deviceLimit: order.deviceLimit,
    qrUrl: buildVietQr(order.price, orderId),
    bank: { code: botSettings.bankCode, account: botSettings.bankAccount, name: botSettings.bankAccountName } });
});

// Kiểm tra trạng thái đơn (Mini App polling)
app.get('/api/shop/order/:id', (req, res) => {
  const o = orders.find(x => x.id === String(req.params.id).toUpperCase());
  if (!o) return res.status(404).json({ error: 'Không tìm thấy đơn.' });
  res.json({ ok: true, orderId: o.id, status: o.status, price: o.price, planLabel: o.planLabel, issuedKey: o.status === 'paid' ? o.issuedKey : null, expiresAt: o.issuedKeyExpiresAt || null, paidAt: o.paidAt || null });
});

// Webhook nhận giao dịch từ SePay / Casso / PayOS → auto phát key
app.post('/api/payment/webhook', async (req, res) => {
  try {
    const body = req.body || {};
    const rawContent = String(body.content || body.description || body.orderCode || body.addInfo || '').toUpperCase();
    const amount = Number(body.transferAmount || body.amount || body.transfer_amount || 0);
    const ref = String(body.referenceCode || body.id || body.reference || '');
    if (!rawContent || !amount) return res.json({ ok: false, error: 'Thieu noi dung/so tien' });
    const cleanContent = rawContent.replace(/[^A-Z0-9]/g, '');
    let matched = false;
    // 1) Đơn Mini App: TT + 6 ký tự hex
    const orderMatch = cleanContent.match(/TT([0-9A-F]{6})/);
    if (orderMatch) {
      const oid = 'TT' + orderMatch[1];
      const order = orders.find(x => x.id === oid && x.status === 'pending');
      if (order && Math.abs(amount - order.price) < 1000) { await fulfillOrder(order, ref); matched = true; }
    }
    // 2) Luồng bot cũ: KEYVIP + telegramId → auto duyệt payment request
    if (!matched) {
      const kvMatch = cleanContent.match(/KEYVIP(\d+)/);
      if (kvMatch) {
        const tgId = kvMatch[1];
        const reqPay = botRequests.find(r => r.type === 'payment' && r.status === 'pending' && String(r.telegramId) === tgId);
        if (reqPay && Math.abs(amount - Number(reqPay.price || 0)) < 1000) {
          const result = reviewRequest(reqPay.id, true, 'auto-webhook');
          if (result.ok && result.key) {
            await tgSendMessage(tgId, '✅ <b>THANH TOÁN THÀNH CÔNG</b>\n🔑 Mã của bạn:\n<code>' + result.key + '</code>\n\n🎮 Mở tool ngay trong Telegram');
            matched = true;
          }
        }
      }
    }
    res.json({ ok: true, matched: matched });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});


// Auto-fetch key theo Telegram ID (admin duyệt thủ công → Mini App tự nhận key)
app.get('/api/shop/my-key', (req, res) => {
  const tgId = String(req.query.telegramId || '');
  if (!tgId) return res.status(400).json({ ok:false, error:'Thieu telegramId' });
  const approved = botRequests.filter(function(r){ return String(r.telegramId||'')===tgId && r.status==='approved' && r.issuedKey; })
    .sort(function(a,b){ return (b.reviewedAt||0)-(a.reviewedAt||0); });
  if (approved.length) {
    const r = approved[0];
    if (r.issuedKeyExpiresAt && Number(r.issuedKeyExpiresAt) <= Date.now()) {
      return res.json({ ok:true, hasKey:false, reason:'expired' });
    }
    return res.json({ ok:true, hasKey:true, key:r.issuedKey, label:r.planLabel || 'Key VIP', expiresAt:r.issuedKeyExpiresAt || null });
  }
  const pending = botRequests.some(function(r){ return String(r.telegramId||'')===tgId && r.status==='pending'; });
  res.json({ ok:true, hasKey:false, pending:pending });
});


// Lấy danh sách gói key (admin chỉnh trên bot → cửa hàng tự cập nhật)
app.get('/api/shop/plans', (req, res) => {
  const plans = (botSettings.plans || []).filter(function(p){ return p.active !== false && Number(p.price) > 0 && Number(p.durationHours) > 0; });
  res.json({ ok: true, plans: plans.map(function(p){ return { id: String(p.id), label: String(p.label), price: Number(p.price), durationHours: Number(p.durationHours), deviceLimit: Number(p.deviceLimit || 3) }; }) });
});

app.listen(PORT, () => {
  logLine(`SERVER listening on port ${PORT}; admin password configured=${!!process.env.ADMIN_PASSWORD}; games=${Object.keys(FEEDS).length}`);
});
