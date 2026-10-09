/**
 * opencode-websearch-deepseek
 *
 * A web search provider for OpenCode's built-in `websearch` tool, speaking the
 * Anthropic Messages protocol with the server-side `web_search_20250305` tool.
 * It registers through the OpenCode V2 plugin API (`ctx.websearch.transform`)
 * — no MCP server required — and additionally exposes the same search to Code
 * Mode as the `tools.websearch.search(...)` tool when the runtime supports it.
 *
 * DeepSeek is the default provider (its Anthropic-compatible endpoint emulates
 * the same protocol); any Anthropic-compatible endpoint can be selected.
 *
 * Environment:
 *   DEEPSEEK_API_KEY     DeepSeek API key (default provider).
 *   ANTHROPIC_API_KEY    Anthropic API key (provider "anthropic").
 *   WEBSEARCH_API_KEY    Generic fallback API key.
 *   WEBSEARCH_MODEL      Model override.
 *   WEBSEARCH_MAX_USES   Max server-side searches per query, defaults to 5.
 *   WEBSEARCH_THINKING   "enabled" (default) or "disabled".
 */

/** Default DeepSeek model used for search + synthesis. */
export const DEFAULT_MODEL = "deepseek-v4-flash"

/** Default number of server-side searches the model may run per query. */
export const DEFAULT_MAX_USES = 5

/** Anthropic API version header required by the compatibility layer. */
export const ANTHROPIC_VERSION = "2023-06-01"

/** DeepSeek Anthropic-compatible Messages endpoint. */
export const API_URL = "https://api.deepseek.com/anthropic/v1/messages"

/** Fallback URL used when a result has no source of its own. */
export const FALLBACK_URL = "https://api.deepseek.com"

/** Server-side web search tool type. */
export const WEB_SEARCH_TOOL_TYPE = "web_search_20250305"

/** Provider used when the `provider` option is not set. */
export const DEFAULT_PROVIDER = "deepseek"

/** A provider preset: endpoint, credential sources, and default model. */
export interface ProviderPreset {
  /** Full URL of the Anthropic-compatible Messages endpoint. */
  endpoint: string
  /** Environment variables checked for the API key, in order. */
  keyEnv: string[]
  /** OpenCode integration id used to resolve a stored credential. */
  integrationID: string
  /** Default model when none is configured. */
  defaultModel?: string
}

/**
 * Built-in Anthropic-compatible providers. `options.baseUrl` overrides the
 * endpoint; `options.provider` may name any provider id (resolved through its
 * OpenCode integration).
 */
export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  deepseek: {
    endpoint: API_URL,
    keyEnv: ["DEEPSEEK_API_KEY", "WEBSEARCH_API_KEY"],
    integrationID: "deepseek",
    defaultModel: DEFAULT_MODEL,
  },
  anthropic: {
    endpoint: "https://api.anthropic.com/v1/messages",
    keyEnv: ["ANTHROPIC_API_KEY", "WEBSEARCH_API_KEY"],
    integrationID: "anthropic",
  },
}

/** Look up a preset by own key only (never the prototype chain). */
function getPreset(provider: string): ProviderPreset | undefined {
  return Object.prototype.hasOwnProperty.call(PROVIDER_PRESETS, provider)
    ? (PROVIDER_PRESETS[provider] as ProviderPreset)
    : undefined
}

/**
 * System prompt that keeps the model from emitting tool-call XML or looping on
 * further searches, and makes it answer in the user's language.
 */
export const SYSTEM_PROMPT = [
  "You are a web search assistant. Follow these rules strictly:",
  "",
  "1. Use web_search to find relevant, up-to-date information for the user's query.",
  "2. After receiving search results, write a comprehensive, well-structured answer",
  "   in plain text based on what you found. Include specific details, dates, and facts.",
  "3. Do NOT output tool-call XML (no <invoke> tags).",
  "4. Do NOT call web_search again after you have results.",
  "5. Answer in the same language the user used in their query.",
  "6. If search results are poor or irrelevant, explain why and suggest better keywords.",
  "",
  "Your response must be the final answer, not another search request.",
].join("\n")

