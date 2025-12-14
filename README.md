# Chess
<img width="3841" height="1830" alt="Chess-12-14-2025_06_47_PM" src="https://github.com/user-attachments/assets/d90abe17-871d-4537-987b-2c768a0158a6" />
Complete chess web app built with **HTML, CSS, and vanilla JavaScript**. Features:

- Full rules engine with legal move checking (pins, castles, en passant, promotion, repetition, 50-move).
- Move list in SAN, undo/redo, FEN export/import, PGN copy, theming + localStorage persistence.
- Human vs Human, Human vs Computer, Computer vs Computer (alpha-beta AI with difficulty tiers + thinking indicator).
- Responsive UI with move highlights, theme panel, and accessibility touches.

## Usage

1. Open `index.html` in any modern browser.
2. Use the controls to start a new game, copy/load FEN, change modes, or flip the board.
3. Select a piece to highlight legal squares (captures and moves show distinct styling). Pawn promotions trigger a modal choice.

## Settings and themes

- Click **Settings** to change board themes, textures, piece set, highlight style, and board flip. Coordinates and highlight strength persist via `localStorage`.
- Available piece sets: Classic, Minimal, Outline.
- Highlight styles toggle strong/subtle (strong uses more pronounced borders).

## Game modes

- **Human vs Human**: local players alternate moves.
- **Human vs Computer**: choose side (White/Black) and difficulty.
- **Computer vs Computer**: watches two AIs play.

AI behavior: Easy = random move preference, Medium/Hard = depth-limited alpha-beta with move ordering and time cap (~300-800 ms).

## Export / import

- Copy FEN or PGN from the board actions row.
- Load FEN via the modal to resume positions with full rights tracked.

## Notes

- Board and move logic lives inside `app.js`, whose `ChessEngine` class exposes make/unmake/search helpers.
- Styles are handled purely in `styles.css` with CSS variables for theming.
- No build step required; works directly in browser via `index.html`.
