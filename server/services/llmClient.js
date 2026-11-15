// services/llmClient.js
//
// THE ONE CLIENT FOR THE LOCAL MODEL RUNNER. llama-server (behind llama-swap) speaks the OpenAI chat API, and so does
// Ollama, so this is the only shape the server sends: /v1/chat/completions with tools and SSE streaming, /v1/models
// for "is it up". Spec: docs/superpowers/specs/2026-11-15-local-llm-runner-design.md.
//
// `cache_prompt: true` asks llama-server to reuse the longest prefix it already read. It only pays off when the
// request STARTS with the same bytes every time — see assistantAgent's composeChat for how the prompt is ordered.
import { llmHeaders } from "../utils/llmHeaders.js";

const JSON_HEADERS = () => llmHeaders({ "Content-Type": "application/json" });

/** OpenAI-style request body. Pure. `tools` is the app's tool list ({name, description, input_schema}). */
export function buildChatBody({ model, messages, tools = [], stream = true, maxTokens } = {}) {
  const body = { model, messages, stream, cache_prompt: true };
  if (maxTokens != null) body.max_tokens = maxTokens;
  if (Array.isArray(tools) && tools.length) {
    body.tools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  }
  return body;
}

// A gateway in front of the PC (Cloudflare) answers an error with a whole HTML page. Keep its <title> (or the first
// line of plain text) so a failure reads as one sentence in the chat instead of a page of markup.
export function summarizeHttpError(body) {
  const text = String(body || "");
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(text)?.[1]?.trim();
  if (title) return title;
  const plain = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return plain.length > 200 ? plain.slice(0, 200) + "…" : plain;
}

async function httpError(res) {
  const err = new Error(`Model runner ${res.status}: ${summarizeHttpError(await res.text())}`);
  err.status = res.status;
  return err;
}

/**
 * Stream one completion. Content deltas go to `onToken` as they arrive. A tool call arrives in FRAGMENTS — id and name
 * on the first, `arguments` as pieces of a JSON string after — keyed by `index`; they are joined here, and `arguments`
 * is returned still as a string (the caller parses it, as it does a call recovered from text).
 * @returns {{ content: string, toolCalls: Array<{id, function:{name, arguments}}>, timings: object|null }}
 */
export async function streamChat({ url, body, signal, onToken, fetchFn = globalThis.fetch }) {
  const res = await fetchFn(`${url}/v1/chat/completions`, { method: "POST", headers: JSON_HEADERS(), body: JSON.stringify(body), signal });
  if (!res.ok) throw await httpError(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", content = "", timings = null;
  const calls = [];
  const take = (line) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let obj;
    try { obj = JSON.parse(data); } catch { return; }
    if (obj.timings) timings = obj.timings;
    const delta = obj.choices?.[0]?.delta || {};
    if (delta.content) { content += delta.content; onToken?.(delta.content); }
    for (const tc of delta.tool_calls || []) {
      const i = Number.isInteger(tc.index) ? tc.index : calls.length;
      const c = calls[i] || (calls[i] = { id: null, function: { name: "", arguments: "" } });
      if (tc.id) c.id = tc.id;
      if (tc.function?.name) c.function.name += tc.function.name;
      if (tc.function?.arguments) c.function.arguments += tc.function.arguments;
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      take(line);
    }
  }
  take(buf.trim());
  return { content, toolCalls: calls.filter(Boolean), timings };
}

/** One completion, not streamed. @returns {{ content: string }} */
export async function chatOnce({ url, body, signal, fetchFn = globalThis.fetch }) {
  const res = await fetchFn(`${url}/v1/chat/completions`, { method: "POST", headers: JSON_HEADERS(), body: JSON.stringify({ ...body, stream: false }), signal });
  if (!res?.ok) throw await httpError(res);
  const j = await res.json();
  return { content: String(j?.choices?.[0]?.message?.content || "") };
}

/** Is the runner up? Short timeout — a PC that is asleep must not stall the chat. */
export async function reachable({ url, timeoutMs = 800, fetchFn = globalThis.fetch }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${url}/v1/models`, { signal: ctrl.signal, headers: llmHeaders() });
    return !!res?.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}