/** A single search result returned to OpenCode. */
export interface WebSearchResult {
  url: string
  title: string
  content: string
  time: Record<string, unknown>
}

/** A source URL reported by the server-side search. */
export interface DeepSeekSource {
  url: string
  title?: string
  /** Snippet for this source, taken from a `citations[].cited_text` field. */
  content?: string
}

/** Options accepted by {@link buildRequestBody}. */
export interface BuildRequestOptions {
  model: string
  maxUses: number
  thinking: "enabled" | "disabled"
  maxTokens?: number
  system?: string
}

/** Minimal shape of a content block in an Anthropic-style response. */
interface ResponseBlock {
  type?: string
  text?: string
  content?: unknown
}

/** Minimal shape of an Anthropic-style Messages response. */
export interface DeepSeekResponse {
  content?: ResponseBlock[]
  [key: string]: unknown
}

/** Minimal slice of the OpenCode plugin context used by this plugin. */
export interface WebsearchProvider {
  id: string
  name: string
  execute: (
    input: { query: string },
    context: { signal?: AbortSignal },
  ) => Promise<WebSearchResult[]>
}

interface WebsearchEditor {
  add(provider: WebsearchProvider): void
  default: {
    set(providerID: string | false): void
  }
}

/** A credential returned by OpenCode for a configured provider. */
export interface StoredCredential {
  type?: string
  key?: string
}

/** Minimal slice of OpenCode's integration API used to read a stored provider key. */
export interface IntegrationContext {
  connection: {
    active(integrationID: string): Promise<unknown>
    resolve(connection: unknown): Promise<StoredCredential | undefined>
  }
}

/** Minimal slice of OpenCode's model API used to read the configured default. */
export interface ModelInfo {
  providerID?: string
  modelID?: string
  id?: string
}

export interface ModelContext {
  default?(): Promise<unknown>
}

/** Minimal slice of OpenCode's tool API used to expose the Code Mode tool. */
export interface ToolEditor {
  namespace(input: { name: string; description: string }): void
  add(tool: Record<string, unknown>): void
}

export interface ToolContext {
  transform?(callback: (editor: ToolEditor) => void): Promise<unknown> | unknown
}

/**
 * Options accepted through the `plugins` object form in `opencode.json(c)` and
 * forwarded to the plugin via `ctx.options`:
 *
 * ```jsonc
 * { "plugins": [{ "package": "opencode-websearch-deepseek", "options": {
 *   "provider": "deepseek", "apiKey": "...", "model": "deepseek-v4-flash",
 *   "maxUses": 5, "thinking": "enabled"
 * } }] }
 * ```
 */
export interface WebsearchOptions {
  /** Provider preset (`deepseek`, `anthropic`) or any OpenCode integration id. */
  provider?: string
  /** Full Messages endpoint URL; overrides the preset. */
  baseUrl?: string
  /** API key; takes precedence over env and the stored credential. */
  apiKey?: string
  /** Model used for search and synthesis. */
  model?: string
  /** Max server-side searches per query. */
  maxUses?: number | string
  /** `enabled` or `disabled`. */
  thinking?: string
}

/** Context passed to the plugin's `setup`. */
export interface WebsearchContext {
  websearch: {
    transform(callback: (editor: WebsearchEditor) => void): Promise<unknown> | unknown
  }
  /** Plugin options from the `plugins` object form. */
  options?: Record<string, unknown>
  /** Present in OpenCode 2.x; used to reuse a provider credential. */
  integration?: IntegrationContext
  /** Present in OpenCode 2.x; used to read the configured default model. */
  model?: ModelContext
  /** Present in OpenCode 2.x; used to register the Code Mode tool. */
  tool?: ToolContext
}

/** Return a trimmed non-empty string, or undefined for any other value. */
function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

/** Resolve the configured provider id. */
export function resolveProvider(options?: WebsearchOptions): string {
  return readString(options?.provider) ?? DEFAULT_PROVIDER
}

