import { defineConfig } from 'astro/config';

// Static output only. No server runtime, no adapters, no integrations, no analytics.
export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  redirects: {
    '/': '/en/',
  },
  vite: {
    server: { fs: { allow: ['../..'] } },
  },
});
