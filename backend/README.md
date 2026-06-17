# Trainup Backend

Separate Render-ready backend for the Trainup frontend.

## Stack
- Express
- Mongoose
- MongoDB Atlas
- AWS S3 signed uploads
- ElevenLabs TTS proxy

## Local run
1. Copy `.env.example` to `.env`
2. Fill the required variables
3. Run `npm install`
4. Run `npm run dev`

API base path:
- `/api-v1`

Health endpoint:
- `/health`

## Frontend integration
Set the frontend env:

```env
VITE_API_BASE_URL=https://YOUR-RENDER-SERVICE.onrender.com/api-v1
```

If the frontend is deployed on Vercel, make sure `CORS_ORIGINS` includes the live app URLs. The backend also accepts `https://trainup-*.vercel.app` origins for Trainup deployments.

## Notes
- Internal users are seeded automatically on first boot.
- Employee SSO is still pending real Trainup provider details.
