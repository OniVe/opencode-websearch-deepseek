import { after, before, test } from "node:test"
import assert from "node:assert/strict"

import plugin, {
  ANTHROPIC_VERSION,
  API_URL,
  DEFAULT_MAX_USES,
  buildRequestBody,
  dedupeSources,
  extractAnswerAndSources,
  resolveMaxUses,
  resolveThinking,
  toResults,
} from "../dist/index.js"

const ENV_KEYS = [
  "DEEPSEEK_API_KEY",
  "WEBSEARCH_API_KEY",
  "WEBSEARCH_MODEL",
  "WEBSEARCH_MAX_USES",
  "WEBSEARCH_THINKING",
]

const savedEnv = {}
const savedFetch = globalThis.fetch

before(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
})

after(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  globalThis.fetch = savedFetch
})

test("resolveMaxUses defaults to 5 and accepts a positive override", () => {
  assert.equal(resolveMaxUses(undefined), DEFAULT_MAX_USES)
  assert.equal(resolveMaxUses(""), DEFAULT_MAX_USES)
  assert.equal(resolveMaxUses(" 12 "), 12)
  assert.equal(resolveMaxUses("0"), DEFAULT_MAX_USES)
  assert.equal(resolveMaxUses("-3"), DEFAULT_MAX_USES)
  assert.equal(resolveMaxUses("nope"), DEFAULT_MAX_USES)
  assert.equal(resolveMaxUses("5abc"), DEFAULT_MAX_USES)
  assert.equal(resolveMaxUses("5.5"), DEFAULT_MAX_USES)
  assert.equal(resolveMaxUses("1e3"), DEFAULT_MAX_USES)
  assert.equal(resolveMaxUses("999999999999999999999999"), DEFAULT_MAX_USES)
})

test("resolveThinking is enabled unless explicitly disabled", () => {
  assert.equal(resolveThinking(undefined), "enabled")
  assert.equal(resolveThinking("enabled"), "enabled")
  assert.equal(resolveThinking("DISABLED"), "disabled")
  assert.equal(resolveThinking("off"), "disabled")
  assert.equal(resolveThinking("false"), "disabled")
  assert.equal(resolveThinking("0"), "disabled")
})

test("buildRequestBody declares the search tool with max_uses", () => {
  const body = buildRequestBody("hello", { model: "m", maxUses: 7, thinking: "enabled" })
  assert.equal(body.model, "m")
  assert.deepEqual(body.tools, [{ type: "web_search_20250305", name: "web_search", max_uses: 7 }])
  assert.deepEqual(body.tool_choice, { type: "auto" })
  assert.deepEqual(body.thinking, { type: "enabled" })
  assert.equal(typeof body.system, "string")
  assert.deepEqual(body.messages, [{ role: "user", content: "hello" }])
})

test("buildRequestBody omits thinking when disabled", () => {
  const body = buildRequestBody("hello", { model: "m", maxUses: 5, thinking: "disabled" })
  assert.equal("thinking" in body, false)
})

test("dedupeSources merges duplicate URLs and drops invalid ones", () => {
  const sources = [
    { url: "https://a", title: "A" },
    { url: "https://b" },
    { url: "https://a", title: "A again", content: "snippet" },
    { url: 123 },
    { url: "" },
  ]
  assert.deepEqual(dedupeSources(sources), [
    { url: "https://a", title: "A", content: "snippet" },
    { url: "https://b" },
  ])
})

test("extractAnswerAndSources joins text and de-duplicates sources", () => {
  const { answer, sources } = extractAnswerAndSources({
    content: [
      { type: "text", text: "First paragraph." },
      {
        type: "web_search_tool_result",
        content: [
          { type: "web_search_result", url: "https://a", title: "A" },
          { type: "web_search_result", url: "https://b", title: "B" },
        ],
      },
      { type: "text", text: "Second paragraph." },
      {
        type: "web_search_tool_result",
        content: [{ type: "web_search_result", url: "https://a", title: "A duplicate" }],
      },
    ],
  })
  assert.equal(answer, "First paragraph.\n\nSecond paragraph.")
  assert.deepEqual(sources, [
    { url: "https://a", title: "A" },
    { url: "https://b", title: "B" },
  ])
})

