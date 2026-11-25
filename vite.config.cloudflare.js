// Separate config used ONLY for the Cloudflare Workers deploy build (npm run build:cloudflare),
// kept apart from vite.config.js (npm run dev / npm run build) so adding the Cloudflare plugin
// here can't change anything about the team's existing local dev workflow (Express + proxy on
// :3001). Needed because plain `wrangler deploy` silently runs its own "let me set this up for
// you" migration when it detects a Vite project with no @cloudflare/vite-plugin configured,
// which was overwriting wrangler.toml's routing (main, [assets], run_worker_first) with a bare
// static-only config on every CI build — every /api/* call came back a flat 405 as a result.
// Having the plugin already wired in here stops that auto-migration from ever triggering.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'

export default defineConfig({
  plugins: [react(), cloudflare()],
})
