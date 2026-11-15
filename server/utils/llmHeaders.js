// utils/llmHeaders.js
//
// The headers every request to the local model runner carries: a Cloudflare Access service token when one is set
// (CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET), and an optional "Name: value" header (LLM_AUTH_HEADER).
// Shared by Jonah (services/assistantAgent) and the import clean-up (services/importEnrich), through services/llmClient.
export function llmHeaders(base = {}) {
  const h = { ...base };
  const cfId = process.env.CF_ACCESS_CLIENT_ID;
  const cfSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (cfId && cfSecret) {
    h["CF-Access-Client-Id"] = cfId;
    h["CF-Access-Client-Secret"] = cfSecret;
  }
  const raw = process.env.LLM_AUTH_HEADER;
  if (raw && raw.includes(":")) {
    const i = raw.indexOf(":");
    h[raw.slice(0, i).trim()] = raw.slice(i + 1).trim();
  }
  return h;
}
