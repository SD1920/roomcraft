# roomcraft backend

Express + PostgreSQL API for roomcraft: sign-up with email OTP, login (JWT),
profile and avatar, onboarding answers, and saved room designs (furniture,
doors/windows, wall colours, connected rooms, wall height).

## Quick start (local)

Needs Node 18+ and a PostgreSQL database. Docker is the easiest way to get
one without installing Postgres (port 5433 so it never clashes with a local
Postgres on 5432):

```bash
docker run -d --name roomcraft-db -e POSTGRES_PASSWORD=choose-a-password -p 5433:5432 --restart unless-stopped postgres:16
```

Then:

```bash
npm install
cp env.example .env        # then fill it in, see below
npm run setup-db           # creates the database and tables (safe to run again)
npm run dev                # http://localhost:5000, restarts on file changes
```

Check it is up: `http://localhost:5000/health` returns `{"status":"ok"}`.

After a laptop restart only the database container needs starting again:
`docker start roomcraft-db` (it starts by itself if Docker Desktop is open).

## `.env`

| Key | What | Example |
|---|---|---|
| `DATABASE_URL` | Postgres connection | `postgresql://postgres:PASSWORD@localhost:5433/roomcraft` |
| `JWT_SECRET` | signs login tokens; long and random | `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"` |
| `JWT_EXPIRES_IN` | token lifetime | `7d` |
| `RESEND_API_KEY` | email for OTP codes ([resend.com](https://resend.com)) | `re_...` |
| `PORT` | API port | `5000` |
| `NODE_ENV` | `development` or `production` | `development` |
| `CLIENT_URL` | frontend origin allowed by CORS | `http://localhost:5173` |
| `MAX_AVATAR_SIZE` | bytes | `2097152` |
| `GEMINI_API_KEY` | AI room assistant, optional ([aistudio.google.com](https://aistudio.google.com); free tier, no billing) | `AIza...` |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS` | optional; default `gemini-flash-lite-latest`, then `gemini-flash-latest` | |

`DATABASE_URL`, `JWT_SECRET` and `RESEND_API_KEY` are required: the server
will not start without them. Never commit `.env` (add it to `.gitignore`); if
it was ever shared, change the JWT secret and database password.

**No email key?** In `development`, when an OTP email cannot be sent (no
key, or Resend's test sender, which only mails the Resend account owner), the
code is printed in the terminal running the backend instead:

```
[dev] Email could not be sent. The register code for you@example.com is: 12345
```

A placeholder such as `RESEND_API_KEY=local-demo-no-email` is enough to start
the server locally. In `production` a failed email is an error, as before.

## Database

`npm run setup-db` (scripts/setup_db.js) creates the database named in
`DATABASE_URL` if missing, runs `schema.sql` on a new database, and on an
existing one runs the migrations:

| File | What |
|---|---|
| `schema.sql` | all tables: `users`, `otps`, `onboarding_responses`, `designs` |
| `migration_wall_height.sql` | `designs.wall_height` (ft, default 8) for older databases |
| `migration_decimals.sql` | room width / length / wall height kept to 4 decimals (were 2) |

Inspect the Docker database:
`docker exec -it roomcraft-db psql -U postgres -d roomcraft`

## API

All bodies are JSON. Routes marked 🔒 need `Authorization: Bearer <token>`.

### Auth and OTP

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/auth/register` | `name, email, password` | sends a 5-digit OTP; password: 8+ characters with a capital letter and a digit |
| POST | `/api/otp/verify-register` | `email, otp` | verifies the account, returns `token` and `user` |
| POST | `/api/otp/resend` | `email, purpose` | `purpose`: `register` or `reset_password` |
| POST | `/api/auth/login` | `email, password` | returns `token` and `user` |
| POST | `/api/auth/forgot-password` | `email` | sends a reset OTP |
| POST | `/api/otp/verify-reset` | `email, otp` | |
| POST | `/api/auth/reset-password` | `email, otp, newPassword` | |

### Profile and onboarding 🔒

| Method | Path | Notes |
|---|---|---|
| GET | `/api/profile` | the signed-in user (the dashboard reads it on load, so a new name or photo shows straight away) |
| PUT | `/api/profile` | update name / profession |
| PUT | `/api/profile/password` | change password |
| POST | `/api/profile/avatar` | multipart upload, form field `avatar`; files served from `/uploads/avatars/`; shown in a circle in the dashboard's top bar |
| POST | `/api/onboarding` | onboarding answers |

### AI room assistant 🔒

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/assistant/plan` | `prompt`, `history?`, `catalog` | `{ spec }`: room type, size, style, floor, wall colours, pieces with placement hints (wall, spot, near), assumptions, an optional question |
| POST | `/api/assistant/chat` | `message`, `history?`, `room`, `catalog` | `{ reply, actions }`: one-tap changes: `set_wall_color`, `set_floor`, `add_furniture`, `remove_furniture`, `furnish_room` |

`catalog` (sent by the frontend) is what the app can draw: furniture types and sizes, room types, styles, floors, paints. The model can only answer with those ids, and every answer is checked against them again (`controllers/assistantController.js`). The model never gives coordinates; the frontend places the pieces (`src/utils/promptRoom.js`).

Gemini is called by `utils/gemini.js`: busy answers are retried, then the other model is tried, within 75 s. Limit: 12 requests a minute per user. Without `GEMINI_API_KEY` both routes answer 503 "not set up"; the rest of the app works. Set `DEBUG_ASSISTANT=1` to log the model's raw chat answers.

### Designs 🔒

| Method | Path | Notes |
|---|---|---|
| POST | `/api/designs` | save a new design, returns `{ design }` (201) |
| GET | `/api/designs` | the user's designs, without furniture (for the dashboard) |
| GET | `/api/designs/:id` | one design, everything included |
| PUT | `/api/designs/:id` | update any of the fields below |
| DELETE | `/api/designs/:id` | |

A design, all lengths in **feet**, room centred on 0, front wall at −z:

```json
{
  "name": "Scanned room",
  "room_type": "bedroom",
  "room_width": 9.37,
  "room_length": 14.72,
  "wall_height": 8.92,
  "style": "cozy",
  "floor_type": "lightWood",
  "wall_colors": { "front": "#f5f5f0", "back": "#f5f5f0", "left": "#f5f5f0", "right": "#f5f5f0" },
  "furniture": [
    { "id": "scan-bed-1", "type": "bed", "name": "Bed (Single)", "width": 3, "depth": 6.25, "height": 3.7,
      "x": 0.83, "z": -0.48, "rotation": -1.5708, "elevation": 0 },
    { "id": "tv-1", "type": "tv", "wallMounted": true, "wall": "left", "position": 2.5, "elevation": 3,
      "width": 4, "depth": 0.18, "height": 2.5, "rotation": 0, "x": 0, "z": 0 }
  ],
  "openings": [
    { "id": "scan-door-1", "type": "door", "wall": "front", "position": -2.9, "width": 2.43, "height": 4.57, "offset": 0 }
  ],
  "connections": []
}
```

`wall_height` is clamped to 8–15 ft. `furniture`, `openings`, `wall_colors`
and `connections` are stored as JSONB, so extra fields are kept.

## Room scan (phone camera)

The frontend's scanner page (`/scan.html`) measures a real room with the
phone and saves it with `POST /api/designs`, using the same login token as
the app. The ceiling height goes into `wall_height`. Nothing extra is needed
on the backend for it.

To use it from a phone, run the frontend with `npm run dev:wifi` (HTTPS on
the Wi-Fi network; the phone's camera AR needs HTTPS). The frontend's dev
server passes every `/api` and `/uploads` request on to this backend at
`http://localhost:5000`, so the phone never talks to port 5000 directly and
`CLIENT_URL` does not need to change.

## Folders

```
app.js            Express app: CORS, JSON, rate limits, routes, errors
index.js          starts the server after the database answers
config/           env.js (required keys), db.js (pg pool)
controllers/      request handlers
models/           SQL queries
routes/           URL -> handler (+ auth / rate-limit middleware)
middleware/       requireAuth (JWT), rate limiters, avatar upload (multer)
utils/            OTP, JWT, email (Resend), user-agent parsing
scripts/          setup_db.js (npm run setup-db)
uploads/avatars/  uploaded avatars (use S3/Cloudinary in production)
```
