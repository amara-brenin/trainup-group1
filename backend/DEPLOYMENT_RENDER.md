# Render Deployment

## Service type
- Web Service

## Root directory
- `backend`

## Build / start
- Build Command: `npm install`
- Start Command: `npm start`

## Required environment variables
- `AUTH_SECRET`
- `MONGO_URI`
- `CORS_ORIGINS`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_S3_REGION`
- `AWS_S3_BUCKET`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_TTS_MODEL_ID`
- `ELEVENLABS_TTS_VOICE_NAME`
- `ELEVENLABS_TTS_VOICE_ID`

## Frontend change after backend deploy
Set this in the frontend deployment:

```env
VITE_API_BASE_URL=https://YOUR-RENDER-SERVICE.onrender.com/api-v1
```

## Notes
- Keep `CORS_ORIGINS` as a comma-separated list.
- Include the Vercel frontend origin in `CORS_ORIGINS`.
- AWS bucket CORS must also allow `GET`, `HEAD`, and `PUT` from those frontend origins for presigned PDF/PPT/image uploads to work.
- After updating frontend origins, run `npm run s3:cors` in `backend/` with the backend env loaded, or apply the same rule directly on the S3 bucket.
- Employee SSO stays pending until Samsung provider metadata is available.
