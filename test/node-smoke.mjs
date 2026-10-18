import assert from "node:assert/strict"
import plugin from "../dist/index.js"

async function setupProvider(options = { apiKey: "smoke-key" }) {
  let provider
  await plugin.setup({
    options,
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

const provider = await setupProvider({ searchApi: "messages", apiKey: "smoke-key" })

globalThis.fetch = async (_url, init) => {
  assert.equal(init.redirect, "error")
  return new Response(
    JSON.stringify({
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
    }),
    { status: 200 },
  )
}
let results = await provider.execute({ query: "hi" }, {})
assert.equal(results[0].content, "ANSWER")
assert.equal(results[1].url, "https://a.example/x")

globalThis.fetch = async () =>
  new Response(
    JSON.stringify({
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
    }),
    { status: 200 },
  )
await assert.rejects(() => provider.execute({ query: "hi" }, {}), /max_uses_exceeded/)

globalThis.fetch = async () =>
  new Response(
    JSON.stringify({
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
    }),
    { status: 200 },
  )
results = await provider.execute({ query: "hi" }, {})
assert.equal(results[0].content, "PARTIAL")
assert.equal(results[1].url, "https://a.example/x")

let errorPulls = 0
const errorStream = new ReadableStream({
  pull(controller) {
    errorPulls++
    if (errorPulls > 100) {
      controller.close()
      return
    }
    controller.enqueue(new TextEncoder().encode("E".repeat(1024)))
  },
})
globalThis.fetch = async () => new Response(errorStream, { status: 500 })
await assert.rejects(
  () => provider.execute({ query: "hi" }, {}),
  (error) => error instanceof Error && error.message.length <= 330 && /E{10}/.test(error.message),
)
assert.ok(errorPulls >= 64 && errorPulls <= 66, `errorPulls=${errorPulls}`)

const native = await setupProvider({ searchApi: "native", apiKey: "smoke-key", count: 1 })
globalThis.fetch = async () =>
  new Response(
    JSON.stringify({
      results: [{ url: "https://native.example/x", title: "N", summary: "S" }],
    }),
    { status: 200 },
  )
const nativeResults = await native.execute({ query: "hi" }, {})
assert.equal(nativeResults[0].url, "https://native.example/x")
assert.equal(nativeResults[0].content, "S")

const controller = new AbortController()
globalThis.fetch = () => new Promise(() => {})
const call = provider.execute({ query: "hi" }, { signal: controller.signal })
setTimeout(() => controller.abort(new Error("smoke-abort")), 10)
await assert.rejects(
  () => call,
  (error) => error instanceof Error && /smoke-abort/.test(error.message),
)

console.log("node smoke ok")
