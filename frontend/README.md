# roomcraft frontend

React 19 + Vite + Tailwind, with three.js (`@react-three/fiber`, `drei`) for
the 3D room. Landing page, sign-up/login, onboarding, a dashboard of saved
designs, the 2D/3D room editor, and the phone room scanner.

## Run

```bash
npm install
npm run dev:wifi     # HTTPS, reachable from a phone on the same Wi-Fi (needed for the scanner)
npm run dev          # http://localhost:5173, laptop only
npm run build        # production build in dist/ (two pages: index.html, scan.html)
npm run lint         # oxlint
```

The backend must be running on `http://localhost:5000` (see
`../backend/README.md`). With `dev:wifi` the browser shows a certificate
warning the first time: the dev certificate is self-made; continue anyway.

## Configuration

| File | Key | What |
|---|---|---|
| `.env` | `VITE_API_URL` | empty (default): the app calls `/api` on its own address and the dev server passes it to the backend. Set a full URL only for a separately deployed backend. |
| `.env.local` | `GEMINI_API_KEY` | for the scanner's "Guess from camera" (optional). Free-tier key, no billing. Never commit it (`*.local` is git-ignored). |
| `.env.local` | `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS` | optional overrides; defaults `gemini-flash-latest`, then `gemini-flash-lite-latest` |

`vite.config.js` sets up:

- the `/api` and `/uploads` proxy to the backend (the `Origin` header is
  dropped, so the backend's CORS list needs no LAN addresses),
- `/api/detect` for Gemini (`server/gemini_detect.js`),
- HTTPS and LAN access in `wifi` mode,
- the two pages, `index.html` (the app) and `scan.html` (the scanner).

## Pages

| Route | Page | Login |
|---|---|---|
| `/` | Landing | |
| `/register`, `/verify-register-otp` | sign-up with an emailed 5-digit code | |
| `/login`, `/forgot-password`, `/verify-reset-otp`, `/reset-password` | | |
| `/onboarding` | first-time questions | ✓ |
| `/dashboard` | My Designs, **📷 Scan my room**, + New Design; profile photo (or initials) in the top bar | ✓ |
| `/editor`, `/editor?id=<id>` | the room editor (new, or a saved design) | ✓ |
| `/profile` | name, profession, avatar, password | ✓ |
| `/scan.html` | the AR room scanner (not a React route) | uses the same login |

The JWT is kept in `localStorage` (`rc_token`, user in `rc_user`) and added to
every request by `src/api/api.js`; a 401 sends you back to `/login`.

## The editor

- **Generate room**: pick room type, size and style; furniture is placed by
  `src/data/roomPresets.js` without overlaps and clear of door swings.
- **2D plan** (`components/FloorPlan2D.jsx`) and **3D view**
  (`components/RoomViewer.jsx`, models in `components/furniture/`): drag
  pieces, doors and windows.
- **Plan labels** (`placePieceLabels` in `FloorPlan2D.jsx`): every piece's name sits inside its own
  box, along its long side, on one or two lines; labels slide or shrink so no two touch, including a
  wall piece hanging over a floor piece. Room names fit inside their room and keep clear of
  furniture and door swings. Every room (main and connected) has width and length lines on a side
  with no neighbouring room (`sizeLines`).
- **Layout**: on a laptop the toolbar (2D/3D, ☰ Tools, ✨ Ask AI) is top-left, the 2D zoom and fit
  buttons top-right, the size dialog under the toolbar; the AI chat opens as a column beside the
  room and the 3D camera steps back when the view narrows. On a phone the chat is a bottom sheet.
- **Tour**: the **?** button runs `components/Tutorial.jsx`, 8 steps that spotlight each control
  (anchors are `data-tutorial="..."` attributes); on a phone the card goes to the top or bottom.
- **Rotate a piece**: slider and ⟲/⟳ 15° buttons, any angle; it snaps straight
  near 0/90/180/270° and refuses an angle that would hit another piece.
- **Edit dimensions**: any number of decimals.
- **Connected rooms**: add a room through a door ("+" on the plan), move it
  with the arrows or its ✥ handle, **⟳ Turn room** 90° (the selected room,
  or the main room, which turns the whole plan so every room stays docked).
- Wall colours (incl. "AI Colors"), floor type, save / update.
- **PDF export** (`utils/exportFloorPlan.js`): renders the real `<FloorPlan2D bare />` off screen, so
  the A4 PDF has the same labels and size lines as the screen; on a phone it can go to the share sheet.

Collision and placement rules live in `src/utils/layout.js` (pieces) and
`src/utils/roomLayout.js` (rooms: placement, docking, quarter turns).
All lengths are in **feet**, room centred on 0, front wall at −z.

## AI assistant

- **✨ Ask AI** (editor toolbar button, `components/AiChatPanel.jsx`; a column beside the room on wide screens,
  a bottom sheet on phones): questions and changes for the
  open room. Each suggestion is a button (paint walls, floor, add or remove a piece, furnish the whole room);
  nothing changes until it is tapped, and each applied change has Undo. "Furnish this room as…" keeps the room's
  size, doors and windows, so it works on a scanned room. Pieces are placed by `utils/promptRoom.js` with the
  app's rules (inside the walls, no overlaps, door swing clear); the AI never gives coordinates.
- `api/assistant.js` sends the app's catalog (`assistantCatalog()`) with every request, so the model only
  picks furniture, styles and floors the app can draw.

## The scanner (`scan.html`, `src/roomscan/`)

A copy of the RoomScanAR project's source (its README explains scanning and
the geometry; its tests run there). On the phone, in the Chrome app:

1. walls by their four corners (bottom-left, top-left, top-right,
   bottom-right), wall 1 the one with the door, turning right;
2. **Close room** when the last corner meets the first;
3. doors and windows by two corners, furniture by type + size + one tap
   (cupboards: two corners, like a door);
4. **Save to my designs** posts the room to `POST /api/designs` with the
   app's login; the ceiling height becomes the design's `wall_height`.

Pieces are squared to the walls and moved apart before saving, with the same
gaps as `utils/layout.js`. **Open a scan file** loads a downloaded scan log,
to save a scan made earlier (e.g. on a laptop during a demo).

To update the copy after changing RoomScanAR: copy its `src/` over
`src/roomscan/`, then re-add the short "RoomCraft app" block at the end of
`src/roomscan/style.css` (the back link and save message styles).

## Folders

```
index.html, scan.html     the two pages
server/gemini_detect.js   /api/detect (dev server only; Gemini call + catalog check)
src/
  api/api.js              axios instance (JWT, 401 handling)
  context/AuthContext.jsx login state
  pages/                  one file per route
  components/             FloorPlan2D, RoomViewer, furniture models, modals, tutorial
  data/                   room presets, furniture definitions
  utils/                  layout (pieces), roomLayout (rooms), exportFloorPlan
  roomscan/               the scanner (copy of RoomScanAR/src)
```
