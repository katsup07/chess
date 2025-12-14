/*
How it works (high level)
- `ChessEngine` owns the rules + state (board, turn, castling, en passant, clocks, repetition).
- The UI controller renders the board and calls `engine.generateLegalMoves()` for interactions.
- Moves are applied via `engine.makeMove()` and reverted via `engine.unmakeMove()` to support undo/redo and AI search.
Manual test checklist:
- Pinned piece cannot move exposing king.
- Castling blocked if king passes through check.
- En passant only immediately after double pawn move.
- Promotion offers Q/R/B/N and updates move list.
- Checkmate/stalemate/50-move/3-fold/insufficient material are detected.
- FEN export/import round-trips positions + rights.
*/

(() => {
  "use strict";

  const FILES = "abcdefgh";
  const RANKS = "87654321";

  const PIECE_VALUES = {
    p: 100,
    n: 320,
    b: 330,
    r: 500,
    q: 900,
    k: 0,
  };

  const PST = (() => {
    const zero = new Array(64).fill(0);
    const pawn = [
      0, 0, 0, 0, 0, 0, 0, 0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
      5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0,
      5, -5, -10, 0, 0, -10, -5, 5,
      5, 10, 10, -20, -20, 10, 10, 5,
      0, 0, 0, 0, 0, 0, 0, 0,
    ];
    const knight = [
      -50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20, 0, 0, 0, 0, -20, -40,
      -30, 0, 10, 15, 15, 10, 0, -30,
      -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30,
      -30, 5, 10, 15, 15, 10, 5, -30,
      -40, -20, 0, 5, 5, 0, -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50,
    ];
    const bishop = [
      -20, -10, -10, -10, -10, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 10, 10, 5, 0, -10,
      -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10,
      -10, 10, 10, 10, 10, 10, 10, -10,
      -10, 5, 0, 0, 0, 0, 5, -10,
      -20, -10, -10, -10, -10, -10, -10, -20,
    ];
    const rook = [
      0, 0, 0, 0, 0, 0, 0, 0,
      5, 10, 10, 10, 10, 10, 10, 5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      0, 0, 0, 5, 5, 0, 0, 0,
    ];
    const queen = [
      -20, -10, -10, -5, -5, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 5, 5, 5, 0, -10,
      -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5,
      -10, 5, 5, 5, 5, 5, 0, -10,
      -10, 0, 5, 0, 0, 0, 0, -10,
      -20, -10, -10, -5, -5, -10, -10, -20,
    ];
    const kingMid = [
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -10, -20, -20, -20, -20, -20, -20, -10,
      20, 20, 0, 0, 0, 0, 20, 20,
      20, 30, 10, 0, 0, 10, 30, 20,
    ];
    return { pawn, knight, bishop, rook, queen, kingMid, zero };
  })();

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function fileOf(index) {
    return index & 7;
  }

  function rankOf(index) {
    return index >> 3;
  }

  function indexToSquare(index) {
    return `${FILES[fileOf(index)]}${RANKS[rankOf(index)]}`;
  }

  function squareToIndex(square) {
    if (!square || square.length < 2) return null;
    const file = FILES.indexOf(square[0]);
    const rank = RANKS.indexOf(square[1]);
    if (file < 0 || rank < 0) return null;
    return rank * 8 + file;
  }

  function isUpper(piece) {
    return piece && piece === piece.toUpperCase();
  }

  function colorOf(piece) {
    if (!piece) return null;
    return isUpper(piece) ? "w" : "b";
  }

  function opponent(color) {
    return color === "w" ? "b" : "w";
  }

  function mulberry32(seed) {
    let t = seed >>> 0;
    return () => {
      t += 0x6d2b79f5;
      let x = t;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randU32(rng) {
    return (rng() * 0x100000000) >>> 0;
  }

  function randU64(rng) {
    const hi = BigInt(randU32(rng));
    const lo = BigInt(randU32(rng));
    return (hi << 32n) ^ lo;
  }

  function pieceIndex(piece) {
    const t = piece.toLowerCase();
    const base = piece === piece.toUpperCase() ? 0 : 6;
    switch (t) {
      case "p":
        return base + 0;
      case "n":
        return base + 1;
      case "b":
        return base + 2;
      case "r":
        return base + 3;
      case "q":
        return base + 4;
      case "k":
        return base + 5;
      default:
        return null;
    }
  }

  function castleMaskFromRights(rights) {
    return (rights.K ? 1 : 0) | (rights.Q ? 2 : 0) | (rights.k ? 4 : 0) | (rights.q ? 8 : 0);
  }

  class ChessEngine {
    static ZOBRIST = (() => {
      const rng = mulberry32(0xC0FFEE);
      const piece = Array.from({ length: 12 }, () => Array.from({ length: 64 }, () => randU64(rng)));
      const side = randU64(rng);
      const castle = Array.from({ length: 16 }, () => randU64(rng));
      const epFile = Array.from({ length: 8 }, () => randU64(rng));
      return { piece, side, castle, epFile };
    })();

    static START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    constructor() {
      this.board = new Array(64).fill(null);
      this.turn = "w";
      this.castling = { K: true, Q: true, k: true, q: true };
      this.ep = null;
      this.halfmove = 0;
      this.fullmove = 1;
      this.wKing = 60;
      this.bKing = 4;
      this.hash = 0n;
      this.rep = new Map();
      this.hashLine = [];
      this.loadFEN(ChessEngine.START_FEN);
    }

    reset() {
      this.loadFEN(ChessEngine.START_FEN);
    }

    _computeHash() {
      let h = 0n;
      for (let i = 0; i < 64; i++) {
        const p = this.board[i];
        if (!p) continue;
        const idx = pieceIndex(p);
        h ^= ChessEngine.ZOBRIST.piece[idx][i];
      }
      if (this.turn === "b") h ^= ChessEngine.ZOBRIST.side;
      h ^= ChessEngine.ZOBRIST.castle[castleMaskFromRights(this.castling)];
      if (this.ep !== null) h ^= ChessEngine.ZOBRIST.epFile[fileOf(this.ep)];
      return h;
    }

    _setRepetitionFromLine() {
      this.rep.clear();
      for (const h of this.hashLine) {
        const key = h.toString();
        this.rep.set(key, (this.rep.get(key) || 0) + 1);
      }
    }

    toFEN() {
      let placement = "";
      for (let r = 0; r < 8; r++) {
        let empty = 0;
        for (let f = 0; f < 8; f++) {
          const p = this.board[r * 8 + f];
          if (!p) empty++;
          else {
            if (empty) placement += String(empty);
            empty = 0;
            placement += p;
          }
        }
        if (empty) placement += String(empty);
        if (r !== 7) placement += "/";
      }
      const castling = (() => {
        let s = "";
        if (this.castling.K) s += "K";
        if (this.castling.Q) s += "Q";
        if (this.castling.k) s += "k";
        if (this.castling.q) s += "q";
        return s || "-";
      })();
      const ep = this.ep === null ? "-" : indexToSquare(this.ep);
      return `${placement} ${this.turn} ${castling} ${ep} ${this.halfmove} ${this.fullmove}`;
    }

    loadFEN(fen) {
      const parts = String(fen || "").trim().split(/\s+/);
      if (parts.length < 4) throw new Error("Invalid FEN (expected at least 4 fields).");
      const [placement, turn, castling, ep, halfmove, fullmove] = parts;

      const rows = placement.split("/");
      if (rows.length !== 8) throw new Error("Invalid FEN (piece placement).");
      this.board.fill(null);
      let wKing = null;
      let bKing = null;
      for (let r = 0; r < 8; r++) {
        let file = 0;
        for (const ch of rows[r]) {
          if (file > 7) throw new Error("Invalid FEN (row overflow).");
          if (/[1-8]/.test(ch)) {
            file += Number(ch);
            continue;
          }
          if (!/[prnbqkPRNBQK]/.test(ch)) throw new Error(`Invalid FEN (bad piece: ${ch}).`);
          const idx = r * 8 + file;
          this.board[idx] = ch;
          if (ch === "K") wKing = idx;
          if (ch === "k") bKing = idx;
          file++;
        }
        if (file !== 8) throw new Error("Invalid FEN (row length).");
      }
      if (wKing === null || bKing === null) throw new Error("Invalid FEN (missing king).");

      if (turn !== "w" && turn !== "b") throw new Error("Invalid FEN (turn).");
      this.turn = turn;

      this.castling = { K: false, Q: false, k: false, q: false };
      if (castling !== "-") {
        for (const c of castling) {
          if (!Object.prototype.hasOwnProperty.call(this.castling, c)) throw new Error("Invalid FEN (castling).");
          this.castling[c] = true;
        }
      }

      if (ep === "-") this.ep = null;
      else {
        const epIdx = squareToIndex(ep);
        if (epIdx === null) throw new Error("Invalid FEN (en passant).");
        this.ep = epIdx;
      }

      this.halfmove = halfmove !== undefined ? Number(halfmove) : 0;
      this.fullmove = fullmove !== undefined ? Number(fullmove) : 1;
      if (!Number.isFinite(this.halfmove) || this.halfmove < 0) this.halfmove = 0;
      if (!Number.isFinite(this.fullmove) || this.fullmove < 1) this.fullmove = 1;

      this.wKing = wKing;
      this.bKing = bKing;

      this.hash = this._computeHash();
      this.hashLine = [this.hash];
      this._setRepetitionFromLine();
    }

    inCheck(color) {
      const kingSq = color === "w" ? this.wKing : this.bKing;
      return this.isSquareAttacked(kingSq, opponent(color));
    }

    isSquareAttacked(square, byColor) {
      const byWhite = byColor === "w";

      const pawnAttack = byWhite ? [7, 9] : [-9, -7];
      for (const d of pawnAttack) {
        const from = square + d;
        if (from < 0 || from >= 64) continue;
        if (Math.abs(fileOf(square) - fileOf(from)) !== 1) continue;
        const p = this.board[from];
        if (!p) continue;
        if (byWhite && p === "P") return true;
        if (!byWhite && p === "p") return true;
      }

      const knightD = [-17, -15, -10, -6, 6, 10, 15, 17];
      for (const d of knightD) {
        const from = square + d;
        if (from < 0 || from >= 64) continue;
        const df = Math.abs(fileOf(square) - fileOf(from));
        const dr = Math.abs(rankOf(square) - rankOf(from));
        if (!((df === 1 && dr === 2) || (df === 2 && dr === 1))) continue;
        const p = this.board[from];
        if (!p) continue;
        if (byWhite && p === "N") return true;
        if (!byWhite && p === "n") return true;
      }

      const kingD = [-9, -8, -7, -1, 1, 7, 8, 9];
      for (const d of kingD) {
        const from = square + d;
        if (from < 0 || from >= 64) continue;
        const df = Math.abs(fileOf(square) - fileOf(from));
        const dr = Math.abs(rankOf(square) - rankOf(from));
        if (df > 1 || dr > 1) continue;
        const p = this.board[from];
        if (!p) continue;
        if (byWhite && p === "K") return true;
        if (!byWhite && p === "k") return true;
      }

      const rookDirs = [-8, 8, -1, 1];
      const bishopDirs = [-9, -7, 7, 9];

      const scan = (dirs, rookLike) => {
        for (const d of dirs) {
          let cur = square + d;
          while (cur >= 0 && cur < 64) {
            const df = Math.abs(fileOf(cur) - fileOf(cur - d));
            if ((d === -1 || d === 1) && df !== 1) break;
            if ((d === -9 || d === 7 || d === -7 || d === 9) && df !== 1) break;
            const p = this.board[cur];
            if (p) {
              const t = p.toLowerCase();
              const c = colorOf(p);
              if (c === byColor) {
                if (rookLike && (t === "r" || t === "q")) return true;
                if (!rookLike && (t === "b" || t === "q")) return true;
              }
              break;
            }
            cur += d;
          }
        }
        return false;
      };

      if (scan(rookDirs, true)) return true;
      if (scan(bishopDirs, false)) return true;
      return false;
    }

    generatePseudoMoves(color) {
      const moves = [];
      const forward = color === "w" ? -8 : 8;
      const startRank = color === "w" ? 6 : 1;
      const promoRank = color === "w" ? 0 : 7;
      const enemyColor = opponent(color);

      const push = (m) => moves.push(m);

      for (let from = 0; from < 64; from++) {
        const piece = this.board[from];
        if (!piece || colorOf(piece) !== color) continue;
        const t = piece.toLowerCase();

        if (t === "p") {
          const r = rankOf(from);
          const one = from + forward;
          if (one >= 0 && one < 64 && !this.board[one]) {
            if (rankOf(one) === promoRank) {
              for (const promo of ["q", "r", "b", "n"]) {
                push({ from, to: one, piece, captured: null, promotion: promo, isCastle: false, isEnPassant: false });
              }
            } else {
              push({ from, to: one, piece, captured: null, promotion: null, isCastle: false, isEnPassant: false });
              const two = one + forward;
              if (r === startRank && !this.board[two]) {
                push({ from, to: two, piece, captured: null, promotion: null, isCastle: false, isEnPassant: false, isDoublePawn: true });
              }
            }
          }

          const capDirs = color === "w" ? [-9, -7] : [7, 9];
          for (const d of capDirs) {
            const to = from + d;
            if (to < 0 || to >= 64) continue;
            if (Math.abs(fileOf(from) - fileOf(to)) !== 1) continue;
            const target = this.board[to];
            if (target && colorOf(target) === enemyColor) {
              if (rankOf(to) === promoRank) {
                for (const promo of ["q", "r", "b", "n"]) {
                  push({ from, to, piece, captured: target, promotion: promo, isCastle: false, isEnPassant: false });
                }
              } else {
                push({ from, to, piece, captured: target, promotion: null, isCastle: false, isEnPassant: false });
              }
            } else if (this.ep !== null && to === this.ep) {
              const capSq = to - forward;
              const capPiece = this.board[capSq];
              if (capPiece && capPiece.toLowerCase() === "p" && colorOf(capPiece) === enemyColor) {
                push({ from, to, piece, captured: capPiece, capturedIndex: capSq, promotion: null, isCastle: false, isEnPassant: true });
              }
            }
          }
          continue;
        }

        if (t === "n") {
          const deltas = [-17, -15, -10, -6, 6, 10, 15, 17];
          for (const d of deltas) {
            const to = from + d;
            if (to < 0 || to >= 64) continue;
            const df = Math.abs(fileOf(from) - fileOf(to));
            const dr = Math.abs(rankOf(from) - rankOf(to));
            if (!((df === 1 && dr === 2) || (df === 2 && dr === 1))) continue;
            const target = this.board[to];
            if (!target || colorOf(target) === enemyColor) push({ from, to, piece, captured: target || null, promotion: null, isCastle: false, isEnPassant: false });
          }
          continue;
        }

        if (t === "b" || t === "r" || t === "q") {
          const dirs =
            t === "b"
              ? [-9, -7, 7, 9]
              : t === "r"
                ? [-8, 8, -1, 1]
                : [-9, -7, 7, 9, -8, 8, -1, 1];
          for (const d of dirs) {
            let to = from + d;
            while (to >= 0 && to < 64) {
              const df = Math.abs(fileOf(to) - fileOf(to - d));
              if ((d === -1 || d === 1) && df !== 1) break;
              if ((d === -9 || d === 7 || d === -7 || d === 9) && df !== 1) break;
              const target = this.board[to];
              if (!target) push({ from, to, piece, captured: null, promotion: null, isCastle: false, isEnPassant: false });
              else {
                if (colorOf(target) === enemyColor) push({ from, to, piece, captured: target, promotion: null, isCastle: false, isEnPassant: false });
                break;
              }
              to += d;
            }
          }
          continue;
        }

        if (t === "k") {
          const deltas = [-9, -8, -7, -1, 1, 7, 8, 9];
          for (const d of deltas) {
            const to = from + d;
            if (to < 0 || to >= 64) continue;
            const df = Math.abs(fileOf(from) - fileOf(to));
            const dr = Math.abs(rankOf(from) - rankOf(to));
            if (df > 1 || dr > 1) continue;
            const target = this.board[to];
            if (!target || colorOf(target) === enemyColor) push({ from, to, piece, captured: target || null, promotion: null, isCastle: false, isEnPassant: false });
          }

          const canCastle = (side) => {
            if (color === "w" && from !== 60) return false;
            if (color === "b" && from !== 4) return false;
            if (this.inCheck(color)) return false;
            const kSide = side === "K";
            if (color === "w") {
              if (kSide && !this.castling.K) return false;
              if (!kSide && !this.castling.Q) return false;
              if (kSide) {
                if (this.board[61] || this.board[62]) return false;
                if (this.board[63] !== "R") return false;
                if (this.isSquareAttacked(61, enemyColor) || this.isSquareAttacked(62, enemyColor)) return false;
                return true;
              }
              if (this.board[59] || this.board[58] || this.board[57]) return false;
              if (this.board[56] !== "R") return false;
              if (this.isSquareAttacked(59, enemyColor) || this.isSquareAttacked(58, enemyColor)) return false;
              return true;
            }
            if (kSide && !this.castling.k) return false;
            if (!kSide && !this.castling.q) return false;
            if (kSide) {
              if (this.board[5] || this.board[6]) return false;
              if (this.board[7] !== "r") return false;
              if (this.isSquareAttacked(5, enemyColor) || this.isSquareAttacked(6, enemyColor)) return false;
              return true;
            }
            if (this.board[3] || this.board[2] || this.board[1]) return false;
            if (this.board[0] !== "r") return false;
            if (this.isSquareAttacked(3, enemyColor) || this.isSquareAttacked(2, enemyColor)) return false;
            return true;
          };

          if (canCastle("K")) push({ from, to: color === "w" ? 62 : 6, piece, captured: null, promotion: null, isCastle: true, castleSide: "K", isEnPassant: false });
          if (canCastle("Q")) push({ from, to: color === "w" ? 58 : 2, piece, captured: null, promotion: null, isCastle: true, castleSide: "Q", isEnPassant: false });
          continue;
        }
      }

      return moves;
    }

    generateLegalMoves(color) {
      const pseudo = this.generatePseudoMoves(color);
      const legal = [];
      for (const m of pseudo) {
        const undo = this.makeMove(m, { trackHistory: false });
        const ok = !this.inCheck(color);
        this.unmakeMove(undo, { trackHistory: false });
        if (ok) legal.push(m);
      }
      return legal;
    }

    makeMove(move, { trackHistory } = { trackHistory: true }) {
      const from = move.from;
      const to = move.to;
      const piece = move.piece;
      const captured = move.isEnPassant ? this.board[move.capturedIndex] : this.board[to];

      const undo = {
        move,
        prevTurn: this.turn,
        prevCastling: { ...this.castling },
        prevEp: this.ep,
        prevHalfmove: this.halfmove,
        prevFullmove: this.fullmove,
        prevHash: this.hash,
        prevWKing: this.wKing,
        prevBKing: this.bKing,
        captured,
      };

      const oldCastleMask = castleMaskFromRights(this.castling);
      if (this.ep !== null) this.hash ^= ChessEngine.ZOBRIST.epFile[fileOf(this.ep)];
      this.hash ^= ChessEngine.ZOBRIST.castle[oldCastleMask];

      const movingIdx = pieceIndex(piece);
      this.hash ^= ChessEngine.ZOBRIST.piece[movingIdx][from];
      this.board[from] = null;

      if (captured) {
        const capIdx = pieceIndex(captured);
        const capSq = move.isEnPassant ? move.capturedIndex : to;
        this.hash ^= ChessEngine.ZOBRIST.piece[capIdx][capSq];
        this.board[capSq] = null;
      }

      let placed = piece;
      if (move.promotion) placed = this.turn === "w" ? move.promotion.toUpperCase() : move.promotion;

      const placedIdx = pieceIndex(placed);
      this.hash ^= ChessEngine.ZOBRIST.piece[placedIdx][to];
      this.board[to] = placed;

      if (piece.toLowerCase() === "k") {
        if (this.turn === "w") this.wKing = to;
        else this.bKing = to;
      }

      if (move.isCastle) {
        if (this.turn === "w") {
          if (move.castleSide === "K") this._moveRookHash(63, 61, "R");
          else this._moveRookHash(56, 59, "R");
        } else {
          if (move.castleSide === "K") this._moveRookHash(7, 5, "r");
          else this._moveRookHash(0, 3, "r");
        }
      }

      this._updateCastlingRightsAfterMove(from, to, piece, captured);

      this.ep = null;
      if (piece.toLowerCase() === "p" && Math.abs(to - from) === 16) this.ep = (to + from) / 2;

      const newCastleMask = castleMaskFromRights(this.castling);
      this.hash ^= ChessEngine.ZOBRIST.castle[newCastleMask];
      if (this.ep !== null) this.hash ^= ChessEngine.ZOBRIST.epFile[fileOf(this.ep)];

      const isPawnMove = piece.toLowerCase() === "p";
      const isCapture = Boolean(captured);
      this.halfmove = isPawnMove || isCapture ? 0 : this.halfmove + 1;
      if (this.turn === "b") this.fullmove += 1;

      this.turn = opponent(this.turn);
      this.hash ^= ChessEngine.ZOBRIST.side;

      if (trackHistory !== false) {
        this.hashLine.push(this.hash);
        const key = this.hash.toString();
        this.rep.set(key, (this.rep.get(key) || 0) + 1);
      }

      return undo;
    }

    _moveRookHash(from, to, rookPiece) {
      this.board[from] = null;
      this.board[to] = rookPiece;
      const idx = pieceIndex(rookPiece);
      this.hash ^= ChessEngine.ZOBRIST.piece[idx][from];
      this.hash ^= ChessEngine.ZOBRIST.piece[idx][to];
    }

    _updateCastlingRightsAfterMove(from, to, piece, captured) {
      if (piece === "K") {
        this.castling.K = false;
        this.castling.Q = false;
      } else if (piece === "k") {
        this.castling.k = false;
        this.castling.q = false;
      } else if (piece === "R") {
        if (from === 63) this.castling.K = false;
        if (from === 56) this.castling.Q = false;
      } else if (piece === "r") {
        if (from === 7) this.castling.k = false;
        if (from === 0) this.castling.q = false;
      }

      if (captured === "R") {
        if (to === 63) this.castling.K = false;
        if (to === 56) this.castling.Q = false;
      } else if (captured === "r") {
        if (to === 7) this.castling.k = false;
        if (to === 0) this.castling.q = false;
      }
    }

    unmakeMove(undo, { trackHistory } = { trackHistory: true }) {
      if (trackHistory !== false) {
        const key = this.hash.toString();
        const cur = (this.rep.get(key) || 0) - 1;
        if (cur <= 0) this.rep.delete(key);
        else this.rep.set(key, cur);
        this.hashLine.pop();
      }

      const { move } = undo;
      this.turn = undo.prevTurn;
      this.castling = { ...undo.prevCastling };
      this.ep = undo.prevEp;
      this.halfmove = undo.prevHalfmove;
      this.fullmove = undo.prevFullmove;
      this.hash = undo.prevHash;
      this.wKing = undo.prevWKing;
      this.bKing = undo.prevBKing;

      const from = move.from;
      const to = move.to;
      this.board[from] = move.piece;

      if (move.isCastle) {
        if (this.turn === "w") {
          if (move.castleSide === "K") {
            this.board[63] = "R";
            this.board[61] = null;
          } else {
            this.board[56] = "R";
            this.board[59] = null;
          }
        } else {
          if (move.castleSide === "K") {
            this.board[7] = "r";
            this.board[5] = null;
          } else {
            this.board[0] = "r";
            this.board[3] = null;
          }
        }
      }

      this.board[to] = null;
      if (undo.captured) {
        const capSq = move.isEnPassant ? move.capturedIndex : to;
        this.board[capSq] = undo.captured;
      }
    }

    getRepetitionCount() {
      return this.rep.get(this.hash.toString()) || 0;
    }

    isInsufficientMaterial() {
      let whiteB = 0;
      let whiteN = 0;
      let blackB = 0;
      let blackN = 0;

      for (let i = 0; i < 64; i++) {
        const p = this.board[i];
        if (!p) continue;
        const t = p.toLowerCase();
        if (t === "k") continue;
        if (t === "p" || t === "q" || t === "r") return false;
        if (t === "b") {
          if (colorOf(p) === "w") whiteB++;
          else blackB++;
        } else if (t === "n") {
          if (colorOf(p) === "w") whiteN++;
          else blackN++;
        } else {
          return false;
        }
      }

      const whiteCanMate = whiteB >= 2 || (whiteB >= 1 && whiteN >= 1) || whiteN >= 3;
      const blackCanMate = blackB >= 2 || (blackB >= 1 && blackN >= 1) || blackN >= 3;
      return !whiteCanMate && !blackCanMate;
    }

    getGameResult() {
      const legal = this.generateLegalMoves(this.turn);
      const inCheck = this.inCheck(this.turn);
      if (legal.length === 0) {
        if (inCheck) return { over: true, result: "checkmate", winner: opponent(this.turn) };
        return { over: true, result: "stalemate", winner: null };
      }
      if (this.halfmove >= 100) return { over: true, result: "fifty-move", winner: null };
      if (this.getRepetitionCount() >= 3) return { over: true, result: "threefold", winner: null };
      if (this.isInsufficientMaterial()) return { over: true, result: "insufficient", winner: null };
      return { over: false, result: null, winner: null };
    }
  }

  function evaluate(engine, perspectiveColor) {
    let score = 0;
    for (let i = 0; i < 64; i++) {
      const p = engine.board[i];
      if (!p) continue;
      const c = colorOf(p);
      const t = p.toLowerCase();
      const base = PIECE_VALUES[t] || 0;
      const mirror = 63 - i;
      const pst =
        t === "p"
          ? PST.pawn
          : t === "n"
            ? PST.knight
            : t === "b"
              ? PST.bishop
              : t === "r"
                ? PST.rook
                : t === "q"
                  ? PST.queen
                  : t === "k"
                    ? PST.kingMid
                    : PST.zero;
      const ps = c === "w" ? pst[i] : pst[mirror];
      const v = base + ps;
      score += c === perspectiveColor ? v : -v;
    }
    const mobility = engine.generateLegalMoves(perspectiveColor).length - engine.generateLegalMoves(opponent(perspectiveColor)).length;
    score += clamp(mobility, -20, 20) * 2;
    return score;
  }

  function orderMoves(moves) {
    const v = (p) => (p ? PIECE_VALUES[p.toLowerCase()] || 0 : 0);
    return moves
      .slice()
      .sort((a, b) => {
        const aScore = (a.promotion ? 900 : 0) + (a.captured || a.isEnPassant ? v(a.captured) * 10 - v(a.piece) : 0);
        const bScore = (b.promotion ? 900 : 0) + (b.captured || b.isEnPassant ? v(b.captured) * 10 - v(b.piece) : 0);
        return bScore - aScore;
      });
  }

  function findBestMove(engine, difficulty) {
    const color = engine.turn;
    const legal = engine.generateLegalMoves(color);
    if (!legal.length) return null;

    if (difficulty === "easy") {
      const captures = legal.filter((m) => m.captured || m.isEnPassant);
      const pool = captures.length ? captures : legal;
      return pool[(Math.random() * pool.length) | 0];
    }

    const timeLimit = difficulty === "hard" ? 800 : 280;
    const maxDepth = difficulty === "hard" ? 4 : 3;
    const start = performance.now();

    let bestMove = legal[0];
    let bestScore = -Infinity;
    const perspective = color;

    const negamax = (depth, alpha, beta) => {
      if (performance.now() - start > timeLimit) return { aborted: true, score: 0 };

      const result = engine.getGameResult();
      if (result.over) {
        if (result.result === "checkmate") {
          const losing = engine.turn;
          const s = losing === perspective ? -100000 : 100000;
          return { aborted: false, score: s - (maxDepth - depth) };
        }
        return { aborted: false, score: 0 };
      }

      if (depth === 0) return { aborted: false, score: evaluate(engine, perspective) };

      const moves = orderMoves(engine.generateLegalMoves(engine.turn));
      let best = -Infinity;
      for (const m of moves) {
        const undo = engine.makeMove(m, { trackHistory: false });
        const res = negamax(depth - 1, -beta, -alpha);
        engine.unmakeMove(undo, { trackHistory: false });
        if (res.aborted) return res;
        const score = -res.score;
        if (score > best) best = score;
        if (score > alpha) alpha = score;
        if (alpha >= beta) break;
      }
      return { aborted: false, score: best };
    };

    for (let depth = 1; depth <= maxDepth; depth++) {
      if (performance.now() - start > timeLimit) break;
      let localBestMove = bestMove;
      let localBestScore = -Infinity;
      for (const m of orderMoves(legal)) {
        const undo = engine.makeMove(m, { trackHistory: false });
        const res = negamax(depth - 1, -Infinity, Infinity);
        engine.unmakeMove(undo, { trackHistory: false });
        if (res.aborted) {
          depth = maxDepth + 1;
          break;
        }
        const score = -res.score;
        if (score > localBestScore) {
          localBestScore = score;
          localBestMove = m;
        }
      }
      if (localBestScore > bestScore) {
        bestScore = localBestScore;
        bestMove = localBestMove;
      }
    }

    return bestMove;
  }

  function computeSAN(engineBefore, move, legalMovesBefore) {
    const color = engineBefore.turn;
    const toSq = indexToSquare(move.to);

    const baseForCastle = move.castleSide === "K" ? "O-O" : "O-O-O";

    const pType = move.piece.toLowerCase();
    const isCapture = Boolean(move.captured) || Boolean(move.isEnPassant);
    const promo = move.promotion ? `=${move.promotion.toUpperCase()}` : "";

    const pieceLetter = (() => {
      if (pType === "p") return "";
      if (pType === "n") return "N";
      if (pType === "b") return "B";
      if (pType === "r") return "R";
      if (pType === "q") return "Q";
      if (pType === "k") return "K";
      return "";
    })();

    let disambig = "";
    if (pieceLetter) {
      const contenders = legalMovesBefore.filter(
        (m) => m.to === move.to && m.piece.toLowerCase() === pType && colorOf(m.piece) === color && m.from !== move.from
      );
      if (contenders.length) {
        const fromFile = FILES[fileOf(move.from)];
        const fromRank = RANKS[rankOf(move.from)];
        const sharesFile = contenders.some((m) => fileOf(m.from) === fileOf(move.from));
        const sharesRank = contenders.some((m) => rankOf(m.from) === rankOf(move.from));
        if (!sharesFile) disambig = fromFile;
        else if (!sharesRank) disambig = fromRank;
        else disambig = `${fromFile}${fromRank}`;
      }
    }

    let prefix = pieceLetter + disambig;
    if (!pieceLetter && isCapture) prefix = FILES[fileOf(move.from)];

    const captureMark = isCapture ? "x" : "";
    const base = move.isCastle ? baseForCastle : `${prefix}${captureMark}${toSq}${promo}`;

    const after = new ChessEngine();
    after.loadFEN(engineBefore.toFEN());
    after.makeMove({ ...move, captured: move.captured || null }, { trackHistory: true });

    const resultAfter = after.getGameResult();
    if (resultAfter.over && resultAfter.result === "checkmate") return `${base}#`;
    if (after.inCheck(after.turn)) return `${base}+`;
    return base;
  }

  function buildPieceSVG(setName, pieceChar) {
    const color = isUpper(pieceChar) ? "w" : "b";
    const fill = color === "w" ? "var(--pieceWhite)" : "var(--pieceBlack)";
    const stroke = "var(--pieceStroke)";

    const style =
      setName === "minimal"
        ? `fill:${fill};stroke:${stroke};stroke-width:0;`
        : setName === "outline"
          ? `fill:transparent;stroke:${color === "w" ? "rgba(255,255,255,0.92)" : "rgba(10,12,16,0.92)"};stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round;`
          : `fill:${fill};stroke:${stroke};stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;`;

    const type = pieceChar.toLowerCase();
    const paths = {
      k: `<path d="M32 10v8"/><path d="M28 14h8"/><path d="M22 54h20"/><path d="M24 50c0-8 16-8 16 0"/><path d="M22 44c0-10 20-10 20 0"/><path d="M26 40c-6-8 2-18 6-20c4 2 12 12 6 20"/><path d="M24 36h16"/>`,
      q: `<path d="M22 52h20"/><path d="M23 48c0-9 18-9 18 0"/><path d="M20 42l4-16l8 10l8-10l4 16"/><circle cx="20" cy="24" r="2.5"/><circle cx="32" cy="18" r="2.5"/><circle cx="44" cy="24" r="2.5"/>`,
      r: `<path d="M22 52h20"/><path d="M24 48c0-8 16-8 16 0"/><path d="M24 22h16v18H24z"/><path d="M22 22v-6h6v6"/><path d="M30 22v-6h4v6"/><path d="M38 22v-6h6v6"/>`,
      b: `<path d="M22 52h20"/><path d="M24 48c0-8 16-8 16 0"/><path d="M32 18c-7 6-9 16 0 22c9-6 7-16 0-22z"/><path d="M32 18l4-4"/><path d="M26 40h12"/>`,
      n: `<path d="M22 52h20"/><path d="M24 48c0-8 16-8 16 0"/><path d="M26 44c2-12 4-20 16-22c-2 8-2 12 4 18c-8 2-10 6-10 12"/><path d="M28 30c2-4 6-6 10-6"/><circle cx="39" cy="27" r="1.6"/>`,
      p: `<path d="M24 52h16"/><path d="M26 48c0-7 12-7 12 0"/><path d="M32 18c-4 0-7 3-7 7s3 7 7 7s7-3 7-7s-3-7-7-7z"/><path d="M26 34c-3 4-2 10 6 10s9-6 6-10"/><path d="M26 34h12"/>`,
    };

    return `<svg viewBox="0 0 64 64" aria-hidden="true"><g style="${style}">${paths[type]}</g></svg>`;
  }

  const STORAGE_KEY = "chess.settings.v1";
  function loadSettings() {
    const defaults = {
      theme: "classic",
      texture: "flat",
      pieceSet: "classic",
      coords: true,
      highlight: "subtle",
      flip: false,
    };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      return { ...defaults, ...parsed };
    } catch {
      return defaults;
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function applyTheme(settings) {
    const body = document.body;
    body.classList.remove(
      "theme-classic",
      "theme-walnut",
      "theme-slate",
      "theme-ocean",
      "theme-contrast",
      "theme-minimal",
      "texture-noise",
      "texture-wood",
      "highlight-strong"
    );
    body.classList.add(`theme-${settings.theme}`);
    if (settings.texture === "noise") body.classList.add("texture-noise");
    if (settings.texture === "wood") body.classList.add("texture-wood");
    if (settings.highlight === "strong") body.classList.add("highlight-strong");
  }

  function copyText(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    return Promise.resolve();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function init() {
    const elBoard = document.getElementById("board");
    const elStatus = document.getElementById("statusLine");
    const elHint = document.getElementById("hintLine");
    const elMoveList = document.getElementById("moveList");
    const elThinking = document.getElementById("thinkingIndicator");

    const settingsDialog = document.getElementById("settingsDialog");
    const promotionDialog = document.getElementById("promotionDialog");
    const fenDialog = document.getElementById("fenDialog");

    const ui = {
      settings: loadSettings(),
      engine: new ChessEngine(),
      selected: null,
      legalForSelected: [],
      lastMove: null,
      history: [],
      redo: [],
      focusIndex: 60,
      mode: document.getElementById("modeSelect").value,
      humanSide: document.getElementById("humanSideSelect").value,
      difficulty: document.getElementById("difficultySelect").value,
      pendingPromotion: null,
      aiTimer: null,
    };

    applyTheme(ui.settings);

    function setHint(msg, { shake } = {}) {
      elHint.textContent = msg || "";
      if (shake) {
        elBoard.classList.remove("shake");
        void elBoard.offsetWidth;
        elBoard.classList.add("shake");
      }
    }

    function updateStatus() {
      const result = ui.engine.getGameResult();
      const toMove = ui.engine.turn === "w" ? "White" : "Black";
      const check = ui.engine.inCheck(ui.engine.turn);
      let msg = `${toMove} to move`;
      if (check) msg += " — Check";
      if (result.over) {
        if (result.result === "checkmate") msg = `Checkmate — ${result.winner === "w" ? "White" : "Black"} wins`;
        else if (result.result === "stalemate") msg = "Draw — Stalemate";
        else if (result.result === "fifty-move") msg = "Draw — Fifty-move rule";
        else if (result.result === "threefold") msg = "Draw — Threefold repetition";
        else if (result.result === "insufficient") msg = "Draw — Insufficient material";
      }
      elStatus.textContent = msg;
    }

    function buildBoardDOM() {
      elBoard.innerHTML = "";
      const indices = Array.from({ length: 64 }, (_, i) => i);
      if (ui.settings.flip) indices.reverse();

      for (const idx of indices) {
        const f = fileOf(idx);
        const r = rankOf(idx);
        const squareEl = document.createElement("div");
        squareEl.className = `square ${(f + r) % 2 === 0 ? "dark" : "light"}`;
        squareEl.dataset.index = String(idx);
        squareEl.role = "gridcell";
        squareEl.tabIndex = idx === ui.focusIndex ? 0 : -1;
        squareEl.ariaLabel = indexToSquare(idx);

        const pieceEl = document.createElement("div");
        pieceEl.className = "piece";
        squareEl.appendChild(pieceEl);
        elBoard.appendChild(squareEl);
      }
      renderCoords();
    }

    function renderCoords() {
      const show = Boolean(ui.settings.coords);
      for (const sq of elBoard.querySelectorAll(".square")) {
        sq.querySelectorAll(".coord").forEach((n) => n.remove());
        if (!show) continue;
        const idx = Number(sq.dataset.index);
        const f = fileOf(idx);
        const r = rankOf(idx);
        const isLeftFile = ui.settings.flip ? f === 7 : f === 0;
        const isBottomRank = ui.settings.flip ? r === 0 : r === 7;
        if (isLeftFile) {
          const span = document.createElement("span");
          span.className = "coord rank";
          span.textContent = RANKS[r];
          sq.appendChild(span);
        }
        if (isBottomRank) {
          const span = document.createElement("span");
          span.className = "coord file";
          span.textContent = FILES[f];
          sq.appendChild(span);
        }
      }
    }

    function renderPieces() {
      const setName = ui.settings.pieceSet;
      for (const sq of elBoard.querySelectorAll(".square")) {
        const idx = Number(sq.dataset.index);
        const piece = ui.engine.board[idx];
        const pieceEl = sq.querySelector(".piece");
        pieceEl.innerHTML = piece ? buildPieceSVG(setName, piece) : "";
      }
    }

    function clearHighlights() {
      for (const sq of elBoard.querySelectorAll(".square")) sq.classList.remove("selected", "legal", "capture", "two-step");
    }

    function renderHighlights() {
      clearHighlights();
      if (ui.selected !== null) {
        const sel = elBoard.querySelector(`.square[data-index="${ui.selected}"]`);
        if (sel) sel.classList.add("selected");
        for (const m of ui.legalForSelected) {
          const target = elBoard.querySelector(`.square[data-index="${m.to}"]`);
          if (!target) continue;
          const cls = m.captured || m.isEnPassant ? "capture" : "legal";
          target.classList.add(cls);
          if (cls === "legal" && m.isDoublePawn) target.classList.add("two-step");
        }
      }

      for (const sq of elBoard.querySelectorAll(".square")) sq.classList.remove("lastmove", "check");
      if (ui.lastMove) {
        const a = elBoard.querySelector(`.square[data-index="${ui.lastMove.from}"]`);
        const b = elBoard.querySelector(`.square[data-index="${ui.lastMove.to}"]`);
        if (a) a.classList.add("lastmove");
        if (b) b.classList.add("lastmove");
      }

      if (ui.engine.inCheck(ui.engine.turn)) {
        const k = ui.engine.turn === "w" ? ui.engine.wKing : ui.engine.bKing;
        const el = elBoard.querySelector(`.square[data-index="${k}"]`);
        if (el) el.classList.add("check");
      }
    }

    function renderMoveList() {
      elMoveList.innerHTML = "";
      const plies = ui.history.map((h) => h.san);
      for (let i = 0; i < plies.length; i += 2) {
        const moveNumber = i / 2 + 1;
        const li = document.createElement("li");
        const w = plies[i] || "";
        const b = plies[i + 1] || "";
        li.innerHTML = `<span class="ply">${moveNumber}.</span> ${escapeHtml(w)} ${b ? escapeHtml(b) : ""}`;
        elMoveList.appendChild(li);
      }
      elMoveList.scrollTop = elMoveList.scrollHeight;
    }

    function renderAll() {
      updateStatus();
      renderPieces();
      renderHighlights();
      renderMoveList();
      document.getElementById("undoBtn").disabled = ui.history.length === 0;
      document.getElementById("redoBtn").disabled = ui.redo.length === 0;
    }

    function isHumanToMove() {
      const t = ui.engine.turn;
      if (ui.mode === "hvh") return true;
      if (ui.mode === "hvc") return t === ui.humanSide;
      return false;
    }

    function isComputerToMove() {
      const t = ui.engine.turn;
      if (ui.mode === "hvh") return false;
      if (ui.mode === "hvc") return t !== ui.humanSide;
      return ui.mode === "cvc";
    }

    function updateModeControls() {
      const humanSideSelect = document.getElementById("humanSideSelect");
      const difficultySelect = document.getElementById("difficultySelect");
      if (ui.mode === "hvh") {
        humanSideSelect.disabled = true;
        difficultySelect.disabled = true;
      } else if (ui.mode === "hvc") {
        humanSideSelect.disabled = false;
        difficultySelect.disabled = false;
      } else {
        humanSideSelect.disabled = true;
        difficultySelect.disabled = false;
      }
    }

    function stopAI() {
      if (ui.aiTimer) {
        clearTimeout(ui.aiTimer);
        ui.aiTimer = null;
      }
      elThinking.hidden = true;
    }

    function maybeStartAI() {
      stopAI();
      const result = ui.engine.getGameResult();
      if (result.over) return;
      if (!isComputerToMove()) return;
      elThinking.hidden = false;
      ui.aiTimer = setTimeout(() => {
        const best = findBestMove(ui.engine, ui.difficulty);
        elThinking.hidden = true;
        ui.aiTimer = null;
        if (!best) return;
        const move = { ...best };
        if (move.promotion) move.promotion = "q";
        applyMove(move, { fromUI: false });
      }, 40);
    }

    async function applyMove(move, { fromUI } = {}) {
      stopAI();
      const legalBefore = ui.engine.generateLegalMoves(ui.engine.turn);
      const san = computeSAN(ui.engine, move, legalBefore);
      const undo = ui.engine.makeMove(move, { trackHistory: true });
      ui.history.push({ move, undo, san, fenAfter: ui.engine.toFEN() });
      ui.redo = [];
      ui.lastMove = { from: move.from, to: move.to };
      ui.selected = null;
      ui.legalForSelected = [];
      setHint("");
      renderAll();
      maybeStartAI();
      if (fromUI) {
        const res = ui.engine.getGameResult();
        if (res.over) setHint("Game over.");
      }
    }

    function undoMove() {
      stopAI();
      if (!ui.history.length) return;
      const last = ui.history.pop();
      ui.engine.unmakeMove(last.undo, { trackHistory: true });
      ui.redo.push(last);
      ui.lastMove = ui.history.length ? { from: ui.history[ui.history.length - 1].move.from, to: ui.history[ui.history.length - 1].move.to } : null;
      ui.selected = null;
      ui.legalForSelected = [];
      setHint("");
      renderAll();
      maybeStartAI();
    }

    function redoMove() {
      stopAI();
      const next = ui.redo.pop();
      if (!next) return;
      const undo = ui.engine.makeMove(next.move, { trackHistory: true });
      ui.history.push({ ...next, undo, fenAfter: ui.engine.toFEN() });
      ui.lastMove = { from: next.move.from, to: next.move.to };
      ui.selected = null;
      ui.legalForSelected = [];
      setHint("");
      renderAll();
      maybeStartAI();
    }

    function resetGame() {
      stopAI();
      ui.engine.reset();
      ui.selected = null;
      ui.legalForSelected = [];
      ui.lastMove = null;
      ui.history = [];
      ui.redo = [];
      setHint("");
      renderAll();
      maybeStartAI();
    }

    function legalMovesFromSquare(from) {
      return ui.engine.generateLegalMoves(ui.engine.turn).filter((m) => m.from === from);
    }

    function openPromotionPicker(moveTemplate) {
      ui.pendingPromotion = moveTemplate;
      const holder = document.getElementById("promotionChoices");
      holder.innerHTML = "";
      const color = ui.engine.turn;
      for (const p of ["q", "r", "b", "n"]) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "promoChoice";
        const ch = color === "w" ? p.toUpperCase() : p;
        btn.innerHTML = buildPieceSVG(ui.settings.pieceSet, ch);
        btn.addEventListener("click", () => {
          promotionDialog.close("ok");
          const move = { ...ui.pendingPromotion, promotion: p };
          ui.pendingPromotion = null;
          applyMove(move, { fromUI: true });
        });
        holder.appendChild(btn);
      }
      promotionDialog.showModal();
    }

    function handleSquareActivate(index) {
      if (!isHumanToMove()) return;
      const piece = ui.engine.board[index];
      const myColor = ui.engine.turn;

      if (ui.selected === null) {
        if (piece && colorOf(piece) === myColor) {
          ui.selected = index;
          ui.legalForSelected = legalMovesFromSquare(index);
          setHint(`Selected ${indexToSquare(index)}.`);
          renderHighlights();
        } else {
          setHint("Select one of your pieces.", { shake: true });
        }
        return;
      }

      if (index === ui.selected) {
        ui.selected = null;
        ui.legalForSelected = [];
        setHint("");
        renderHighlights();
        return;
      }

      const chosen = ui.legalForSelected.find((m) => m.to === index);
      if (chosen) {
        if (chosen.promotion) openPromotionPicker(chosen);
        else applyMove(chosen, { fromUI: true });
        return;
      }

      if (piece && colorOf(piece) === myColor) {
        ui.selected = index;
        ui.legalForSelected = legalMovesFromSquare(index);
        setHint(`Selected ${indexToSquare(index)}.`);
        renderHighlights();
        return;
      }

      setHint("Illegal move.", { shake: true });
    }

    function setFocus(index) {
      ui.focusIndex = index;
      for (const sq of elBoard.querySelectorAll(".square")) {
        const idx = Number(sq.dataset.index);
        sq.tabIndex = idx === ui.focusIndex ? 0 : -1;
      }
      const target = elBoard.querySelector(`.square[data-index="${ui.focusIndex}"]`);
      if (target) target.focus({ preventScroll: true });
    }

    elBoard.addEventListener("click", (e) => {
      const sq = e.target.closest(".square");
      if (!sq) return;
      const idx = Number(sq.dataset.index);
      setFocus(idx);
      handleSquareActivate(idx);
    });

    elBoard.addEventListener("keydown", (e) => {
      const key = e.key;
      if (key === "Enter" || key === " ") {
        e.preventDefault();
        handleSquareActivate(ui.focusIndex);
        return;
      }
      const dir =
        key === "ArrowUp"
          ? -8
          : key === "ArrowDown"
            ? 8
            : key === "ArrowLeft"
              ? -1
              : key === "ArrowRight"
                ? 1
                : 0;
      if (!dir) return;
      e.preventDefault();
      const next = ui.focusIndex + dir;
      if (next < 0 || next >= 64) return;
      if ((dir === -1 || dir === 1) && Math.abs(fileOf(next) - fileOf(ui.focusIndex)) !== 1) return;
      setFocus(next);
    });

    document.getElementById("newGameBtn").addEventListener("click", resetGame);
    document.getElementById("undoBtn").addEventListener("click", undoMove);
    document.getElementById("redoBtn").addEventListener("click", redoMove);

    document.getElementById("flipBtn").addEventListener("click", () => {
      ui.settings.flip = !ui.settings.flip;
      saveSettings(ui.settings);
      buildBoardDOM();
      renderAll();
    });

    document.getElementById("copyFenBtn").addEventListener("click", async () => {
      const fen = ui.engine.toFEN();
      try {
        await copyText(fen);
        setHint("FEN copied.");
      } catch {
        setHint("Could not copy FEN.", { shake: true });
      }
    });

    document.getElementById("copyPgnBtn").addEventListener("click", async () => {
      const plies = ui.history.map((h) => h.san);
      const parts = [];
      for (let i = 0; i < plies.length; i += 2) {
        const moveNumber = i / 2 + 1;
        parts.push(`${moveNumber}. ${plies[i] || ""}`.trim());
        if (plies[i + 1]) parts.push(plies[i + 1]);
      }
      const res = ui.engine.getGameResult();
      const resultTag = (() => {
        if (!res.over) return "*";
        if (res.result === "checkmate") return res.winner === "w" ? "1-0" : "0-1";
        return "1/2-1/2";
      })();
      const pgn = `${parts.join(" ").trim()} ${resultTag}`.trim();
      try {
        await copyText(pgn);
        setHint("PGN copied.");
      } catch {
        setHint("Could not copy PGN.", { shake: true });
      }
    });

    document.getElementById("loadFenBtn").addEventListener("click", () => {
      const input = document.getElementById("fenInput");
      input.value = ui.engine.toFEN();
      fenDialog.showModal();
      input.focus();
      input.select();
    });

    document.getElementById("fenApplyBtn").addEventListener("click", (e) => {
      e.preventDefault();
      const input = document.getElementById("fenInput");
      try {
        stopAI();
        ui.engine.loadFEN(input.value);
        ui.selected = null;
        ui.legalForSelected = [];
        ui.lastMove = null;
        ui.history = [];
        ui.redo = [];
        fenDialog.close("ok");
        setHint("FEN loaded.");
        buildBoardDOM();
        renderAll();
        maybeStartAI();
      } catch (err) {
        setHint(err?.message || "Invalid FEN.", { shake: true });
      }
    });

    document.getElementById("settingsBtn").addEventListener("click", () => {
      document.getElementById("themeSelect").value = ui.settings.theme;
      document.getElementById("textureSelect").value = ui.settings.texture;
      document.getElementById("pieceSetSelect").value = ui.settings.pieceSet;
      document.getElementById("highlightSelect").value = ui.settings.highlight;
      document.getElementById("coordsToggle").checked = Boolean(ui.settings.coords);
      document.getElementById("flipToggle").checked = Boolean(ui.settings.flip);
      settingsDialog.showModal();
    });

    settingsDialog.addEventListener("close", () => {
      if (settingsDialog.returnValue === "cancel") return;
      ui.settings.theme = document.getElementById("themeSelect").value;
      ui.settings.texture = document.getElementById("textureSelect").value;
      ui.settings.pieceSet = document.getElementById("pieceSetSelect").value;
      ui.settings.highlight = document.getElementById("highlightSelect").value;
      ui.settings.coords = document.getElementById("coordsToggle").checked;
      ui.settings.flip = document.getElementById("flipToggle").checked;
      saveSettings(ui.settings);
      applyTheme(ui.settings);
      buildBoardDOM();
      renderAll();
    });

    promotionDialog.addEventListener("close", () => {
      if (promotionDialog.returnValue === "cancel") {
        ui.pendingPromotion = null;
        setHint("Promotion canceled.", { shake: true });
      }
    });

    document.getElementById("modeSelect").addEventListener("change", (e) => {
      ui.mode = e.target.value;
      updateModeControls();
      maybeStartAI();
    });

    document.getElementById("humanSideSelect").addEventListener("change", (e) => {
      ui.humanSide = e.target.value;
      maybeStartAI();
    });

    document.getElementById("difficultySelect").addEventListener("change", (e) => {
      ui.difficulty = e.target.value;
      maybeStartAI();
    });

    updateModeControls();
    buildBoardDOM();
    renderAll();
    maybeStartAI();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
