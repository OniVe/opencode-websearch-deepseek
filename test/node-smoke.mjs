import assert from "node:assert/strict"
import plugin from "../dist/index.js"

function ok(data) {
  return {
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => data,
  }
}

async function setupProvider() {
  let provider
  await plugin.setup({
    options: { apiKey: "smoke-key" },
    websearch: {
      async transform(callback) {
        callback({
          add(value) {
            provider = value
          },
          default: { set() {} },
        })
      },
    },
  })
  assert.equal(typeof provider?.execute, "function", "setup must register a provider")
  return provider
}

const provider = await setupProvider()

globalThis.fetch = async (_url, init) => {
  assert.equal(init.redirect, "error")
  return ok({
    content: [
      {
        type: "text",
        text: "ANSWER",
        citations: [{ url: "https://a.example/x", cited_text: "quote" }],
      },
      {
        type: "web_search_tool_result",
        content: [{ type: "web_search_result", url: "https://a.example/x", title: "A" }],
      },
    ],
  })
}
let results = await provider.execute({ query: "hi" }, {})
assert.equal(results[0].content, "ANSWER")
assert.equal(results[1].url, "https://a.example/x")

globalThis.fetch = async () =>
  ok({
    content: [
      {
        type: "web_search_tool_result",
        content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" },
      },
      {
        type: "web_search_tool_result",
        content: [{ type: "web_search_result", url: "https://", title: "bad" }],
      },
    ],
  })
await assert.rejects(() => provider.execute({ query: "hi" }, {}), /max_uses_exceeded/)

globalThis.fetch = async () =>
  ok({
    content: [
      { type: "text", text: "PARTIAL" },
      {
        type: "web_search_tool_result",
        content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" },
      },
      {
        type: "web_search_tool_result",
        content: [{ type: "web_search_result", url: "https://a.example/x", title: "A" }],
      },
    ],
  })
results = await provider.execute({ query: "hi" }, {})
assert.equal(results[0].content, "PARTIAL")
assert.equal(results[1].url, "https://a.example/x")

const controller = new AbortController()
globalThis.fetch = () => new Promise(() => {})
const call = provider.execute({ query: "hi" }, { signal: controller.signal })
setTimeout(() => controller.abort(new Error("smoke-abort")), 10)
await assert.rejects(
  () => call,
  (error) => error instanceof Error && /smoke-abort/.test(error.message),
)

console.log("node smoke ok")
