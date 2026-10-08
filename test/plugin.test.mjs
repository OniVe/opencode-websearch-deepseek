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
  // Numeric input (from plugin options) is accepted; other types stay total.
  assert.equal(resolveMaxUses(42), 42)
  assert.equal(resolveMaxUses(0), DEFAULT_MAX_USES)
  assert.equal(resolveMaxUses(-3), DEFAULT_MAX_USES)
  assert.equal(resolveMaxUses(null), DEFAULT_MAX_USES)
})

test("resolveThinking is enabled unless explicitly disabled", () => {
  assert.equal(resolveThinking(undefined), "enabled")
  assert.equal(resolveThinking("enabled"), "enabled")
  assert.equal(resolveThinking("DISABLED"), "disabled")
  assert.equal(resolveThinking("off"), "disabled")
  assert.equal(resolveThinking("false"), "disabled")
  assert.equal(resolveThinking("0"), "disabled")
  assert.equal(resolveThinking(0), "enabled")
  assert.equal(resolveThinking(null), "enabled")
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

test("execute is total when the context argument is omitted", async () => {
  const provider = await register()
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.WEBSEARCH_API_KEY
  await assert.rejects(() => provider.execute({ query: "hi" }), /DEEPSEEK_API_KEY/)
})

test("execute rejects an API key with control characters", async () => {
  const provider = await register()
  process.env.DEEPSEEK_API_KEY = "bad\nkey"
  await assert.rejects(() => provider.execute({ query: "hi" }, {}), /invalid characters/)
})

test("execute surfaces a non-2xx body", async () => {
  const provider = await register()
  process.env.DEEPSEEK_API_KEY = "test-key"
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    text: async () => "boom".repeat(200),
    json: async () => ({}),
  })
  await assert.rejects(() => provider.execute({ query: "hi" }, {}), /DeepSeek API error 500: boom/)
})

test("execute preserves an AbortError on a non-2xx body", async () => {
  const provider = await register()
  process.env.DEEPSEEK_API_KEY = "test-key"
  const abortError = new Error("aborted")
  abortError.name = "AbortError"
  const controller = new AbortController()
  controller.abort(abortError)
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    text: async () => {
      throw abortError
    },
    json: async () => ({}),
  })
  await assert.rejects(
    () => provider.execute({ query: "hi" }, { signal: controller.signal }),
    (error) => error?.name === "AbortError",
  )
})

test("execute preserves a custom abort reason on a non-2xx body", async () => {
  const provider = await register()
  process.env.DEEPSEEK_API_KEY = "test-key"
  const controller = new AbortController()
  const reason = new Error("custom cancel")
  controller.abort(reason)
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    text: async () => {
      throw reason
    },
    json: async () => ({}),
  })
  await assert.rejects(
    () => provider.execute({ query: "hi" }, { signal: controller.signal }),
    /custom cancel/,
  )
})

test("execute preserves cancellation when the non-2xx body resolves after abort", async () => {
  const provider = await register()
  process.env.DEEPSEEK_API_KEY = "test-key"
  const controller = new AbortController()
  const reason = new Error("late cancel")
  controller.abort(reason)
  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
    text: async () => "partial body",
    json: async () => ({}),
  })
  await assert.rejects(
    () => provider.execute({ query: "hi" }, { signal: controller.signal }),
    /late cancel/,
  )
})

test("execute preserves an AbortError from the body read when the signal is not aborted", async () => {
  const provider = await register()
  process.env.DEEPSEEK_API_KEY = "test-key"
  const abortError = new Error("aborted while reading")
  abortError.name = "AbortError"
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    text: async () => {
      throw abortError
    },
    json: async () => ({}),
  })
  await assert.rejects(
    () => provider.execute({ query: "hi" }, {}),
    (error) => error?.name === "AbortError",
  )
})

test("execute normalises a primitive abort reason to an Error", async () => {
  const provider = await register()
  process.env.DEEPSEEK_API_KEY = "test-key"
  const controller = new AbortController()
  controller.abort("cancel-string")
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    text: async () => "body",
    json: async () => ({}),
  })
  await assert.rejects(
    () => provider.execute({ query: "hi" }, { signal: controller.signal }),
    (error) => error instanceof Error && /cancel-string/.test(error.message),
  )
})

test("execute reuses the stored DeepSeek credential when no env key is set", async () => {
  let captured
  const fake = {
    websearch: {
      async transform(callback) {
        callback({ add(provider) { captured = provider }, default: { set() {} } })
      },
    },
    integration: {
      connection: {
        active: async (id) => (id === "deepseek" ? { type: "credential", id: "cred_1" } : undefined),
        resolve: async () => ({ type: "api", key: "sk-stored-key" }),
      },
    },
  }
  await plugin.setup(fake)
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.WEBSEARCH_API_KEY

  let seen
  globalThis.fetch = async (url, init) => {
    seen = init
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: "text", text: "stored ok" }] }),
      text: async () => "",
    }
  }
  const results = await captured.execute({ query: "hi" }, {})
  assert.equal(seen.headers["x-api-key"], "sk-stored-key")
  assert.equal(results[0].content, "stored ok")
})

