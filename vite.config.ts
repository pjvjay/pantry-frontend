import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app is served under /pantry/ in every environment:
//   k8s:      ingress routes /pantry → this app, /pantry/api → pantry-api
//   compose:  nginx.conf proxies /pantry/api → the api container
//   vite dev: the proxy below plays the ingress role
export default defineConfig({
  base: '/pantry/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/pantry/api': {
        target: 'http://localhost:8000',
        rewrite: (path) => path.replace(/^\/pantry\/api/, ''),
      },
    },
  },
});
