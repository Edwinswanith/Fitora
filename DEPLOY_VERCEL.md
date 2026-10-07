# Deploying Fitora to Vercel

One Vercel project serves both the web app and the API from the same domain
(currently `https://fitora-psi.vercel.app`, which the native apps already call
via `EXPO_PUBLIC_API_URL` in `mobile/eas.json`).

Everything Vercel needs is already in the repo:

| File | What it does |
|---|---|
| `vercel.json` | Build/install commands, Next.js framework, the 7 daily notification crons |
| `scripts/vercel-build.mjs` | Exports the Expo app to static web, copies legal pages, wires `backend/pages` and `backend/next.config.vercel.js`, runs `next build` |
| `backend/pages/api/[...path].ts` | Sends every `/api/*` request into the Express app in `server/` |
| `backend/pages/api/cron/notifications-sweep.ts` | Cron target, guarded by `CRON_SECRET` |
| `backend/pages/api/health.ts` | `GET /api/health` shows which required settings are present |

Verified locally: `npm run vercel-build` succeeds and the API function is about
7 MB (Vercel's limit is 250 MB).

---

## 1. Project settings (Vercel dashboard > Project > Settings)

- **Git**: connect the GitHub repo and set the **Production Branch** to the
  branch you deploy from (merge `claude/inspiring-knuth-2vf3ft` into `main`
  first, or pick it here).
- **Build & Development**: leave everything on "Override: off". `vercel.json`
  already sets the build command (`npm run vercel-build`), install command and
  framework (Next.js). Root Directory must be the repo root (empty).
- **Node.js Version**: 20.x or 22.x.

## 2. Environment variables (Settings > Environment Variables, scope: Production)

Required, or the API refuses to start:

| Name | Value |
|---|---|
| `MONGODB_URI` | Atlas connection string |
| `MONGODB_DB` | Database name, e.g. `fitora` |
| `JWT_ACCESS_SECRET` | Long random string (generate below) |
| `JWT_REFRESH_SECRET` | A *different* long random string |
| `CRON_SECRET` | Another long random string; Vercel sends it to the cron route |

Generate each secret with:

```
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Do not rely on `AUTH_SECRET` alone: it would make all three secrets the same value.

Uploads (required for avatars, photos and videos to survive; see section 4):

| Name | Value |
|---|---|
| `OBJECT_STORAGE_BUCKET` | e.g. `fitora-uploads-coaching-467814` |
| `OBJECT_STORAGE_PREFIX` | `uploads/` |
| `GCS_SERVICE_ACCOUNT_JSON` | Full contents of the key file from section 4 |
| `MAX_UPLOAD_SIZE_MB` | `4` (Vercel rejects request bodies over 4.5 MB) |

Sign-in:

| Name | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | Comma-separated: web, Android and iOS client IDs |
| `APPLE_CLIENT_ID` | iOS bundle id `app.fitora.coaching` (if Sign in with Apple is used) |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Web client ID, read at build time by the web app |
| `EXPO_PUBLIC_SITE_URL` | `https://fitora-psi.vercel.app` |

Optional features (each is off when unset): `GEMINI_API_KEY` (Ask Agent, meal
scan, workout-photo conversion), `FCM_PROJECT_ID` + `FCM_SERVICE_ACCOUNT_JSON`
(push notifications), `DEEP_GRAM` (voice), `LIVEKIT_API_KEY` +
`LIVEKIT_API_SECRET` + `LIVEKIT_URL` (video calls). Leave all `RAZORPAY_*`
unset and do not set `EXPO_PUBLIC_PAYMENTS_ENABLED` while payments are off.

Changing a variable only takes effect on the **next deploy** (Deployments >
latest > Redeploy).

## 3. MongoDB Atlas network access

Vercel functions have no fixed IP address. In Atlas > Network Access, allow
`0.0.0.0/0`, and make sure the database user has a long random password. (A
fixed IP needs Vercel's paid Secure Compute.)

## 4. Upload storage on Vercel

Vercel's disk is temporary, so uploads must go to Google Cloud Storage. Unlike
Cloud Run, Vercel is not a Google identity, so it needs a service-account key.
Run in a terminal with `gcloud` (Windows `cmd` shown; one command per line):

```
gcloud config set project coaching-467814
gcloud storage buckets create gs://fitora-uploads-coaching-467814 --location=asia-south1 --uniform-bucket-level-access --public-access-prevention
gcloud iam service-accounts create fitora-vercel-storage --display-name="Fitora Vercel uploads"
gcloud storage buckets add-iam-policy-binding gs://fitora-uploads-coaching-467814 --member=serviceAccount:fitora-vercel-storage@coaching-467814.iam.gserviceaccount.com --role=roles/storage.objectAdmin
gcloud iam service-accounts keys create fitora-vercel-key.json --iam-account=fitora-vercel-storage@coaching-467814.iam.gserviceaccount.com
```

(Skip the bucket line if you already created it.) Open `fitora-vercel-key.json`,
copy its entire contents into the `GCS_SERVICE_ACCOUNT_JSON` variable, then
**delete the file** and never commit it. The account can only touch this one
bucket. If key creation fails with an organization-policy error, your Google
Cloud organization blocks keys; an admin has to allow it for this project.

## 5. Deploy

Push to the production branch (or click Redeploy). The build takes a few
minutes because it exports the whole Expo web app.

## 6. Check it

1. `https://fitora-psi.vercel.app/api/health`: every `checks` value should be `true`
   (Google/Apple are false only if you don't use them).
2. Open the site, sign in, change your avatar, then redeploy: the avatar must
   still be there. Confirm with `gcloud storage ls gs://fitora-uploads-coaching-467814/uploads/`.
3. Vercel > Project > Logs: no `[objectStorage] WARNING` line.
4. Vercel > Project > Settings > Cron Jobs: 7 jobs listed. Hobby plans run each
   one once a day at a time within the scheduled hour.
5. After any deploy that changes a database schema, run once from `server/`
   with production `MONGODB_URI`: `npx ts-node src/scripts/verify-indexes.ts`
   (the Vercel API skips waiting for index builds to keep cold starts fast).

## Known limits on Vercel

- **Uploads over 4.5 MB fail** (Vercel returns `413 FUNCTION_PAYLOAD_TOO_LARGE`
  before the request reaches the API). Avatars are compressed and fit; meal-scan
  and chat photos straight from a modern camera often do not; coach videos
  almost never do. Fix: upload directly from the app to Cloud Storage with a
  signed URL instead of through the API. Until then, either keep the API on
  Cloud Run for uploads or accept the limit.
- Video *playback* is fine: responses stream, so the 4.5 MB limit does not apply.
- Cold starts: the first request after idle takes a few seconds (app import +
  database connect). Later requests are fast.
- Native apps are built against `EXPO_PUBLIC_API_URL` in `mobile/eas.json`. If
  the Vercel domain changes (e.g. a custom domain), update it there and rebuild.
