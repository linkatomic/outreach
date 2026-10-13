// GLM (Zhipu) chat completion client — Dev's own self-hosted gateway, not a first-party
// Zhipu/OpenAI endpoint. The gateway is assumed OpenAI-compatible (POST {base}/chat/completions,
// Bearer auth, `choices[0].message.content` response shape) since that's the near-universal
// convention for these proxies, but this hasn't been tested against the real gateway from
// here — if it errors, the first things to check are the exact path and response envelope.
const BASE_URL = process.env.GLM_BASE_URL || 'https://glmapi.amrytt.com:8443/v1'
const MODEL = process.env.GLM_MODEL || 'glm-5.3'

export async function glmComplete(messages, { maxTokens = 700, temperature = 0.3 } = {}) {
  const token = process.env.GLM_API_KEY
  if (!token) throw new Error('GLM API token not configured (GLM_API_KEY)')

  const res = await fetch(`${BASE_URL}/chat/completions`, {
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
  })

  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(body?.error?.message || body?.error || body?.message || `GLM API error ${res.status}`)
  }
  const content = body?.choices?.[0]?.message?.content
  if (!content) throw new Error('GLM API returned no content')
  return content.trim()
}
