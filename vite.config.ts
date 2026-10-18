import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// dist/version.json: the build's release, read without loading the app — by the console's own
// stale-build banner and by the demo hub's /hub/status. The same VITE_* variables that
// src/version.ts compiles in, so the file and the bundle can never disagree. 'unknown' (and
// nulls) when they are unset, as in a dev or plain local build.
function versionJson(): Plugin {
  return {
    name: 'pantry-version-json',
    apply: 'build',
    generateBundle() {
      const env = process.env;
      const body = {
        version: env.VITE_APP_VERSION || 'unknown',
        revision: env.VITE_GIT_SHA || null,
        built_at: env.VITE_BUILD_TIME || null,
      };
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(body, null, 2) + '\n' });
    },
  };
}

// The app is served under /pantry/ in every environment:
//   k8s:      ingress routes /pantry → this app, /pantry/api → pantry-api
//   compose:  nginx.conf proxies /pantry/api → the api container
//   vite dev: the proxy below plays the ingress role
export default defineConfig({
  base: '/pantry/',
  plugins: [react(), versionJson()],
  server: {
    port: 5173,
    proxy: {
      '/pantry/api': {
        target: 'http://localhost:8000',
        rewrite: (path) => path.replace(/^\/pantry\/api/, ''),
      },
      // The demo hub (pantry-platform/demo-hub): MCP explorer, Assistant, simulations, status.
      '/hub': { target: 'http://localhost:8090' },
    },
  },
});
