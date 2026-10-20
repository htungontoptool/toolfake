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
        this.initAllModels();
    }

    initAllModels() {
        for (let i = 1; i <= 10; i++) {
            if (this[`model${i}`]) {
                this.models[`model${i}`] = this[`model${i}`].bind(this);
                this.weights[`model${i}`] = i === 1 ? 0.45 : 1.0;
                this.modelHits[`model${i}`] = { win: 0, loss: 0, ewma: 0.5 };
            }
        }
        this.models['model_antiBreak'] = this.model_antiBreak.bind(this);
        this.weights['model_antiBreak'] = 1.25;
        this.modelHits['model_antiBreak'] = { win: 0, loss: 0, ewma: 0.5 };
        for (let i = 11; i <= 15; i++) {
            if (this[`model${i}`]) {
                this.models[`model${i}`] = this[`model${i}`].bind(this);
                this.weights[`model${i}`] = 1.0;
                this.modelHits[`model${i}`] = { win: 0, loss: 0, ewma: 0.5 };
            }
        }


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

    // Model 1: Cau 1-1 (nhi p don) — boost khi autocorr am
    model1() {
        const recent = this.history.slice(-6);
        if (recent.length < 4) return null;
        const last4 = recent.slice(-4).join('-');
        const boost = this.autocorr < -0.1 ? 1.15 : 1.0;
        if (last4 === 'T-X-T-X') return { prediction: 'T', confidence: Math.min(0.65 * boost, 0.85), reason: 'Bắt Nhịp Cầu Đơn 1-1 (Rõ Ràng)' };
        if (last4 === 'X-T-X-T') return { prediction: 'X', confidence: Math.min(0.65 * boost, 0.85), reason: 'Bắt Nhịp Cầu Đơn 1-1 (Rõ Ràng)' };
        if (recent.length >= 6) {
            const s6 = recent.join('');
            if (s6 === 'TXTXTX') return { prediction: 'T', confidence: 0.78, reason: 'Cầu Nhịp Hoàn Hảo 6 Phiên' };
            if (s6 === 'XTXTXT') return { prediction: 'X', confidence: 0.78, reason: 'Cầu Nhịp Hoàn Hảo 6 Phiên' };
        }
        return null;
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
            // dam bao cac model moi deu co trong so / EWMA mac dinh
            for (const k in this.models) {
                if (!(k in this.weights)) this.weights[k] = (k === 'model1') ? 0.45 : (k === 'model_antiBreak' ? 1.25 : 1.0);
                if (!(k in this.modelHits)) this.modelHits[k] = { win: 0, loss: 0, ewma: 0.5 };
            }
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

    // Ensemble: Log-odds pooling + trong so EWMA accuracy + shrink + cooling
    getEnsemblePrediction() {
        const allPreds = this.getAllPredictions();
        let logOdds = 0;   // >0 ung voi TAI
        let totalWeight = 0;
        let activeCount = 0;
        let topReason = 'Thuật Toán Engine @SunNetWin';
        let highestW = 0;

        for (const [modelName, pred] of Object.entries(allPreds)) {
            if (!pred || !pred.prediction) continue;
            const baseW = (this.weights[modelName] !== undefined ? this.weights[modelName] : 1.0);
            const ewma = this.modelHits[modelName] ? this.modelHits[modelName].ewma : 0.5;
            const accMult = 0.5 + ewma; // 0.5 .. 1.5 — model hay dung duoc tang trong so
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
}// ================= SERVER WRAPPER =================
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
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

  // ─── USER MENU (command only, no buttons) ───────────────
  async function showStart(chatId, name) {
    await send(chatId,
`✨ <b>VIP ORACLE</b>
────────────────
👋 Xin chào <b>${esc(name)}</b>

📌 <b>Lệnh nhanh</b>
/free — 🎯 Key miễn phí
/buy — 💎 Mua key VIP
/resetkey — 🔄 Reset thiết bị (tự động)
/tiktok &lt;user|link&gt; — 📱 Info TikTok
/fb &lt;user|link&gt; — 📘 Info Facebook
/status — 🔑 Trạng thái yêu cầu

🔑 Key · tối đa <b>3 thiết bị</b>
💬 Hỗ trợ: @SunNetWin`);
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

⚙️ <b>Cấu hình</b>
/settask &lt;nội dung&gt;
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
      ? `💎 ${request.planLabel} · ${fmt(request.price)}đ · ${request.durationHours}h`
      : request.type === 'reset' ? '🔄 Xin reset thiết bị' : '🎯 Key free';
    const caption =
`📩 <b>#${request.id}</b> · ${request.type === 'payment' ? '💳' : request.type === 'reset' ? '🔄' : '🎯'}
👤 ${esc(request.userName)} (@${esc(request.username || '—')})
🆔 <code>${request.telegramId}</code>
${request.groupLink ? `🔗 ${esc(request.groupLink)}\n` : ''}${request.resetKeyHint ? `🔑 Key: <code>${esc(request.resetKeyHint)}</code>\n` : ''}${planText}
🕐 ${new Date(request.createdAt).toLocaleString('vi-VN')}

✅ /approve ${request.id}
❌ /reject ${request.id}`;
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
    const text =
`✅ <b>KEY ĐÃ DUYỆT</b>
────────────────
🔑 <code>${result.key}</code>

📦 ${esc(req.planLabel || 'Key free')}
⏱ ${req.durationHours}h · Hết: ${expiresText}
📱 Tối đa <b>3 thiết bị</b>

🌐 Nhập key trên website VIP ORACLE`;
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
      await send(message.chat.id, '⚠️ Gõ /free hoặc /buy trước khi gửi ảnh.');
      return;
    }
    const photos = message.photo || [];
    if (!photos.length) return;
    const caption = String(message.caption || '').trim();
    let groupLink = '';
    if (mode === 'group') {
      const match = caption.match(/(https?:\/\/\S+|t\.me\/\S+|www\.\S+)/i);
      if (!match) {
        await send(message.chat.id, '📷 Gửi lại ảnh + <b>link nhóm</b> trong chú thích.');
        return;
      }
      groupLink = match[0];
    }
    let plan = null;
    if (mode === 'payment') {
      plan = plans().find(p => p.id === session.planId);
      if (!plan) {
        delete sessions[userId]; options.saveSessions(sessions);
        await send(message.chat.id, '⚠️ Gói hết hạn. Gõ /buy chọn lại.');
        return;
      }
    }
    const request = {
      id: idShort(), type: mode === 'payment' ? 'payment' : 'group', status: 'pending',
      telegramId: userId, username: from.username || '', userName: displayName(from),
      groupLink, caption, proofFileId: photos[photos.length - 1].file_id,
      planId: plan?.id || null, planLabel: plan?.label || 'Key free',
      price: Number(plan?.price || 0), durationHours: Number(plan?.durationHours || 5),
      createdAt: Date.now()
    };
    options.addRequest(request);
    delete sessions[userId]; options.saveSessions(sessions);
    await send(message.chat.id, `✅ Đã gửi <b>#${request.id}</b>\n⏳ Chờ admin duyệt.`);
    await notifyAdmins(request, request.proofFileId);
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
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(profileUrl)}`;
    const r = await fetch(oembedUrl, { signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error('Không lấy được info (user ẩn / không tồn tại).');
    const d = await r.json();
    return {
      username,
      title: d.title || d.author_name || username,
      author: d.author_name || username,
      authorUrl: d.author_url || profileUrl,
      thumb: d.thumbnail_url || '',
      profileUrl
    };
  }

  async function lookupFacebook(input) {
    let raw = String(input || '').trim();
    let url = raw;
    if (!/^https?:\/\//i.test(raw)) {
      raw = raw.replace(/^@/, '');
      url = `https://www.facebook.com/${encodeURIComponent(raw)}`;
    }
    // Facebook oEmbed for posts; for profiles use open graph best-effort
    try {
      const oembed = `https://www.facebook.com/plugins/post/oembed.json?url=${encodeURIComponent(url)}`;
      const r = await fetch(oembed, { signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'Mozilla/5.0' } });
      if (r.ok) {
        const d = await r.json();
        return {
          url: d.author_url || url,
          author: d.author_name || 'Facebook',
          html: (d.html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200),
          provider: d.provider_name || 'Facebook'
        };
      }
    } catch {}
    // fallback: just validate URL shape
    return {
      url,
      author: raw.replace(/^https?:\/\/(www\.)?facebook\.com\//i, '').split(/[/?#]/)[0] || 'Facebook',
      html: 'Không lấy được chi tiết công khai (profile private hoặc cần đăng nhập).',
      provider: 'Facebook'
    };
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
      return send(chatId, `⏳ <b>PENDING</b>\n` + lines.join('\n') + `\n\n✅ /approve ID\n❌ /reject ID`);
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

    if (cmd === 'settask') {
      if (!argText) return send(chatId, '📌 <code>/settask &lt;nội dung&gt;</code>');
      const cfg = options.getConfig();
      cfg.groupTaskText = argText.slice(0, 2000);
      if (options.saveConfig) options.saveConfig(cfg);
      return send(chatId, `✅ Nhiệm vụ nhóm:\n${esc(cfg.groupTaskText)}`);
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
      return send(chatId, '⚠️ Gõ /free hoặc /buy trước.');
    }

    if (!text) return;

    // admin commands first
    if (text.startsWith('/') && isAdmin(fromId)) {
      const cmd = text.split(/\s+/)[0].toLowerCase().replace(/^\//, '').split('@')[0];
      const adminCmds = new Set(['admin', 'panel', 'stats', 'keys', 'key', 'createkey', 'resetdevice', 'resetdevices', 'revoke', 'pending', 'approve', 'reject', 'settask', 'setbank', 'settg', 'addplan', 'delplan', 'plans']);
      if (adminCmds.has(cmd)) return handleAdminCommand(message, text);
    }

    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase().replace(/^\//, '').split('@')[0];
    const args = parts.slice(1);
    const argText = text.replace(/^\/\S+\s*/, '').trim();

    if (cmd === 'start') return showStart(chatId, displayName(from));

    if (cmd === 'status') {
      const pending = (options.getRequests ? options.getRequests() : []).filter(r => r.telegramId === fromId && r.status === 'pending');
      if (!pending.length) return send(chatId, '✅ Không có yêu cầu chờ.');
      return send(chatId, `⏳ <b>${pending.length} yêu cầu</b>\n` + pending.map(r => `• #${r.id} ${r.type === 'payment' ? '💳' : r.type === 'reset' ? '🔄' : '🎯'}`).join('\n'));
    }

    if (cmd === 'free') {
      sessions[fromId] = { type: 'group', startedAt: Date.now() };
      options.saveSessions(sessions);
      const task = String(options.getConfig().groupTaskText || 'Làm nhiệm vụ theo yêu cầu admin.');
      return send(chatId,
`🎯 <b>KEY FREE</b>
────────────────
📋 ${esc(task)}

📷 Gửi <b>ảnh</b> + <b>link nhóm</b> trong chú thích
⏳ Admin duyệt → nhận key (3 TB)`);
    }

    if (cmd === 'buy') {
      const available = plans();
      if (!available.length) return send(chatId, '📭 Admin chưa mở bán gói.');
      const lines = available.map((p, i) => `${i + 1}. <b>${esc(p.label)}</b>\n   💰 ${fmt(p.price)}đ · ⏱ ${p.durationHours}h\n   👉 <code>/pay ${p.id}</code>`);
      return send(chatId,
`💎 <b>MUA KEY VIP</b>
────────────────
${lines.join('\n\n')}
📱 Key = 3 thiết bị`);
    }

    if (cmd === 'pay') {
      const planId = (args[0] || '').toLowerCase();
      const plan = plans().find(p => p.id === planId);
      if (!plan) return send(chatId, '❌ Gói không tồn tại. Gõ /buy');
      const config = options.getConfig();
      if (!config.bankCode || !config.bankAccount || !config.bankAccountName) return send(chatId, '⚠️ Admin chưa cấu hình VietQR.');
      const addInfo = `KEYVIP ${fromId}`;
      const qr = `https://img.vietqr.io/image/${encodeURIComponent(config.bankCode)}-${encodeURIComponent(config.bankAccount)}-compact2.jpg?amount=${encodeURIComponent(String(plan.price))}&addInfo=${encodeURIComponent(addInfo)}&accountName=${encodeURIComponent(config.bankAccountName)}`;
      sessions[fromId] = { type: 'payment', planId: plan.id, startedAt: Date.now() };
      options.saveSessions(sessions);
      await sendPhoto(chatId, qr, {
        caption:
`💳 <b>${esc(plan.label)}</b>
💰 ${fmt(plan.price)}đ · ⏱ ${plan.durationHours}h
🏦 ${esc(config.bankCode)} · <code>${esc(config.bankAccount)}</code>
👤 ${esc(config.bankAccountName)}
📝 CK: <code>${addInfo}</code>

📷 Sau CK → gửi <b>ảnh chứng từ</b>`
      });
      return;
    }

    if (cmd === 'resetkey') {
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
      if (!k) return send(chatId, '❌ Key không hợp lệ. Gửi lại hoặc /resetkey');
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

    if (cmd === 'tiktok') {
      if (!argText) return send(chatId, '📌 <code>/tiktok @user</code>\nhoặc <code>/tiktok https://tiktok.com/@user</code>');
      await send(chatId, '⏳ Đang lấy info TikTok...');
      try {
        const info = await lookupTikTok(argText);
        return send(chatId,
`📱 <b>TIKTOK</b>
────────────────
👤 <b>${esc(info.author)}</b>
🆔 @${esc(info.username)}
🔗 ${info.profileUrl}
📝 ${esc((info.title || '').slice(0, 180))}`);
      } catch (e) {
        return send(chatId, `❌ ${e.message}`);
      }
    }

    if (cmd === 'fb' || cmd === 'facebook') {
      if (!argText) return send(chatId, '📌 <code>/fb username</code>\nhoặc <code>/fb https://facebook.com/...</code>');
      await send(chatId, '⏳ Đang lấy info Facebook...');
      try {
        const info = await lookupFacebook(argText);
        return send(chatId,
`📘 <b>FACEBOOK</b>
────────────────
👤 ${esc(info.author)}
🔗 ${esc(info.url)}
📝 ${esc(info.html || '—')}`);
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
        const updates = await tg('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
        for (const update of updates || []) {
          offset = Math.max(offset, Number(update.update_id) + 1);
          try {
            if (update.message) await handleMessage(update.message);
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
`✅ <b>KEY VIP</b>
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
function newPlainKey() { return 'VIP-' + crypto.randomBytes(6).toString('hex').toUpperCase(); }

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
  { id: 'sunwin', label: 'Sunwin', url: 'https://apisunwin-cocalhahaha.onrender.com/api/sunwin', parser: 'sunwin', enabled: true },
  { id: 'lc79_hu', label: 'LC79 · Hũ', url: 'https://wtx.tele68.com/v1/tx/sessions', parser: 'lc79', enabled: true },
  { id: 'lc79_md5', label: 'LC79 · MD5', url: 'https://wtxmd52.tele68.com/v1/txmd5/sessions', parser: 'lc79', enabled: true }
];
let gameConfigs = loadJSON(GAMES_FILE, null);
if (!Array.isArray(gameConfigs)) gameConfigs = DEFAULT_GAMES.map(g => ({ ...g }));
const FEEDS = Object.create(null);
function createFeed(config) {
  return { id: config.id, label: config.label, url: config.url, parser: config.parser || 'lc79', enabled: config.enabled !== false,
    engine: new Engine(), history: [], accuracyHistory: [], lastSession: null, pendingPred: null,
    correct: 0, total: 0, lastLive: null, lastEnsemble: null, _seen: [], lastError: null };
}
function saveGameConfigs() { saveJSON(GAMES_FILE, gameConfigs); }
function initializeFeedConfigs() {
  for (const key of Object.keys(FEEDS)) delete FEEDS[key];
  for (const g of gameConfigs) {
    if (!g || !/^[a-z0-9_-]{2,32}$/i.test(String(g.id || '')) || !validHttpUrl(g.url)) continue;
    g.id = String(g.id); g.label = String(g.label || g.id); g.parser = g.parser === 'sunwin' ? 'sunwin' : 'lc79'; g.enabled = g.enabled !== false;
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
function parseFeedData(feed, data) { return feed.parser === 'sunwin' ? parseSunwin(data) : parseLC79(data); }
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
      f.engine.addResult(item.char, item.sum);
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
    const predicted = ensemble.predictedResult === 'TÀI' ? 'T' : 'X';
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
  groupTaskText: 'Đăng nội dung giới thiệu do admin cung cấp vào nhóm theo yêu cầu của admin.',
  bankCode: '', bankAccount: '', bankAccountName: '', plans: []
};
function normalizeSettings(value) {
  const v = value || {};
  const plans = Array.isArray(v.plans) ? v.plans.map(p => ({
    id: String(p.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24),
    label: String(p.label || '').trim().slice(0, 80),
    price: Math.max(0, Math.floor(Number(p.price || 0))),
    durationHours: Math.max(0, Math.floor(Number(p.durationHours || 0))),
    active: p.active !== false
  })).filter(p => p.id && p.label && p.price > 0 && p.durationHours > 0) : [];
  const ids = new Set();
  for (const plan of plans) { if (ids.has(plan.id)) throw new Error('Mã gói bị trùng: ' + plan.id); ids.add(plan.id); }
  return {
    telegramUsername: String(v.telegramUsername || '').trim().replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 64),
    groupTaskText: String(v.groupTaskText || '').slice(0, 2000),
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
app.get('/api/public/config', (req, res) => res.json({ brand: BRAND, telegramUsername: botSettings.telegramUsername || '', telegramUrl: botSettings.telegramUsername ? `https://t.me/${botSettings.telegramUsername}` : '' }));
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
app.get('/api/games', requireUser, (req, res) => res.json({ games: gameConfigs.filter(g => g.enabled !== false && FEEDS[g.id]).map(({ id, label }) => ({ id, label })) }));
app.get('/api/me', requireUser, (req, res) => res.json({ label: req.userKey.label, expiresAt: req.userKey.expiresAt || null, deviceLimit: req.userKey.deviceLimit || 1 }));
app.get('/api/predict', requireUser, (req, res) => {
  const f = FEEDS[req.query.game];
  if (!f || !f.enabled) return res.status(400).json({ error: 'Game không tồn tại hoặc đang tắt.' });
  const ensemble = f.engine.getEnsemblePrediction();
  res.json({ game: req.query.game, label: f.label, predictedResult: ensemble.predictedResult, confidence: ensemble.confidence,
    taiProb: ensemble.taiProb, xiuProb: ensemble.xiuProb, activeModels: ensemble.activeModels, topReason: ensemble.topReason,
    regime: f.engine.marketState.regime, trend: f.engine.marketState.trend, nextSession: f.lastLive ? (Number.isFinite(Number(f.lastLive.session)) ? Number(f.lastLive.session) + 1 : null) : null,
    live: f.lastLive || null, accuracy: f.total ? { correct: f.correct, total: f.total, pct: +(f.correct / f.total * 100).toFixed(1) } : null,
    feedError: f.lastError || null });
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
  const parser = req.body?.parser === 'sunwin' ? 'sunwin' : 'lc79';
  if (!/^[a-z0-9_-]{2,32}$/.test(id)) return res.status(400).json({ error: 'Mã game chỉ gồm chữ thường, số, _ hoặc - (2–32 ký tự).' });
  if (gameConfigs.some(g => g.id === id)) return res.status(409).json({ error: 'Mã game đã tồn tại.' });
  if (!label) return res.status(400).json({ error: 'Hãy nhập tên game.' });
  if (!validHttpUrl(url)) return res.status(400).json({ error: 'API phải là URL HTTP hoặc HTTPS hợp lệ.' });
  const config = { id, label: label.slice(0, 80), url, parser, enabled: req.body?.enabled !== false };
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
  if (req.body?.parser !== undefined) config.parser = req.body.parser === 'sunwin' ? 'sunwin' : 'lc79';
  if (req.body?.enabled !== undefined) config.enabled = req.body.enabled !== false;
  if (FEEDS[config.id]) { Object.assign(FEEDS[config.id], { label: config.label, url: config.url, parser: config.parser, enabled: config.enabled }); }
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
    const f = FEEDS[gameId]; f.engine = new Engine(); f.history = []; f.accuracyHistory = []; f.lastSession = null;
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

app.listen(PORT, () => {
  logLine(`SERVER listening on port ${PORT}; admin password configured=${!!process.env.ADMIN_PASSWORD}; games=${Object.keys(FEEDS).length}`);
});