/** Resolve the Messages endpoint for the configured provider. */
export function resolveEndpoint(options?: WebsearchOptions): string {
  const override = readString(options?.baseUrl)
  if (override) {
    if (!/^https?:\/\//i.test(override)) {
      throw new Error(`Invalid baseUrl "${override}": expected an http(s) URL`)
    }
    return override
  }
  const provider = resolveProvider(options)
  const preset = getPreset(provider)
  if (preset) return preset.endpoint
  throw new Error(`Unknown provider "${provider}": set the baseUrl plugin option to its /v1/messages URL`)
}

/** Human-readable name for the websearch provider entry. */
function providerDisplay(provider: string): string {
  if (provider === "deepseek") return "DeepSeek Web Search"
  if (provider === "anthropic") return "Anthropic Web Search"
  return `${provider} Web Search`
}

/** Read an environment variable, treating blank strings as unset. */
function readEnv(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[name]
  return value && value.trim() ? value.trim() : undefined
}

/**
 * Resolve the API key, in order of precedence: the `apiKey` plugin option, the
 * provider's environment variables, then the credential OpenCode stores for the
 * provider's integration (configured via `opencode auth login`).
 */
export async function resolveApiKey(
  ctx: WebsearchContext,
  options?: WebsearchOptions,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const fromOptions = readString(options?.apiKey)
  if (fromOptions) return fromOptions

  const provider = resolveProvider(options)
  const preset = getPreset(provider)
  for (const name of preset?.keyEnv ?? ["WEBSEARCH_API_KEY"]) {
    const value = readEnv(name)
    if (value) return value
  }

  const integration = ctx.integration
  if (!integration) return undefined
  const integrationID = preset?.integrationID ?? provider

  try {
    const connection = await withAbort(integration.connection.active(integrationID), signal)
    if (!connection) return undefined
    const credential = await withAbort(integration.connection.resolve(connection), signal)
    return readString(credential?.key)
  } catch (error) {
    if (signal?.aborted) throwCancellation(signal, error)
    // A genuine integration failure is not "no key": surface it with context.
    throw new Error(`Failed to read the ${integrationID} credential from OpenCode`, { cause: error })
  }
}

/**
 * Resolve the model once, in order of precedence: the `model` option, the
 * `WEBSEARCH_MODEL` env var, the configured default model when it belongs to
 * the same provider, then the provider preset default.
 */
export async function resolveModel(
  ctx: WebsearchContext,
  options?: WebsearchOptions,
): Promise<string | undefined> {
  const fromOptions = readString(options?.model)
  if (fromOptions) return fromOptions

  const fromEnv = readEnv("WEBSEARCH_MODEL")
  if (fromEnv) return fromEnv

  const provider = resolveProvider(options)
  try {
    const result = await ctx.model?.default?.()
    const info = ((result as { data?: ModelInfo } | undefined)?.data ?? (result as ModelInfo | undefined)) as
      | ModelInfo
      | undefined
    if (info && info.providerID === provider) {
      const id = readString(info.modelID) ?? readString(info.id)
      if (id) return id
    }
  } catch {
    // Ignore; fall through to the preset default.
  }

  return getPreset(provider)?.defaultModel
}

/**
 * Rethrow the cancellation reason from `signal`. `Error` and `AbortError`
 * objects (e.g. `DOMException`) are preserved as-is; other reasons are
 * normalised to an `Error` so callers always receive one.
 */
function throwCancellation(signal: AbortSignal, fallback: unknown): never {
  const reason: unknown = signal.reason
  if (reason instanceof Error) throw reason
  if (typeof reason === "object" && reason !== null) {
    // Preserve AbortError-like objects (DOMException has a message); wrap the
    // rest. Guard the property reads: a hostile reason may throw from a getter.
    try {
      const candidate = reason as { name?: unknown; message?: unknown }
      if (candidate.name === "AbortError" && typeof candidate.message === "string" && candidate.message) {
        throw reason
      }
    } catch (error) {
      if (error === reason) throw error
    }
    throw new Error("The web search was aborted", { cause: reason })
  }
  if (typeof reason === "string" && reason.trim()) throw new Error(reason.trim())
  if (reason !== undefined && reason !== null) {
    // Non-string primitives (e.g. 0) are not useful messages; keep them as cause.
    throw new Error("The web search was aborted", { cause: reason })
  }
  if (fallback instanceof Error) throw fallback
  throw new Error("The web search was aborted")
}

