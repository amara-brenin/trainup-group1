# Vercel Deployment

## Stack
- Frontend: Vite + React SPA
- API: Vercel Serverless Functions under `api/`
- Database: MongoDB Atlas
- File storage: AWS S3
- TTS: ElevenLabs via `api/tts.js`

## What is now dynamic
- Internal auth for `super_admin`, `admin`, `trainer`, `reviewer`
- Admin-side clients, users, API keys, webhook config, iframe config
- Trainer/reviewer training workspace persistence
- Slide media upload/resolve/delete through S3 signed URLs

## What is still pending real-provider integration
- Employee Samsung SSO still needs the actual provider details
- Current employee flow remains demo UI until `OIDC` or `SAML` metadata is provided

## Required Vercel environment variables
- `AUTH_SECRET`
- `MONGO_URI`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_S3_REGION`
- `AWS_S3_BUCKET`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_TTS_MODEL_ID`
- `ELEVENLABS_TTS_VOICE_NAME`
- `ELEVENLABS_TTS_VOICE_ID`

## Optional frontend environment variable
- `VITE_API_BASE_URL`
  Leave empty on Vercel so the app uses same-origin `/api`

## Separate Render backend
- A dedicated backend app now exists in `backend/`
- Deploy it on Render with the config in [D:/trainup/render.yaml](D:/trainup/render.yaml)
- Use the env template in [D:/trainup/backend/.env.example](D:/trainup/backend/.env.example)
- After deployment, set:
  - `VITE_API_BASE_URL=https://YOUR-RENDER-SERVICE.onrender.com/api-v1`

## Vercel project settings
1. Import the repository into Vercel.
2. Framework preset: `Vite`
3. Build command: `npm run build`
4. Output directory: `dist`
5. Add the environment variables above for the `Production` environment.
6. Redeploy after saving env vars.

## Local development

### Frontend only mock mode
- `npm run dev`
- Uses the browser-side mock/data fallback for fast UI work

### Full backend parity
- Recommended: use `vercel dev` once the Vercel project is linked
- This allows local `/api/*` routes, MongoDB, and S3 signed-upload testing

## Notes
- `vercel.json` already preserves `/api/*` functions and rewrites all other routes to `index.html` for SPA refresh safety.
- The S3 helper supports swapped AWS credentials if the access key and secret were entered in the opposite env vars by mistake.
- For production security, rotate any credentials that were shared in chat or committed outside Vercel env storage.
