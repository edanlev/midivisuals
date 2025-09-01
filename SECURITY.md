## Secrets and API keys

Store all API keys and secrets outside the repository using your platform's secret storage.

- For local development, copy `.env.example` to `.env.local` and _do not commit_ `.env.local`.
- For CI/CD and production, use repository or platform secrets (GitHub Secrets, Vercel/Netlify environment variables, Docker secrets, etc.).

Examples:

- GitHub Actions: add `GEMINI_API_KEY` and `ALLOWED_ORIGIN` in the repository Settings → Secrets → Actions.
- Vercel/Netlify: add the same keys in the project settings under Environment Variables.

Never embed or commit secrets in `vite.config.ts`, source files, or HTML.

Rotate keys regularly and restrict them by scope/allowed origins or IPs if the provider supports it.

Server & deploy notes:

- The server now enforces HSTS for HTTPS deployments using Helmet.
- A CSP report-only endpoint is available at `/csp-report` and logs reports to `/tmp/csp-reports.log`.
- In production `NODE_ENV=production` the server requires `ALLOWED_ORIGIN` to be set to exact origins (no `*`).