/** Reject with the signal's reason if `signal` aborts before `promise` settles. */
function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    // The passed promise is already created; swallow its later rejection so it
    // does not surface as an unhandled rejection.
    promise.catch(() => {})
    return Promise.reject(signal.reason ?? new Error("The web search was aborted"))
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("The web search was aborted"))
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
  })
}

/** Resolve `promise`, or `undefined` if it does not settle within `ms`. */
async function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Validate a `max_uses` value: a positive safe integer, given as a number or a
 * plain-integer string. Returns `undefined` when unset or invalid.
 */
function pickMaxUses(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined
  }
  if (typeof value !== "string") return undefined
  // Strict: only a plain positive integer. Rejects "1e3", "5.5", "5abc" and
  // values outside the safe-integer range (e.g. a 24-digit number).
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * Resolve the `max_uses` value for the search tool declaration.
 * Falls back to {@link DEFAULT_MAX_USES} for missing or invalid input.
 */
export function resolveMaxUses(raw: string | number | undefined = process.env.WEBSEARCH_MAX_USES): number {
  return pickMaxUses(raw) ?? DEFAULT_MAX_USES
}

/**
 * Validate a thinking mode: only recognised `enabled`/`disabled` spellings
 * count. Returns `undefined` when unset or unrecognised.
 */
function pickThinking(value: unknown): "enabled" | "disabled" | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "enabled" || normalized === "on" || normalized === "true" || normalized === "1") {
    return "enabled"
  }
  if (normalized === "disabled" || normalized === "off" || normalized === "false" || normalized === "0") {
    return "disabled"
  }
  return undefined
}

/**
 * Resolve the thinking mode. Only `disabled` disables extended thinking;
 * anything else (including unset) keeps the historical `enabled` behavior.
 */
export function resolveThinking(
  raw: string | undefined = process.env.WEBSEARCH_THINKING,
): "enabled" | "disabled" {
  return pickThinking(raw) ?? "enabled"
}

/** Build the JSON request body sent to the Messages endpoint. */
export function buildRequestBody(query: string, options: BuildRequestOptions): Record<string, unknown> {
  const tool: Record<string, unknown> = {
    type: WEB_SEARCH_TOOL_TYPE,
    name: "web_search",
    max_uses: options.maxUses,
  }

  const body: Record<string, unknown> = {
    model: options.model,
    max_tokens: options.maxTokens ?? 32768,
    // Anthropic-compatible contract: the system prompt is a top-level field,
    // not a `system` role inside `messages`.
    system: options.system ?? SYSTEM_PROMPT,
    messages: [{ role: "user", content: query }],
    tools: [tool],
    tool_choice: { type: "auto" },
  }

  if (options.thinking === "enabled") {
    body.thinking = { type: "enabled" }
  }

  return body
}

/**
 * Merge duplicate sources by URL while preserving first-seen order. Missing
 * `title`/`content` fields are filled from later duplicates.
 */
export function dedupeSources(sources: readonly DeepSeekSource[]): DeepSeekSource[] {
  const byUrl = new Map<string, DeepSeekSource>()
  for (const source of Array.isArray(sources) ? sources : []) {
    if (typeof source?.url !== "string" || source.url.length === 0) continue
    const existing = byUrl.get(source.url)
    if (!existing) {
      byUrl.set(source.url, { ...source })
      continue
    }
    if (!existing.title && source.title) existing.title = source.title
    if (!existing.content && source.content) existing.content = source.content
  }
  return [...byUrl.values()]
}