test("environment key takes precedence over the stored credential", async () => {
  let captured
  let resolveCalls = 0
  const fake = {
    websearch: {
      async transform(callback) {
        callback({ add(provider) { captured = provider }, default: { set() {} } })
      },
    },
    integration: {
      connection: {
        active: async () => {
          resolveCalls++
          return { type: "credential" }
        },
        resolve: async () => {
          resolveCalls++
          return { key: "sk-stored" }
        },
      },
    },
  }
  await plugin.setup(fake)
  process.env.DEEPSEEK_API_KEY = "sk-env"

  let seen
  globalThis.fetch = async (url, init) => {
    seen = init
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: "text", text: "env ok" }] }),
      text: async () => "",
    }
  }
  await captured.execute({ query: "hi" }, {})
  assert.equal(seen.headers["x-api-key"], "sk-env")
  assert.equal(resolveCalls, 0)
})

test("plugin options configure key, model, max_uses, and thinking", async () => {
  let captured
  const fake = {
    websearch: {
      async transform(callback) {
        callback({ add(provider) { captured = provider }, default: { set() {} } })
      },
    },
    options: { apiKey: "sk-option-key", model: "my-model", maxUses: 9, thinking: "disabled" },
  }
  await plugin.setup(fake)
  process.env.DEEPSEEK_API_KEY = "sk-env"
  delete process.env.WEBSEARCH_MODEL
  delete process.env.WEBSEARCH_MAX_USES
  delete process.env.WEBSEARCH_THINKING

  let seen
  globalThis.fetch = async (url, init) => {
    seen = init
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: "text", text: "ok" }] }),
      text: async () => "",
    }
  }
  await captured.execute({ query: "hi" }, {})

  assert.equal(seen.headers["x-api-key"], "sk-option-key")
  const body = JSON.parse(seen.body)
  assert.equal(body.model, "my-model")
  assert.equal(body.tools[0].max_uses, 9)
  assert.equal("thinking" in body, false)
})

test("invalid options fall back to environment variables", async () => {
  let captured
  const fake = {
    websearch: {
      async transform(callback) {
        callback({ add(provider) { captured = provider }, default: { set() {} } })
      },
    },
    options: { model: "", maxUses: "abc", thinking: "garbage" },
  }
  await plugin.setup(fake)
  process.env.DEEPSEEK_API_KEY = "test-key"
  process.env.WEBSEARCH_MODEL = "env-model"
  process.env.WEBSEARCH_MAX_USES = "7"
  process.env.WEBSEARCH_THINKING = "disabled"

  let seen
  globalThis.fetch = async (url, init) => {
    seen = init
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: "text", text: "ok" }] }),
      text: async () => "",
    }
  }
  await captured.execute({ query: "hi" }, {})
  const body = JSON.parse(seen.body)
  assert.equal(body.model, "env-model")
  assert.equal(body.tools[0].max_uses, 7)
  assert.equal("thinking" in body, false)
  delete process.env.WEBSEARCH_MODEL
  delete process.env.WEBSEARCH_MAX_USES
  delete process.env.WEBSEARCH_THINKING
})

test("dedupeSources and toResults are total for hostile input", () => {
  assert.deepEqual(dedupeSources(null), [])
  assert.deepEqual(dedupeSources(undefined), [])

  const results = toResults("a", [null, { url: "" }, { url: 5 }, { url: "https://x", title: "X" }])
  assert.equal(results.length, 2)
  assert.equal(results[0].title, "DeepSeek answer")
  assert.equal(results[1].url, "https://x")
})

test("execute tolerates a null context", async () => {
  const provider = await register()
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.WEBSEARCH_API_KEY
  await assert.rejects(() => provider.execute({ query: "hi" }, null), /DEEPSEEK_API_KEY/)
})

test("execute normalises a plain-object abort reason to an Error", async () => {
  const provider = await register()
  process.env.DEEPSEEK_API_KEY = "test-key"
  const controller = new AbortController()
  controller.abort({ code: 42 })
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    text: async () => "body",
    json: async () => ({}),
  })
  await assert.rejects(
    () => provider.execute({ query: "hi" }, { signal: controller.signal }),
    (error) => error instanceof Error && error.name !== "AbortError",
  )
})

test("execute falls back to a message for an empty abort reason", async () => {
  const provider = await register()
  process.env.DEEPSEEK_API_KEY = "test-key"
  const controller = new AbortController()
  controller.abort("")
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    text: async () => "body",
    json: async () => ({}),
  })
  await assert.rejects(
    () => provider.execute({ query: "hi" }, { signal: controller.signal }),
    (error) => error instanceof Error && error.message === "The web search was aborted",
  )
})

