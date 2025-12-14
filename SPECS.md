You are an expert frontend engineer and game developer. Build a **complete chess web application** using **only HTML, CSS, and vanilla JavaScript** (no frameworks). The app must excel at the **fundamentals of chess**: correct rules, smooth UX, clear visuals, and reliable move logic. This is a **frontend-only** project (no server, no database). Everything should run locally in the browser.

### 1) Deliverables

Produce:

* `index.html`
* `styles.css`
* `app.js`
* Optional: `assets/` folder for SVG piece sets and theme previews (but do not require external hosting)

The result should work by opening `index.html` directly (no build step).

### 2) Core Product Requirements (Must-Haves)

#### A. Chess Rules (Correctness First)

Implement full standard chess rules:

* Standard initial setup
* Legal move generation and validation for all pieces
* Turns (white then black), cannot move opponent pieces
* **Check / checkmate / stalemate** detection
* **Pinned piece** behavior (disallow illegal moves that expose king)
* **Castling** (both sides) with all conditions:

  * King/rook haven’t moved
  * Squares between are empty
  * King not in check, does not pass through check, does not end in check
* **En passant**

  * Track en passant target squares after a double pawn push
  * Allow capture only immediately on the next move
* **Pawn promotion**

  * Choose promotion piece (Queen/Rook/Bishop/Knight) via UI modal
* Draw rules:

  * Stalemate
  * Insufficient material
  * Threefold repetition (track position hashes)
  * Fifty-move rule (track halfmove clock)
* Move history should support undo/redo without corrupting state.

#### B. Interactions & UX (Make it feel great)

Board interactions:

* Click-to-select and click-to-move
* Optional drag-and-drop (nice to have) but click-to-move must be solid
* When a piece is selected:

  * Highlight legal destination squares
  * Highlight captures differently
* Provide clear feedback for illegal moves (subtle shake / message)
* Highlight:

  * Last move (from/to squares)
  * King in check (red outline or glow)
* Provide move list in algebraic notation (SAN preferred; at minimum coordinate notation like `e2e4`)

Responsive:

* Works on desktop and mobile
* Board scales to screen width, maintains square aspect ratio
* Touch-friendly controls

Accessibility:

* Keyboard support (optional but valued)
* ARIA labels for major controls
* Color contrast that remains readable

### 3) Visual Customization (Board + Pieces)

Add a **Theme Panel** that allows:

* Board color themes: at least 6 presets (e.g., Classic, Walnut, Slate, Ocean, High Contrast, Minimal)
* Square texture options (flat, subtle noise, wood texture style via CSS)
* Piece sets:

  * At least 3 sets (e.g., Classic Staunton SVG, Minimal, Fancy)
  * Implement pieces as SVG or Unicode with styling (SVG preferred)
* Coordinates toggle (A–H and 1–8 labels)
* Highlight styles toggle (subtle vs strong)
* “Flip board” option (rotate board 180°)
  Persist settings using `localStorage`.

### 4) Game Modes

Provide these modes:

1. **Human vs Human (local)**
2. **Human vs Computer**
3. **Computer vs Computer** (optional, nice demo mode)

For Human vs Computer:

* Choose side: play as White or Black
* Choose difficulty:

  * Easy: random legal move with basic capture preference
  * Medium: shallow evaluation search (e.g., minimax depth 2–3)
  * Hard: deeper minimax (depth 3–4) + simple move ordering
* Add “thinking” indicator when AI is choosing a move
* AI must never make illegal moves

### 5) Chess Engine Approach (Frontend Only)

Implement a lightweight engine in JavaScript (no external libraries). Structure it cleanly:

**Board representation**

* Use a robust internal state representation (e.g., 8x8 array or 0x88 or bitboard-like, but keep it understandable)
* Track:

  * Piece placement
  * Side to move
  * Castling rights
  * En passant square
  * Halfmove clock
  * Fullmove number
  * Position repetition tracking

**Move generation**

* Generate pseudo-legal moves, then filter illegal moves by king safety
* Provide utility functions:

  * `isSquareAttacked(square, byColor)`
  * `inCheck(color)`
  * `makeMove(move)` and `unmakeMove(move)` (for search + undo)
  * `generateLegalMoves(color)`
* Use clear move objects:

  * `{ from, to, piece, captured, promotion, isCastle, isEnPassant, prevStateSnapshot }`

**Evaluation**

* Material values (P=100, N=320, B=330, R=500, Q=900, K=∞)
* Add basic positional heuristics (optional but valued):

  * Mobility bonus
  * Center control
  * King safety (very simple)
* Keep evaluation deterministic and stable

**Search**

* Minimax with alpha-beta pruning
* Depth-limited
* Basic move ordering:

  * Captures first
  * Checks first (optional)
* Time safety:

  * Hard cap to avoid freezing the UI
  * Use `setTimeout` / async pattern for AI turn so UI remains responsive

### 6) UI Layout Requirements

Layout sections:

* Top bar: App title + new game + settings
* Main area:

  * Left: chessboard
  * Right: game panel (mode, difficulty, timers optional, move list, status)
* Bottom/side controls:

  * Undo / Redo
  * Reset / New Game
  * Copy FEN / Load FEN (see below)
  * Export PGN (optional)

Status panel should show:

* “White to move / Black to move”
* “Check”, “Checkmate”, “Stalemate”, “Draw by repetition”, etc.

### 7) Import/Export (Very Useful Basics)

Support:

* **FEN export** of current position
* **FEN load** (input box to paste FEN and load position)
* PGN export (optional but strongly preferred)
* Provide a “Copy” button with clipboard API fallback.

### 8) Performance & Reliability Requirements

* No major UI lag during move generation
* Avoid re-rendering the entire UI unnecessarily
* Use clean rendering:

  * Either DOM grid squares with dataset coords
  * Or a single board container with 64 square elements
* Keep logic and UI separated:

  * `engine/` style objects (even if in same file) vs `ui` module

### 9) Code Quality Requirements

* Write readable, well-commented code
* Use consistent naming and small functions
* Include a short “How it works” comment header in `app.js`
* No global variable soup; use modules/IIFEs or classes
* Include a few basic test scenarios inside comments (manual test checklist)

### 10) Acceptance Criteria (Checklist)

The final app is acceptable only if:

* All chess rules listed above work correctly
* Illegal moves are blocked reliably (including pinned pieces)
* Check/checkmate/stalemate detection works
* Castling/en passant/promotion work with correct constraints
* Human vs Computer works for all difficulties and never plays illegal moves
* Theme settings persist in localStorage
* FEN export/import works correctly
* UI is responsive and usable on mobile

### 11) Nice-to-Haves (Do if time)

* Drag-and-drop
* Simple clocks (no increment required)
* Sound effects toggle
* Move list in SAN
* Animation for piece moves
* Highlight legal moves only after selecting a piece (already required)
* Opening randomizer for demo mode (optional)

### 12) Output Format

Provide the complete code for:

* `index.html`
* `styles.css`
* `app.js`

Do not omit code with placeholders. If you must shorten anything, shorten theme presets or piece sets—not the rules.
