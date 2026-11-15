// server/__tests__/llmClient.test.js — the one OpenAI-compatible client (local LLM plan, Task 2).
import { describe, it, expect, afterEach } from "vitest";
import { buildChatBody, streamChat, chatOnce, reachable } from "../services/llmClient.js";
import { llmHeaders } from "../utils/llmHeaders.js";

const TOOL = { name: "create_board", description: "make a board", input_schema: { type: "object", properties: { name: { type: "string" } } } };

// A fetch whose body arrives as the given byte chunks (split anywhere, mid-line included).
function streamingFetch(chunks, { status = 200, capture } = {}) {
  return async (url, init) => {
    if (capture) capture.push({ url, init });
    const enc = new TextEncoder();
    let i = 0;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => chunks.join(""),
      body: { getReader: () => ({ read: async () => (i < chunks.length ? { value: enc.encode(chunks[i++]), done: false } : { done: true }) }) },
    };
  };
}
const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

describe("buildChatBody", () => {
  it("maps input_schema to parameters and sets cache_prompt", () => {
    const b = buildChatBody({ model: "build", messages: [{ role: "user", content: "hi" }], tools: [TOOL], maxTokens: 50 });
    expect(b.tools[0]).toEqual({ type: "function", function: { name: "create_board", description: "make a board", parameters: TOOL.input_schema } });
    expect(b.cache_prompt).toBe(true);
    expect(b.max_tokens).toBe(50);
    expect(b.stream).toBe(true);
  });
  it("sends no tools key when there are none", () => {
    expect("tools" in buildChatBody({ model: "m", messages: [], tools: [] })).toBe(false);
  });
});

describe("streamChat", () => {
  it("reassembles a tool call split over four chunks", async () => {
    const lines = [
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "create_board", arguments: "" } }] } }] }),
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{\"name\":" } }] } }] }),
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"Quick Links\"," } }] } }] }),
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"folder\":\"Interfaces\"}" } }] } }], timings: { cache_n: 5000, prompt_n: 40 } }),
      "data: [DONE]\n\n",
    ].join("");
    // split the byte stream at awkward places, mid-line
    const chunks = [lines.slice(0, 37), lines.slice(37, 150), lines.slice(150, 151), lines.slice(151)];
    const out = await streamChat({ url: "http://x", body: {}, fetchFn: streamingFetch(chunks) });
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0].id).toBe("c1");
    expect(out.toolCalls[0].function.name).toBe("create_board");
    expect(JSON.parse(out.toolCalls[0].function.arguments)).toEqual({ name: "Quick Links", folder: "Interfaces" });
    expect(out.timings).toEqual({ cache_n: 5000, prompt_n: 40 });
  });

  it("forwards content deltas in order", async () => {
    const got = [];
    const out = await streamChat({
      url: "http://x", body: {}, onToken: (d) => got.push(d),
      fetchFn: streamingFetch([sse({ choices: [{ delta: { content: "Hel" } }] }) + sse({ choices: [{ delta: { content: "lo" } }] }), "data: [DONE]\n\n"]),
    });
    expect(got).toEqual(["Hel", "lo"]);
    expect(out.content).toBe("Hello");
  });

  it("posts to /v1/chat/completions", async () => {
    const cap = [];
    await streamChat({ url: "http://pc:8080", body: { a: 1 }, fetchFn: streamingFetch(["data: [DONE]\n\n"], { capture: cap }) });
    expect(cap[0].url).toBe("http://pc:8080/v1/chat/completions");
    expect(JSON.parse(cap[0].init.body)).toEqual({ a: 1 });
  });

  it("throws with the status on a gateway error", async () => {
    const err = await streamChat({ url: "http://x", body: {}, fetchFn: streamingFetch(["<html><title>A timeout occurred</title></html>"], { status: 524 }) }).catch((e) => e);
    expect(err.status).toBe(524);
    expect(err.message).toContain("A timeout occurred");
  });
});

describe("chatOnce", () => {
  it("returns the message content", async () => {
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "fixed" } }] }) });
    expect(await chatOnce({ url: "http://x", body: {}, fetchFn })).toEqual({ content: "fixed" });
  });
});

describe("reachable", () => {
  it("is true on a 200 from /v1/models", async () => {
    const cap = [];
    expect(await reachable({ url: "http://pc", fetchFn: async (u) => { cap.push(u); return { ok: true }; } })).toBe(true);
    expect(cap[0]).toBe("http://pc/v1/models");
  });
  it("is false when fetch rejects", async () => {
    expect(await reachable({ url: "http://pc", fetchFn: async () => { throw new Error("down"); } })).toBe(false);
  });
  it("is false when nothing answers in time", async () => {
    const t0 = Date.now();
    const hang = (u, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted"))));
    expect(await reachable({ url: "http://pc", timeoutMs: 50, fetchFn: hang })).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe("llmHeaders", () => {
  afterEach(() => { delete process.env.CF_ACCESS_CLIENT_ID; delete process.env.CF_ACCESS_CLIENT_SECRET; delete process.env.LLM_AUTH_HEADER; });
  it("adds CF Access headers when both are set", () => {
    process.env.CF_ACCESS_CLIENT_ID = "id"; process.env.CF_ACCESS_CLIENT_SECRET = "sec";
    expect(llmHeaders({ "Content-Type": "application/json" })).toEqual({ "Content-Type": "application/json", "CF-Access-Client-Id": "id", "CF-Access-Client-Secret": "sec" });
  });
  it("adds one LLM_AUTH_HEADER", () => {
    process.env.LLM_AUTH_HEADER = "X-Key: abc";
    expect(llmHeaders()).toEqual({ "X-Key": "abc" });
  });
});
