// Entry point for Cloudflare's unified Workers (with static assets) deploy model — what
// the dashboard's "Create an app" → connect-a-repo flow offers today, distinct from the
// older, separate Pages product that functions/ (file-based routing) was originally built
// for. Unlike Pages Functions, a plain Worker has no automatic directory-based routing, so
// this does it by hand: match the path against a small table, dispatch to the matching
// api/*.js handler (reusing the exact same Vercel-shaped handlers and adapter functions/
// already has), otherwise fall through to the static build output via the ASSETS binding.
import adminTools from '../api/admin-tools.js'
import adminUsers from '../api/admin-users.js'
import ahrefs from '../api/ahrefs.js'
import crispExport from '../api/crisp-export.js'
import emailHarvester from '../api/email-harvester.js'
import notion from '../api/notion.js'
import personalEmailSender from '../api/personal-email-sender.js'
import missiveEmailLookup from '../api/missive-email-lookup.js'
import missiveExport from '../api/missive-export.js'
import { adaptVercelHandler } from '../functions/_lib/vercelAdapter.js'

const ROUTES = {
  '/api/admin-tools': adaptVercelHandler(adminTools),
  '/api/admin-users': adaptVercelHandler(adminUsers),
  '/api/ahrefs': adaptVercelHandler(ahrefs),
  '/api/crisp-export': adaptVercelHandler(crispExport),
  '/api/email-harvester': adaptVercelHandler(emailHarvester),
  '/api/notion': adaptVercelHandler(notion),
  '/api/personal-email-sender': adaptVercelHandler(personalEmailSender),
  '/api/missive-email-lookup': adaptVercelHandler(missiveEmailLookup),
  '/api/missive-export': adaptVercelHandler(missiveExport),
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url)
    const route = ROUTES[pathname]
    if (route) return route({ request, env, waitUntil: ctx.waitUntil.bind(ctx) })
    return env.ASSETS.fetch(request)
  },
}
