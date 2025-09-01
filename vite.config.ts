import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      // IMPORTANT: Do NOT embed secrets directly into the client bundle.
      // The GEMINI_API_KEY was previously inlined here which exposes it to anyone
      // who loads the site. Keep secrets on a server-side proxy or use Vite's
      // server environment and only expose safe, intentionally public variables
      // using the VITE_ prefix (e.g. VITE_PUBLIC_API_URL).
      // define: { ... } removed intentionally.
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        target: 'es2022',
        chunkSizeWarningLimit: 400,
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (id.includes('node_modules')) {
                if (id.includes('three')) return 'vendor_three';
                return 'vendor';
              }
            }
          }
        }
      }
    };
});