test("extractAnswerAndSources tolerates hostile payloads and reads citation snippets", () => {
  assert.deepEqual(extractAnswerAndSources({ content: 42 }), { answer: "", sources: [] })
  assert.deepEqual(extractAnswerAndSources({ content: "oops" }), { answer: "", sources: [] })
  assert.deepEqual(extractAnswerAndSources({ content: null }), { answer: "", sources: [] })
  assert.deepEqual(extractAnswerAndSources({}), { answer: "", sources: [] })

  const { sources } = extractAnswerAndSources({
    content: [
      { type: "text", text: "Answer.", citations: [{ url: "https://a", cited_text: "quoted text" }] },
      {
        type: "web_search_tool_result",
        content: [{ type: "web_search_result", url: "https://a", title: "A" }],
      },
    ],
  })
  assert.deepEqual(sources, [{ url: "https://a", title: "A", content: "quoted text" }])
})

test("toResults returns the answer first, then sources, and never empty", () => {
  const results = toResults("answer", [{ url: "https://a", title: "A" }])
  assert.equal(results.length, 2)
  assert.equal(results[0].url, "https://a")
  assert.equal(results[0].title, "DeepSeek answer")
  assert.equal(results[0].content, "answer")

  const empty = toResults("", [])
  assert.equal(empty.length, 1)
  assert.equal(empty[0].title, "DeepSeek web search")

  // `sources` is optional; toResults must stay total when called directly.
  assert.equal(toResults("answer").length, 1)
  assert.equal(toResults("answer", undefined).length, 1)
})

/**
 * Register the plugin against a fake context and return the captured provider.
 */
async function register() {
  let captured
  const fake = {
    websearch: {
      async transform(callback) {
        callback({
          add(provider) {
            captured = provider
          },
          default: { set() {} },
        })
      },
    },
  }
  await plugin.setup(fake)
  assert.ok(captured, "setup() must register a provider")
  return captured
}

test("setup registers the DeepSeek provider", async () => {
  const provider = await register()
  assert.equal(provider.id, "deepseek")
  assert.equal(provider.name, "DeepSeek Web Search")
})

test("execute sends the API key, version header, and improvements", async () => {
  const provider = await register()

  process.env.DEEPSEEK_API_KEY = "test-key"
  delete process.env.WEBSEARCH_API_KEY
  process.env.WEBSEARCH_MAX_USES = "9"
  process.env.WEBSEARCH_THINKING = "disabled"
  delete process.env.WEBSEARCH_MODEL

  let seen
  globalThis.fetch = async (url, init) => {
    seen = { url, init }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [
          { type: "text", text: "The answer.", citations: [{ url: "https://a", cited_text: "snippet" }] },
          {
            type: "web_search_tool_result",
            content: [
              { type: "web_search_result", url: "https://a", title: "A" },
              { type: "web_search_result", url: "https://a", title: "A dup" },
            ],
          },
        ],
      }),
      text: async () => "",
    }
  }

  const results = await provider.execute({ query: "hi" }, {})

  assert.equal(seen.url, API_URL)
  assert.equal(seen.init.headers["anthropic-version"], ANTHROPIC_VERSION)
  assert.equal(seen.init.headers["x-api-key"], "test-key")

  const body = JSON.parse(seen.init.body)
  assert.equal(body.model, "deepseek-v4-flash")
  assert.equal(body.tools[0].max_uses, 9)
  assert.equal("thinking" in body, false)
  assert.equal(typeof body.system, "string")
  assert.deepEqual(body.messages, [{ role: "user", content: "hi" }])

  assert.equal(results.length, 2)
  assert.equal(results[0].content, "The answer.")
  assert.equal(results[1].url, "https://a")
  assert.equal(results[1].content, "snippet")
})

test("execute fails fast without an API key", async () => {
  const provider = await register()
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.WEBSEARCH_API_KEY
  await assert.rejects(() => provider.execute({ query: "hi" }, {}), /DEEPSEEK_API_KEY/)
})