/**
 * Split a response into a synthesized answer and its source URLs. Sources
 * reported by multiple search rounds are de-duplicated by URL.
 */
export function extractAnswerAndSources(data: DeepSeekResponse): {
  answer: string
  sources: DeepSeekSource[]
} {
  const collected: DeepSeekSource[] = []
  const textParts: string[] = []

  const blocks = Array.isArray(data?.content) ? data.content : []

  for (const block of blocks) {
    if (block?.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const item of block.content as Array<Record<string, unknown>>) {
        if (item?.type === "web_search_result" && typeof item.url === "string") {
          collected.push({
            url: item.url,
            title: typeof item.title === "string" ? item.title : item.url,
          })
        }
      }
    } else if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
      textParts.push(block.text.trim())
    }

    // Text blocks may carry `citations[].cited_text` snippets for their sources.
    const citations = (block as { citations?: unknown } | undefined)?.citations
    if (Array.isArray(citations)) {
      for (const citation of citations as Array<Record<string, unknown>>) {
        if (
          typeof citation?.url === "string" &&
          typeof citation.cited_text === "string" &&
          citation.cited_text.trim()
        ) {
          collected.push({ url: citation.url, content: citation.cited_text.trim() })
        }
      }
    }
  }

  return { answer: textParts.join("\n\n"), sources: dedupeSources(collected) }
}

/**
 * Build the result list OpenCode expects: the synthesized answer first (when
 * present), followed by the individual sources.
 */
export function toResults(answer: string, sources: readonly DeepSeekSource[] = []): WebSearchResult[] {
  const valid = (Array.isArray(sources) ? sources : []).filter(
    (source): source is DeepSeekSource => typeof source?.url === "string" && source.url.length > 0,
  )
  const results: WebSearchResult[] = []
  if (answer) {
    // The synthesized answer reuses the first source's URL so it links to a
    // real page; the same source is also listed below (intentional).
    results.push({
      url: valid[0]?.url ?? FALLBACK_URL,
      title: "Web search answer",
      content: answer,
      time: {},
    })
  }
  for (const source of valid) {
    results.push({
      url: source.url,
      title: source.title || source.url,
      content: source.content ?? "",
      time: {},
    })
  }
  if (results.length === 0) {
    results.push({
      url: FALLBACK_URL,
      title: "Web search",
      content: "The search returned no results.",
      time: {},
    })
  }
  return results
}

/** Textual form of a search result, for the non-Code-Mode (native) context. */
export function toContent(answer: string, sources: readonly DeepSeekSource[]): string {
  const valid = (Array.isArray(sources) ? sources : []).filter(
    (source): source is DeepSeekSource => typeof source?.url === "string" && source.url.length > 0,
  )
  if (valid.length === 0) return answer
  const lines = valid.map((source) => `- ${source.title || source.url} — ${source.url}`)
  return `${answer}\n\nSources:\n${lines.join("\n")}`
}

/** Normalise sources into the structured output shape (title defaults to url). */
export function toSourceObjects(
  sources: readonly DeepSeekSource[],
): Array<{ url: string; title: string; content: string }> {
  return (Array.isArray(sources) ? sources : [])
    .filter((source): source is DeepSeekSource => typeof source?.url === "string" && source.url.length > 0)
    .map((source) => ({ url: source.url, title: source.title || source.url, content: source.content ?? "" }))
}

/**
 * Run one search through the configured provider. Shared by the websearch
 * provider and the Code Mode tool so both always behave identically.
 */
