// The console's own release, baked in at build time. build.yml passes APP_VERSION, GIT_SHA and
// BUILD_TIME to the Dockerfile, which exports them as VITE_* before `vite build`; vite.config.ts
// writes the same values to dist/version.json for anything that asks the served console what it
// is (the stale-build banner, the demo hub's /hub/status). A dev server or a plain build has none
// of them and says 'unknown': package.json's 0.0.0 is a placeholder and is never shown, because
// the release number is the git tag (RELEASING.md in pantry-platform).
export const UNKNOWN = 'unknown';

export const CONSOLE_VERSION: string = import.meta.env.VITE_APP_VERSION || UNKNOWN;
export const CONSOLE_REVISION: string | null = import.meta.env.VITE_GIT_SHA || null;
export const CONSOLE_BUILT_AT: string | null = import.meta.env.VITE_BUILD_TIME || null;

// What a served dist/version.json says, or null when it cannot be read.
export interface BuildVersion {
  version: string;
  revision: string | null;
  built_at: string | null;
}
