/*
 * Cờ Caro 50x50 — bộ máy AI
 * Thuật toán: đánh giá theo mẫu (pattern), alpha-beta có sắp xếp nước đi,
 * tìm thắng bằng chuỗi "tứ" liên hoàn (VCF) và tìm kiếm sâu dần.
 * Không phụ thuộc DOM, có thể chạy trong Web Worker hoặc Node.js.
 */
(function (root) {
  'use strict';

  const N = 50;
  const NN = N * N;
  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
  const INF = 1e18;
  const WIN = 1e12;

  const S_FIVE = 2.0e9;
  const S_OPEN_FOUR = 3.0e6;
  const S_FOUR = 1.2e5;
  const S_OPEN_THREE = 1.4e4;
  const S_STONE = 2;
  const S_PAIR = 4;

  const OPEN3 = new Set(['001110', '010110', '011010', '011100']);

  // ---------------------------------------------------------------------
  // Bàn cờ tĩnh: 50 hàng + 50 cột + 99 chéo xuôi + 99 chéo ngược = 298
  // đường. Mỗi ô thuộc đúng 4 đường. Nhờ vậy điểm bàn cờ có thể cập nhật
  // tăng dần: chỉ 4 đường đi qua nước vừa đánh thay đổi.
  // ---------------------------------------------------------------------
  const LINES = [];
  const CELL_LINES = Array.from({ length: NN }, () => []);

  function addLine(cells) {
    const id = LINES.length;
    LINES.push(cells);
    for (let i = 0; i < cells.length; i++) CELL_LINES[cells[i]].push(id);
  }

  for (let r = 0; r < N; r++) {
    const cells = [];
    for (let c = 0; c < N; c++) cells.push(r * N + c);
    addLine(cells);
  }
  for (let c = 0; c < N; c++) {
    const cells = [];
    for (let r = 0; r < N; r++) cells.push(r * N + c);
    addLine(cells);
  }
  for (let d = -(N - 1); d <= N - 1; d++) {
    const cells = [];
    const r0 = Math.max(0, d);
    for (let r = r0; r < N && r - d < N; r++) cells.push(r * N + (r - d));
    if (cells.length) addLine(cells);
  }
  for (let s = 0; s <= 2 * N - 2; s++) {
    const cells = [];
    const r0 = Math.max(0, s - (N - 1));
    const r1 = Math.min(N - 1, s);
    for (let r = r0; r <= r1; r++) cells.push(r * N + (s - r));
    if (cells.length) addLine(cells);
  }

  const segCache = new Map();

  function segmentScore(seg) {
    const cached = segCache.get(seg);
    if (cached !== undefined) return cached;

    let score = 0;
    let ones = 0;
    let pairs = 0;
    for (let i = 0; i < seg.length; i++) {
      if (seg.charCodeAt(i) === 49) {
        ones++;
        if (i > 0 && seg.charCodeAt(i - 1) === 49) pairs++;
      }
    }
    if (ones === 0) {
      if (segCache.size < 90000) segCache.set(seg, 0);
      return 0;
    }
    score += ones * S_STONE + pairs * S_PAIR;

    if (seg.indexOf('11111') !== -1) score += S_FIVE;

    // Tứ mở: .XXXX.  (6 ô)
    let at = 0;
    while ((at = seg.indexOf('011110', at)) !== -1) {
      score += S_OPEN_FOUR;
      at++;
    }

    // Mọi cửa sổ 5 ô có 4 quân và 1 ô trống đều tạo ra một mối đe dọa
    // thắng ngay ở ô trống đó (tứ).
    for (let i = 0; i <= seg.length - 5; i++) {
      let o = 0;
      let z = 0;
      for (let j = i; j < i + 5; j++) {
        const c = seg.charCodeAt(j);
        if (c === 49) o++;
        else if (c === 48) z++;
      }
      if (o === 4 && z === 1) score += S_FOUR;
    }

    // Ba mở / ba gãy có thể biến thành tứ mở sau một nước.
    for (let i = 0; i <= seg.length - 6; i++) {
      if (OPEN3.has(seg.substr(i, 6))) score += S_OPEN_THREE;
    }

    if (segCache.size < 90000) segCache.set(seg, score);
    return score;
  }

  function scoreLinePair(cells, board) {
    let a = '';
    let b = '';
    for (let i = 0; i < cells.length; i++) {
      const v = board[cells[i]];
      if (v === 0) {
        a += '0';
        b += '0';
      } else if (v === 1) {
        a += '1';
        b += '2';
      } else {
        a += '2';
        b += '1';
      }
    }
    let sa = 0;
    let sb = 0;
    const partsA = a.split('2');
    for (let i = 0; i < partsA.length; i++) sa += segmentScore(partsA[i]);
    const partsB = b.split('2');
    for (let i = 0; i < partsB.length; i++) sb += segmentScore(partsB[i]);
    return [sa, sb];
  }

  const now = typeof performance !== 'undefined' && performance.now
    ? () => performance.now()
    : () => Date.now();

  const LEVELS = {
    easy: {
      timeLimit: 280, maxDepth: 1, rootBranch: 12, branch: 8,
      vcfDepth: 0, vcfMs: 0, random: 0.18, label: 'Dễ'
    },
    normal: {
      timeLimit: 750, maxDepth: 2, rootBranch: 18, branch: 11,
      vcfDepth: 5, vcfMs: 220, random: 0, label: 'Vừa'
    },
    hard: {
      timeLimit: 1500, maxDepth: 4, rootBranch: 24, branch: 14,
      vcfDepth: 8, vcfMs: 500, random: 0, label: 'Khó'
    },
    super: {
      timeLimit: 2800, maxDepth: 6, rootBranch: 28, branch: 16,
      vcfDepth: 11, vcfMs: 900, random: 0, label: 'Siêu khó'
    }
  };

  class Engine {
    constructor(boardArray, aiPlayer, options) {
      this.board = new Uint8Array(NN);
      if (boardArray) {
        for (let i = 0; i < NN; i++) this.board[i] = boardArray[i] ? boardArray[i] : 0;
      }
      this.aiPlayer = aiPlayer === 2 ? 2 : 1;
      this.humanPlayer = 3 - this.aiPlayer;
      this.level = (options && options.level) || 'super';
      this.cfg = Object.assign({}, LEVELS[this.level] || LEVELS.super, options || {});
      this.start = now();
      this.deadline = this.start + this.cfg.timeLimit;
      this.timedOut = false;
      this.vcfTimedOut = false;
      this.nodes = 0;
      this.stack = [];
      this.near = new Uint8Array(NN);
      this.total = [0, 0, 0];
      this.lineScores = new Array(LINES.length);
      this.stoneCount = 0;
      this.bestRoot = -1;
      this.bestScore = -INF;

      for (let i = 0; i < NN; i++) {
        if (this.board[i]) {
          this.stoneCount++;
          this.bumpNear(i, 1);
        }
      }

      for (let l = 0; l < LINES.length; l++) {
        const sc = scoreLinePair(LINES[l], this.board);
        this.lineScores[l] = sc;
        this.total[1] += sc[0];
        this.total[2] += sc[1];
      }
    }

    bumpNear(idx, delta) {
      const r = (idx / N) | 0;
      const c = idx % N;
      const r0 = Math.max(0, r - 2);
      const r1 = Math.min(N - 1, r + 2);
      const c0 = Math.max(0, c - 2);
      const c1 = Math.min(N - 1, c + 2);
      for (let rr = r0; rr <= r1; rr++) {
        const base = rr * N;
        for (let cc = c0; cc <= c1; cc++) {
          this.near[base + cc] += delta;
        }
      }
    }

    doMove(idx, player) {
      const lids = CELL_LINES[idx];
      const old = new Array(4);
      const neu = new Array(4);
      for (let i = 0; i < 4; i++) old[i] = this.lineScores[lids[i]];
      this.board[idx] = player;
      for (let i = 0; i < 4; i++) {
        const lid = lids[i];
        const sc = scoreLinePair(LINES[lid], this.board);
        neu[i] = sc;
        this.total[1] += sc[0] - old[i][0];
        this.total[2] += sc[1] - old[i][1];
        this.lineScores[lid] = sc;
      }
      this.bumpNear(idx, 1);
      this.stoneCount++;
      this.stack.push({ idx, player, lids, old, neu });
      return this;
    }

    undoMove() {
      const m = this.stack.pop();
      if (!m) return this;
      this.board[m.idx] = 0;
      this.bumpNear(m.idx, -1);
      this.stoneCount--;
      for (let i = 0; i < 4; i++) {
        const lid = m.lids[i];
        this.total[1] -= m.neu[i][0] - m.old[i][0];
        this.total[2] -= m.neu[i][1] - m.old[i][1];
        this.lineScores[lid] = m.old[i];
      }
      return this;
    }

    isWinningMove(idx, player) {
      if (this.board[idx] !== 0) return false;
      const r = (idx / N) | 0;
      const c = idx % N;
      for (let d = 0; d < 4; d++) {
        const dr = DIRS[d][0];
        const dc = DIRS[d][1];
        let count = 1;
        let rr = r + dr;
        let cc = c + dc;
        while (rr >= 0 && rr < N && cc >= 0 && cc < N && this.board[rr * N + cc] === player) {
          count++;
          rr += dr;
          cc += dc;
        }
        rr = r - dr;
        cc = c - dc;
        while (rr >= 0 && rr < N && cc >= 0 && cc < N && this.board[rr * N + cc] === player) {
          count++;
          rr -= dr;
          cc -= dc;
        }
        if (count >= 5) return true;
      }
      return false;
    }

    winningLine(idx, player) {
      if (this.board[idx] !== player) return [];
      const r = (idx / N) | 0;
      const c = idx % N;
      for (let d = 0; d < 4; d++) {
        const dr = DIRS[d][0];
        const dc = DIRS[d][1];
        const cells = [idx];
        let rr = r + dr;
        let cc = c + dc;
        while (rr >= 0 && rr < N && cc >= 0 && cc < N && this.board[rr * N + cc] === player) {
          cells.push(rr * N + cc);
          rr += dr;
          cc += dc;
        }
        rr = r - dr;
        cc = c - dc;
        while (rr >= 0 && rr < N && cc >= 0 && cc < N && this.board[rr * N + cc] === player) {
          cells.unshift(rr * N + cc);
          rr -= dr;
          cc -= dc;
        }
        if (cells.length >= 5) return cells;
      }
      return [];
    }

    findWinningCell(player) {
      for (let i = 0; i < NN; i++) {
        if (this.board[i] === 0 && this.near[i] > 0 && this.isWinningMove(i, player)) return i;
      }
      return -1;
    }

    findWinningCells(player) {
      const out = [];
      for (let i = 0; i < NN; i++) {
        if (this.board[i] === 0 && this.near[i] > 0 && this.isWinningMove(i, player)) out.push(i);
      }
      return out;
    }

    /*
     * Phân tích một nước đặt quân (giả lập) trong phạm vi 4 ô mỗi hướng.
     * Trả về số ô thắng ngay được tạo ra, tứ mở và ba mở.
     */
    analyzeAt(idx, player) {
      this.board[idx] = player;
      const r = (idx / N) | 0;
      const c = idx % N;
      const winCells = new Set();
      let win = false;
      let openFour = 0;
      let openThree = 0;

      for (let d = 0; d < 4; d++) {
        const dr = DIRS[d][0];
        const dc = DIRS[d][1];
        const vals = new Array(9);
        const ids = new Array(9);
        for (let k = -4; k <= 4; k++) {
          const rr = r + dr * k;
          const cc = c + dc * k;
          const p = k + 4;
          if (rr < 0 || rr >= N || cc < 0 || cc >= N) {
            vals[p] = 9;
            ids[p] = -1;
          } else {
            const id = rr * N + cc;
            vals[p] = this.board[id];
            ids[p] = id;
          }
        }

        // 5 cửa sổ chứa ô trung tâm.
        for (let s = 0; s <= 4; s++) {
          let own = 0;
          let empty = 0;
          let bad = 0;
          let emptyId = -1;
          for (let j = s; j < s + 5; j++) {
            const v = vals[j];
            if (v === player) own++;
            else if (v === 0) {
              empty++;
              emptyId = ids[j];
            } else bad++;
          }
          if (bad === 0) {
            if (own === 5) win = true;
            else if (own === 4 && empty === 1 && emptyId >= 0) winCells.add(emptyId);
          }
        }

        // 6 cửa sổ để nhận diện tứ mở và ba mở.
        for (let s = 0; s <= 3; s++) {
          let bad = false;
          let str = '';
          for (let j = s; j < s + 6; j++) {
            const v = vals[j];
            if (v === 9) {
              bad = true;
              break;
            }
            if (v !== 0 && v !== player) {
              bad = true;
              break;
            }
            str += v === player ? '1' : '0';
          }
          if (bad) continue;
          if (str === '011110') openFour++;
          else if (OPEN3.has(str)) openThree++;
        }
      }

      this.board[idx] = 0;
      return { win, winCells: Array.from(winCells), openFour, openThree };
    }

    orderScore(idx, own, opp) {
      if (own.win) return 1e17;
      let s = 0;
      const nOwnWins = own.winCells.length;
      const nOppWins = opp.winCells.length;

      if (opp.win) s += 5e13;
      if (nOwnWins >= 2) s += 2.0e12;
      else if (nOwnWins === 1) s += 4.0e8;
      s += own.openFour * 5.0e11;

      if (nOppWins >= 2) s += 2.0e11;
      else if (nOppWins === 1) s += 8.0e9;

      s += own.openThree * 6.0e6;
      s += opp.openThree * 4.5e6;
      if (own.openThree >= 2) s += 9.0e9;
      if (opp.openThree >= 2) s += 7.0e9;

      const r = (idx / N) | 0;
      const c = idx % N;
      const cd = Math.max(Math.abs(r - 25), Math.abs(c - 25));
      s += (25 - cd) * 2;

      let adj = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < N && cc >= 0 && cc < N && this.board[rr * N + cc]) adj++;
        }
      }
      s += adj * 16;
      return s;
    }

    rankMoves(player, limit) {
      const opp = 3 - player;
      const moves = [];
      if (this.timedOut) return moves;
      let checked = 0;
      for (let i = 0; i < NN; i++) {
        if (this.board[i] !== 0 || this.near[i] === 0) continue;
        if (this.isWinningMove(i, player)) {
          return [{ idx: i, score: 1e17, immediate: true }];
        }
        const own = this.analyzeAt(i, player);
        const def = this.analyzeAt(i, opp);
        moves.push({ idx: i, score: this.orderScore(i, own, def) });
        checked++;
        if ((checked & 127) === 0 && now() > this.deadline) {
          this.timedOut = true;
          return moves;
        }
      }
      moves.sort((a, b) => b.score - a.score);
      if (moves.length > limit) moves.length = limit;
      return moves;
    }

    evaluate(player) {
      const opp = 3 - player;
      return this.total[player] - this.total[opp] * 1.12;
    }

    branchLimit(ply) {
      const base = this.cfg.branch;
      if (ply <= 1) return base;
      if (ply === 2) return Math.max(8, base - 2);
      if (ply === 3) return Math.max(7, base - 4);
      return Math.max(5, base - 6);
    }

    negamax(depth, player, alpha, beta, ply) {
      if (this.timedOut) return 0;
      if ((++this.nodes & 511) === 0 && now() > this.deadline) {
        this.timedOut = true;
        return 0;
      }
      if (depth <= 0) return this.evaluate(player);

      const moves = this.rankMoves(player, this.branchLimit(ply));
      if (!moves.length) return this.evaluate(player);
      let best = -INF;

      for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        if (m.immediate) return WIN - ply;
        if (this.isWinningMove(m.idx, player)) return WIN - ply;
        this.doMove(m.idx, player);
        const val = -this.negamax(depth - 1, 3 - player, -beta, -alpha, ply + 1);
        this.undoMove();
        if (this.timedOut) return 0;
        if (val > best) best = val;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    }

    searchRoot(rootMoves, depth) {
      let alpha = -INF;
      let bestMove = null;
      let bestScore = -INF;
      const ai = this.aiPlayer;
      for (let i = 0; i < rootMoves.length; i++) {
        if (this.timedOut) break;
        const idx = rootMoves[i].idx;
        if (this.isWinningMove(idx, ai)) {
          return { move: idx, score: WIN, completed: true };
        }
        this.doMove(idx, ai);
        const val = -this.negamax(depth - 1, this.humanPlayer, -INF, -alpha, 1);
        this.undoMove();
        if (this.timedOut) break;
        if (val > bestScore) {
          bestScore = val;
          bestMove = idx;
        }
        if (val > alpha) alpha = val;
      }
      return { move: bestMove, score: bestScore, completed: !this.timedOut };
    }

    vcfSearch(depth, deadline) {
      if (this.vcfTimedOut || depth <= 0 || now() > deadline) {
        this.vcfTimedOut = true;
        return null;
      }
      const ai = this.aiPlayer;
      const human = this.humanPlayer;

      const immediate = this.findWinningCell(ai);
      if (immediate >= 0) return [immediate];
      if (this.findWinningCell(human) >= 0) return null;

      const forcing = [];
      for (let i = 0; i < NN; i++) {
        if (this.board[i] !== 0 || this.near[i] === 0) continue;
        const info = this.analyzeAt(i, ai);
        if (info.win || info.winCells.length > 0) {
          forcing.push({
            idx: i,
            score: info.winCells.length * 100000 + info.openThree * 50 + info.openFour * 500
          });
        }
        if ((i & 255) === 0 && now() > deadline) {
          this.vcfTimedOut = true;
          return null;
        }
      }

      forcing.sort((a, b) => b.score - a.score);
      const limit = Math.min(forcing.length, 16);

      for (let k = 0; k < limit; k++) {
        if (now() > deadline) {
          this.vcfTimedOut = true;
          return null;
        }
        const m = forcing[k];
        const info = this.analyzeAt(m.idx, ai);
        if (info.win) {
          this.doMove(m.idx, ai);
          this.undoMove();
          return [m.idx];
        }
        if (info.winCells.length === 0) continue;

        this.doMove(m.idx, ai);

        if (info.winCells.length >= 2) {
          this.undoMove();
          return [m.idx];
        }

        const block = info.winCells[0];
        if (this.board[block] !== 0) {
          this.undoMove();
          continue;
        }
        this.doMove(block, human);
        if (this.isWinningMove(block, human)) {
          this.undoMove();
          this.undoMove();
          continue;
        }
        const rest = this.vcfSearch(depth - 1, deadline);
        this.undoMove();
        this.undoMove();
        if (rest) return [m.idx].concat(rest);
        if (this.vcfTimedOut) return null;
      }
      return null;
    }

    chooseMove() {
      const ai = this.aiPlayer;
      const human = this.humanPlayer;
      const stats = {
        level: this.level,
        source: 'search',
        depth: 0,
        nodes: 0,
        elapsed: 0,
        vcf: []
      };

      if (this.stoneCount === 0) {
        stats.source = 'opening';
        stats.elapsed = Math.round(now() - this.start);
        return { row: 25, col: 25, idx: 25 * N + 25, stats };
      }

      // Khai cuộc nhỏ: phản hồi tức thì ở nước đầu, vẫn giữ thế cân bằng.
      if (this.stoneCount === 1) {
        let opening = 25 * N + 25;
        if (this.board[opening] !== 0) {
          opening = 24 * N + 24;
        }
        if (this.board[opening] === 0) {
          stats.source = 'opening';
          stats.elapsed = Math.round(now() - this.start);
          return { row: (opening / N) | 0, col: opening % N, idx: opening, stats };
        }
      }

      // 1) Thắng ngay.
      let move = this.findWinningCell(ai);
      if (move >= 0) {
        stats.source = 'win';
        stats.elapsed = Math.round(now() - this.start);
        return { row: (move / N) | 0, col: move % N, idx: move, stats };
      }

      // 2) Chặn đối thủ thắng ngay.
      const blocks = this.findWinningCells(human);
      if (blocks.length > 0) {
        let block = blocks[0];
        if (blocks.length > 1) {
          // Đã thua chắc; chọn ô chặn "có lợi" nhất để ván cờ vẫn tự nhiên.
          let bestScore = -INF;
          for (let i = 0; i < blocks.length; i++) {
            const idx = blocks[i];
            const own = this.analyzeAt(idx, ai);
            const def = this.analyzeAt(idx, human);
            const sc = this.orderScore(idx, own, def);
            if (sc > bestScore) {
              bestScore = sc;
              block = idx;
            }
          }
        }
        stats.source = 'block';
        stats.elapsed = Math.round(now() - this.start);
        return { row: (block / N) | 0, col: block % N, idx: block, stats };
      }

      // 3) Chuỗi tứ liên hoàn (VCF): tấn công cưỡng bức nhiều nước.
      if (this.cfg.vcfDepth > 0 && this.cfg.vcfMs > 0) {
        const vcfDeadline = Math.min(this.deadline, this.start + this.cfg.vcfMs);
        const seq = this.vcfSearch(this.cfg.vcfDepth, vcfDeadline);
        if (seq && seq.length) {
          const idx = seq[0];
          stats.source = 'vcf';
          stats.vcf = seq.map((x) => ({ row: (x / N) | 0, col: x % N }));
          stats.elapsed = Math.round(now() - this.start);
          return { row: (idx / N) | 0, col: idx % N, idx, stats };
        }
      }

      // 4) Tìm kiếm alpha-beta sâu dần.
      const rootMoves = this.rankMoves(ai, this.cfg.rootBranch);
      if (!rootMoves.length) {
        // Dự phòng hiếm gặp.
        for (let i = 0; i < NN; i++) {
          if (this.board[i] === 0) {
            stats.source = 'fallback';
            stats.elapsed = Math.round(now() - this.start);
            return { row: (i / N) | 0, col: i % N, idx: i, stats };
          }
        }
        return null;
      }

      let bestMove = rootMoves[0].idx;
      let bestScore = -INF;
      let reachedDepth = 0;
      const maxDepth = this.cfg.maxDepth;

      for (let depth = 2; depth <= maxDepth; depth += 2) {
        if (now() >= this.deadline) break;
        const result = this.searchRoot(rootMoves, depth);
        if (this.timedOut) break;
        if (result && result.move !== null) {
          bestMove = result.move;
          bestScore = result.score;
          reachedDepth = depth;
          if (bestScore > WIN / 2) break;
        }
        // Nếu thời gian còn quá ít cho vòng tiếp theo thì dừng.
        if (this.deadline - now() < 120) break;
      }

      // Nước "nhiễu" rất nhỏ cho chế độ Dễ, tránh lặp lại y hệt.
      if (this.cfg.random && rootMoves.length > 1 && Math.random() < this.cfg.random) {
        const pool = rootMoves.slice(0, Math.min(5, rootMoves.length));
        bestMove = pool[(Math.random() * pool.length) | 0].idx;
        stats.source = 'easy-random';
      }

      stats.depth = reachedDepth;
      stats.nodes = this.nodes;
      stats.elapsed = Math.round(now() - this.start);
      stats.score = Math.round(bestScore);
      return { row: (bestMove / N) | 0, col: bestMove % N, idx: bestMove, stats };
    }
  }

  function chooseMove(boardArray, aiPlayer, options) {
    const engine = new Engine(boardArray, aiPlayer, options);
    const result = engine.chooseMove();
    if (result) {
      result.stats.nodes = engine.nodes;
      result.stats.elapsed = Math.round(now() - engine.start);
      if (!result.stats.depth) result.stats.depth = 0;
    }
    return result;
  }

  const API = {
    N,
    NN,
    LEVELS,
    Engine,
    chooseMove,
    isWinningMove(boardArray, idx, player) {
      const e = new Engine(boardArray, player, { timeLimit: 1, maxDepth: 1, vcfDepth: 0, vcfMs: 0 });
      return e.isWinningMove(idx, player);
    },
    getWinningLine(boardArray, idx, player) {
      const e = new Engine(boardArray, player, { timeLimit: 1, maxDepth: 1, vcfDepth: 0, vcfMs: 0 });
      return e.winningLine(idx, player);
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.GomokuAI = API;
})(typeof self !== 'undefined' ? self : globalThis);