test("execute surfaces a credential lookup failure instead of 'no key'", async () => {
  let captured
  const fake = {
    websearch: {
      async transform(callback) {
        callback({ add(provider) { captured = provider }, default: { set() {} } })
      },
    },
    integration: {
      connection: {
        active: async () => {
          throw new Error("integration down")
        },
        resolve: async () => undefined,
      },
    },
  }
  await plugin.setup(fake)
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.WEBSEARCH_API_KEY
  await assert.rejects(
    () => captured.execute({ query: "hi" }, {}),
    (error) =>
      error instanceof Error &&
      /Failed to read the DeepSeek credential/.test(error.message) &&
      error.cause instanceof Error,
  )
})

test("execute reports a non-2xx body read failure", async () => {
  const provider = await register()
  process.env.DEEPSEEK_API_KEY = "test-key"
  globalThis.fetch = async () => ({
    ok: false,
    status: 502,
    text: async () => {
      throw new Error("socket hang up")
    },
    json: async () => ({}),
  })
  await assert.rejects(
    () => provider.execute({ query: "hi" }, {}),
    /body read failed: socket hang up/,
  )
})

test("execute normalises a raw abort reason from fetch", async () => {
  const provider = await register()
  process.env.DEEPSEEK_API_KEY = "test-key"
  const controller = new AbortController()
  controller.abort("raw-cancel")
  // undici rejects fetch with the raw signal reason (here: a string).
  globalThis.fetch = async () => {
    throw "raw-cancel"
  }
  await assert.rejects(
    () => provider.execute({ query: "hi" }, { signal: controller.signal }),
    (error) => error instanceof Error && error.message === "raw-cancel",
  )
})

test("execute normalises a raw abort reason from response.json", async () => {
  const provider = await register()
  process.env.DEEPSEEK_API_KEY = "test-key"
  const controller = new AbortController()
  controller.abort({ code: 7 })
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => {
      throw { code: 7 }
    },
  })
  await assert.rejects(
    () => provider.execute({ query: "hi" }, { signal: controller.signal }),
    (error) => error instanceof Error && error.message === "The web search was aborted",
  )
})

test("execute checks cancellation before returning results", async () => {
  const provider = await register()
  process.env.DEEPSEEK_API_KEY = "test-key"
  const controller = new AbortController()
  controller.abort(new Error("stop-now"))
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({ content: [{ type: "text", text: "ok" }] }),
  })
  await assert.rejects(
    () => provider.execute({ query: "hi" }, { signal: controller.signal }),
    /stop-now/,
  )
})

test("execute uses a fallback message for a non-string abort reason", async () => {
  const provider = await register()
  process.env.DEEPSEEK_API_KEY = "test-key"
  const controller = new AbortController()
  controller.abort(0)
  globalThis.fetch = async () => {
    throw 0
  }
  await assert.rejects(
    () => provider.execute({ query: "hi" }, { signal: controller.signal }),
    (error) => error instanceof Error && error.message === "The web search was aborted",
  )
})

test("execute wraps an AbortError-like object without a message", async () => {
  const provider = await register()
  process.env.DEEPSEEK_API_KEY = "test-key"
  const controller = new AbortController()
  controller.abort({ name: "AbortError", message: "" })
  globalThis.fetch = async () => {
    throw { name: "AbortError", message: "" }
  }
  await assert.rejects(
    () => provider.execute({ query: "hi" }, { signal: controller.signal }),
    (error) => error instanceof Error && error.name !== "AbortError",
  )
})

test("execute cancels while resolving the stored credential", async () => {
  let captured
  const fake = {
    websearch: {
      async transform(callback) {
        callback({ add(provider) { captured = provider }, default: { set() {} } })
      },
    },
    integration: {
      connection: {
        active: () => new Promise(() => {}),
        resolve: async () => undefined,
      },
    },
  }
  await plugin.setup(fake)
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.WEBSEARCH_API_KEY
  const controller = new AbortController()
  const promise = captured.execute({ query: "hi" }, { signal: controller.signal })
  controller.abort("cancel-cred")
  await assert.rejects(promise, /cancel-cred/)
})

test("execute does not leak a rejection when the credential lookup fails after abort", async () => {
  let captured
  const fake = {
    websearch: {
      async transform(callback) {
        callback({ add(provider) { captured = provider }, default: { set() {} } })
      },
    },
    integration: {
      connection: {
        active: () => Promise.reject(new Error("active-boom")),
        resolve: async () => undefined,
      },
    },
  }
  await plugin.setup(fake)
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.WEBSEARCH_API_KEY
  const controller = new AbortController()
  controller.abort("cancel-pre")
  await assert.rejects(
    () => captured.execute({ query: "hi" }, { signal: controller.signal }),
    /cancel-pre/,
  )
})

test("execute tolerates a hostile abort reason getter", async () => {
  const provider = await register()
  process.env.DEEPSEEK_API_KEY = "test-key"
  const reason = {}
  Object.defineProperty(reason, "name", {
    get() {
      throw new Error("hostile")
    },
  })
  const controller = new AbortController()
  controller.abort(reason)
  globalThis.fetch = async () => {
    throw reason
  }
  await assert.rejects(
    () => provider.execute({ query: "hi" }, { signal: controller.signal }),
    (error) => error instanceof Error && error.message === "The web search was aborted",
  )
})
