# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1A5Xb5ae9D05x_qk0YE3FH8073tPHR147?showAssistant=true&showCode=true&showTreeView=true&showPreview=true&resourceKey=

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Do NOT store API keys in client-side env files. Instead:

   - Create a server-side proxy (example provided in `/server`) and set `GEMINI_API_KEY` in the server environment only.
   - Copy `.env.example` to `.env.local` for local development of the server and fill values there (do not commit `.env.local`).

   ## Secrets in CI / Deploy

   When deploying, store `GEMINI_API_KEY` and `ALLOWED_ORIGIN` in your deployment platform's secrets. Example for GitHub Actions:

   1. Go to Settings → Secrets → Actions in your repository.
   2. Add `GEMINI_API_KEY` and `ALLOWED_ORIGIN`.
   3. Use a workflow like `.github/workflows/smoke-with-secrets.yml` to test a deployment with secrets injected.

   Local quick test:

   ```bash
   cp .env.example .env.local
   # edit .env.local and add GEMINI_API_KEY
   GEMINI_API_KEY="sk_..." ALLOWED_ORIGIN="http://localhost:5173" node server/index.mjs

   Production notes:

   - Ensure you run the server behind a TLS-terminating reverse proxy (nginx, cloud load balancer).
   - Set `NODE_ENV=production` and `ALLOWED_ORIGIN` to a comma-separated list of exact production origins. The server will refuse to start without this in production.
   - We log CSP reports to `/tmp/csp-reports.log` when in report-only mode; consider forwarding these reports into your logging/monitoring system.
   ```

3. Run the app locally

   - Start the server proxy (in a separate terminal):

```bash
cd server
npm install
GEMINI_API_KEY=your_key_here npm start
```

   - Start the client:

```bash
cd ..
npm install
npm run dev
```
