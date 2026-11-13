/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite + React config.
//
// `base` is the public path the built assets are served from. On GitHub Pages a
// PROJECT site is served from `https://<user>.github.io/<repo>/`, so the base
// must be `/<repo>/` or the JS/CSS 404 at the subpath. In CI we derive `<repo>`
// from GITHUB_REPOSITORY ("owner/repo") so the name is never hardcoded; locally
// (dev / preview) the base stays "/". An explicit VITE_BASE env var overrides
// both when needed.
//
// We read env off globalThis.process rather than the bare `process` global so
// the config type-checks without @types/node (the build runs tsc first).
function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

function resolveBase(): string {
  const explicit = readEnv('VITE_BASE');
  if (explicit) return explicit;
  const repo = readEnv('GITHUB_REPOSITORY');
  if (repo && repo.includes('/')) {
    const name = repo.split('/')[1];
    return `/${name}/`;
  }
  return '/';
}

export default defineConfig({
  base: resolveBase(),
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
