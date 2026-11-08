/// <reference types="vite/client" />

// Set only by a release build (Dockerfile ARGs → ENV); src/version.ts falls back to 'unknown'.
interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string;
  readonly VITE_GIT_SHA?: string;
  readonly VITE_BUILD_TIME?: string;
}