export async function searchDeepSeek(
  ctx: WebsearchContext,
  options: WebsearchOptions,
  model: string | undefined,
  query: string,
  signal?: AbortSignal,
): Promise<{ answer: string; sources: DeepSeekSource[] }> {
  const provider = resolveProvider(options)
  try {
    const apiKey = await resolveApiKey(ctx, options, signal)
    if (!apiKey) {
      throw new Error(
        `No API key for provider "${provider}": set its environment variable, pass the apiKey plugin option, or sign in to the "${provider}" provider in OpenCode`,
      )
    }
    if (!/^[\x21-\x7e]+$/.test(apiKey)) {
      throw new Error("The API key contains invalid characters")
    }
    if (!model) {
      throw new Error(`No model for provider "${provider}": set the model plugin option or WEBSEARCH_MODEL`)
    }

    const body = buildRequestBody(query, {
      model,
      maxUses: pickMaxUses(options.maxUses) ?? resolveMaxUses(readEnv("WEBSEARCH_MAX_USES")),
      thinking: pickThinking(options.thinking) ?? resolveThinking(readEnv("WEBSEARCH_THINKING")),
    })

    const response = await fetch(resolveEndpoint(options), {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const text = await response.text().catch((error: unknown) => {
        // Preserve cancellation: never turn an abort into an API error.
        if (signal?.aborted) return throwCancellation(signal, error)
        if ((error as { name?: string } | undefined)?.name === "AbortError") throw error
        const detail = error instanceof Error ? error.message : String(error)
        return `[body read failed: ${detail}]`
      })
      // An abort can also arrive after the body resolves; re-check so it is
      // not masked as an API error.
      if (signal?.aborted) throwCancellation(signal, undefined)
      throw new Error(`Web search API error ${response.status}: ${text.slice(0, 300)}`)
    }

    const data = (await response.json()) as DeepSeekResponse
    // A cancellation may arrive after the response completed.
    if (signal?.aborted) throwCancellation(signal, undefined)
    return extractAnswerAndSources(data)
  } catch (error) {
    // `fetch`/`json` reject with the raw signal reason; normalise any
    // cancellation so callers always receive an Error.
    if (signal?.aborted) throwCancellation(signal, error)
    throw error
  }
}

/** OpenCode plugin definition. */
export const plugin = {
  id: "websearch.deepseek",

  async setup(ctx: WebsearchContext): Promise<void> {
    const options = (ctx.options ?? {}) as WebsearchOptions
    const provider = resolveProvider(options)
    // The model is resolved once; bound the wait so a stuck model API cannot
    // block plugin setup, and fall back to the provider preset if it times out.
    const model = (await raceTimeout(resolveModel(ctx, options), 2000)) ?? getPreset(provider)?.defaultModel

    await ctx.websearch.transform((editor) => {
      editor.add({
        id: provider,
        name: providerDisplay(provider),
        execute: async ({ query }, context) => {
          const { answer, sources } = await searchDeepSeek(ctx, options, model, query, context?.signal)
          return toResults(answer, sources)
        },
      })
      editor.default.set(provider)
    })

    // Expose the same search to Code Mode when the runtime supports tools.
    const tool = ctx.tool
    if (tool && typeof tool.transform === "function") {
      try {
        await tool.transform((editor) => {
          editor.namespace({ name: "websearch", description: "Web search" })
          editor.add({
            name: "search",
            description: "Search the web. Returns a synthesized answer with source URLs.",
            input: {
              type: "object",
              properties: { query: { type: "string", minLength: 1, description: "Search query" } },
              required: ["query"],
              additionalProperties: false,
            },
            output: {
              type: "object",
              properties: {
                answer: { type: "string" },
                sources: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      url: { type: "string" },
                      title: { type: "string" },
                      content: { type: "string" },
                    },
                    required: ["url", "title"],
                  },
                },
              },
              required: ["answer", "sources"],
            },
            options: { namespace: "websearch", codemode: true, pinned: true, permission: "websearch" },
            execute: async (input: { query?: unknown }, context: { signal?: AbortSignal }) => {
              const query = typeof input?.query === "string" ? input.query.trim() : ""
              if (!query) throw new Error("query must be a non-empty string")
              const { answer, sources } = await searchDeepSeek(ctx, options, model, query, context?.signal)
              return { output: { answer, sources: toSourceObjects(sources) }, content: toContent(answer, sources) }
            },
          })
        })
      } catch {
        // Tool registration is best effort; the websearch provider still works.
      }
    }
  },
}

export default plugin
