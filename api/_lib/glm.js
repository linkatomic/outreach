// GLM (Zhipu) chat completion client — Dev's own self-hosted gateway, not a first-party
// Zhipu/OpenAI endpoint. The gateway is assumed OpenAI-compatible (POST {base}/chat/completions,
// Bearer auth, `choices[0].message.content` response shape) since that's the near-universal
// convention for these proxies, but this hasn't been tested against the real gateway from
// here — if it errors, the first things to check are the exact path and response envelope.
const BASE_URL = process.env.GLM_BASE_URL || 'https://glmapi.amrytt.com:8443/v1'
const MODEL = process.env.GLM_MODEL || 'glm-5.3'

// A real run hit a 504 from Vercel itself with no application-level error at all — the
// function was killed by the platform mid-completion rather than failing cleanly. Bounding
// this fetch under the function's own maxDuration converts that into a clear, catchable
// timeout instead of an opaque platform kill with no message. The gateway runs on local
// hardware and is expected to be genuinely slow (not broken) — Vercel's Hobby plan hard-caps
// any single function invocation at 60s regardless, so a completion that takes longer than
// one bounded attempt can't succeed in one shot no matter how patient the caller is willing
// to be. `err.isTimeout` lets callers treat "still generating, try again" as a distinct,
// non-broken outcome rather than a failure — summarizeAndPostReply/summarizeReplies use this
// to let the Tracking page retry on the next "Check replies" click instead of just failing.
export async function glmComplete(messages, { maxTokens = 700, temperature = 0.3, timeoutMs = 50000 } = {}) {
  const token = process.env.GLM_API_KEY
  if (!token) throw new Error('GLM API token not configured (GLM_API_KEY)')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
      signal: controller.signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error(`Still generating after ${Math.round(timeoutMs / 1000)}s — will retry`)
      timeoutErr.isTimeout = true
      throw timeoutErr
    }
    throw err
  } finally {
    clearTimeout(timer)
  }

  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(body?.error?.message || body?.error || body?.message || `GLM API error ${res.status}`)
  }
  const content = body?.choices?.[0]?.message?.content
  if (!content) throw new Error('GLM API returned no content')
  return content.trim()
}
