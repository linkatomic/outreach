// Lets every existing api/*.js file — written as Vercel-style
// `export default async function handler(req, res)` — run unchanged as a Cloudflare
// Pages Function. This is the ONLY platform-specific piece; all business logic stays in
// api/*.js so the same source still works if this app is ever redeployed on Vercel again.
//
// Two things a Vercel Node function gets for free that a Workers-based Pages Function
// does not, and that every api/*.js file (and its _lib helpers) relies on:
//
// 1. `process.env.X` — Workers has no ambient Node `process` global at all. We fake one
//    and populate it from Cloudflare's per-request `context.env` before calling the
//    handler, so every `process.env.FOO` read inside api/*.js keeps working verbatim.
//    This only covers reads that happen INSIDE a function body at request time — a
//    `process.env.FOO` read at a file's top level would run once at module-graph
//    instantiation (cold start), before any request (and so before this shim runs) even
//    exists. api/notion.js, api/ahrefs.js and api/_lib/supabaseAdmin.js originally read
//    env vars that way and were changed to read them lazily, inside a function, to work
//    with this adapter — see those files' comments.
//
// 2. `req`/`res` shaped like Node's http.IncomingMessage/ServerResponse. We build a
//    minimal req (method, headers, query, body) from the Fetch API Request Cloudflare
//    hands us, and a minimal res (status/json/end) that resolves a real Response once
//    the handler calls one of them — every api/*.js handler always calls exactly one of
//    res.json(...)/res.end() on every code path, so this never hangs.
export function adaptVercelHandler(handler) {
  return async function onRequest(context) {
    const { request, env } = context

    globalThis.process = globalThis.process && typeof globalThis.process === 'object'
      ? globalThis.process
      : {}
    globalThis.process.env = env

    const url = new URL(request.url)
    const query = Object.fromEntries(url.searchParams)
    const headers = Object.fromEntries(request.headers)

    let body
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      try {
        const text = await request.text()
        body = text ? JSON.parse(text) : {}
      } catch {
        body = {}
      }
    }

    const req = { method: request.method, headers, query, body }

    let resolveResponse
    const responsePromise = new Promise(resolve => { resolveResponse = resolve })
    let statusCode = 200

    const res = {
      status(code) {
        statusCode = code
        return res
      },
      json(obj) {
        resolveResponse(new Response(JSON.stringify(obj), {
          status: statusCode,
          headers: { 'content-type': 'application/json' },
        }))
        return res
      },
      end() {
        resolveResponse(new Response(null, { status: statusCode }))
        return res
      },
    }

    try {
      await handler(req, res)
    } catch (err) {
      console.error('[vercelAdapter] unhandled error', err)
      resolveResponse(new Response(JSON.stringify({ error: err?.message || 'Unexpected error' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }))
    }

    return responsePromise
  }
}
