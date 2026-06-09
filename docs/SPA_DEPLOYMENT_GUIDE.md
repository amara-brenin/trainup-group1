# SPA Refresh 404 Fix

## Current setup
- Framework: React 19 + TypeScript
- Build tool: Vite 5
- Router: `react-router-dom` with `createBrowserRouter`
- Routing mode: client-side SPA routing

This app uses browser history routing, so URLs like `/users`, `/clients`, and `/trainer` are handled by the React app after `index.html` loads.

## Why refresh returns 404
When you click links inside the app, React Router handles navigation in the browser, so everything works.

When you refresh `/users` or open it directly, the browser asks the server for a real file at `/users`.
If the hosting platform is not configured for SPA fallback, it looks for that file, cannot find it, and returns `404`.

## Fix
The server must always return `index.html` for unknown routes, so React Router can resolve the route on the client side.

## Files added in this project

### Netlify
- File: `netlify.toml`
- File: `public/_redirects`

Both provide SPA fallback to `index.html`.

### Vercel
- File: `vercel.json`

This rewrites all routes to `index.html`.

### Apache
- File: `public/.htaccess`

Vite copies files from `public/` into `dist/`, so Apache receives the rewrite rules in production output.

### Nginx
- File: `deploy/nginx-spa.conf.example`

Use the included `try_files` rule in your Nginx server block.

## Deployment usage

### Netlify
1. Connect the GitHub repo to Netlify.
2. Build command: `npm run build`
3. Publish directory: `dist`
4. Netlify will automatically apply the redirect from `netlify.toml` or `_redirects`.

### Vercel
1. Import the repo into Vercel.
2. Framework preset can stay as `Vite`.
3. Build command: `npm run build`
4. Output directory: `dist`
5. `vercel.json` will handle SPA rewrites.

### Apache
1. Build the app with `npm run build`.
2. Upload the contents of `dist/` to the Apache web root.
3. Ensure `mod_rewrite` is enabled.
4. The copied `.htaccess` file will route unknown paths to `index.html`.

### Nginx
1. Build the app with `npm run build`.
2. Serve `dist/` as the web root.
3. Apply the config from `deploy/nginx-spa.conf.example`.
4. Reload Nginx.

## Live updates

### Development
- Use `npm run dev`
- Vite already provides hot module replacement, so local changes reflect instantly in the browser

### Production
- Recommended: connect the GitHub repo to Netlify or Vercel
- Then every push to `main` automatically triggers a fresh deployment
- This is the simplest CI/CD path for this project type

### CI
- File: `.github/workflows/ci.yml`
- On every push to `main` and every pull request, GitHub Actions runs `npm ci` and `npm run build`
- This prevents broken deployments from reaching production

## Recommended production flow
1. Develop locally with `npm run dev`
2. Push to GitHub
3. Hosting platform auto-builds and auto-deploys from `main`
4. SPA fallback serves `index.html`
5. React Router resolves the route client-side

## Notes
- No router code change was required because the app is already correctly using client-side routing.
- The issue was deployment/server configuration, not React navigation logic.
- If your live site is already on a specific provider, use the matching config above and redeploy once.
