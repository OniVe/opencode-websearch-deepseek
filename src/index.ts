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
 * DeepSeek also exposes native JSON Search & Fetch APIs. Set
 * `searchApi: "native"` to use them instead of the Messages tool: the search
 * returns structured results, and the top results can be enriched with full
 * page Markdown through the Fetch API.
 *
 * Environment:
 *   DEEPSEEK_API_KEY        DeepSeek API key (default provider).
 *   ANTHROPIC_API_KEY       Anthropic API key (provider "anthropic").
 *   WEBSEARCH_API_KEY       Generic fallback API key.
 *   WEBSEARCH_MODEL         Model override.
 *   WEBSEARCH_MAX_USES      Max server-side searches per query, defaults to 5.
 *   WEBSEARCH_THINKING      "enabled" (default) or "disabled".
 *   WEBSEARCH_SEARCH_API    "messages" (default) or "native".
 *   WEBSEARCH_SEARCH_BASE_URL  Base URL for the native Search & Fetch APIs.
 *   WEBSEARCH_COUNT         Native result count (1-50), defaults to 10.
 *   WEBSEARCH_NEED_CONTENT  "true" to request page content from native search.
 *   WEBSEARCH_FETCH         Fetch full page Markdown for the top N results.
 */

/** Default DeepSeek model used for search + synthesis. */
export const DEFAULT_MODEL = "deepseek-v4-flash"

/** Default number of server-side searches the model may run per query. */
export const DEFAULT_MAX_USES = 5

/** Anthropic API version header required by the compatibility layer. */
export const ANTHROPIC_VERSION = "2023-06-01"

/** DeepSeek Anthropic-compatible Messages endpoint. */
export const API_URL = "https://api.deepseek.com/anthropic/v1/messages"

/** DeepSeek native Search endpoint. */
export const SEARCH_URL = "https://api.deepseek.com/v1/tools/search"

/** DeepSeek native Fetch endpoint. */
export const FETCH_URL = "https://api.deepseek.com/v1/tools/fetch"

/** Base URL of the native DeepSeek Search & Fetch APIs. */
export const NATIVE_BASE_URL = "https://api.deepseek.com"

/** Default number of results requested from the native Search API. */
export const DEFAULT_COUNT = 10

/** Maximum number of results accepted by the native Search API. */
export const MAX_COUNT = 50

/** Maximum query length accepted by the messages backend (code points). */
export const MAX_MESSAGE_QUERY_LENGTH = 8192

/** Raw UTF-16 length rejected immediately for the messages backend. */
export const MAX_RAW_MESSAGE_QUERY_LENGTH = 1_000_000

/** Minimum spacing between native API requests (below the 5 QPS limit). */
export const RATE_LIMIT_INTERVAL_MS = 210

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

/** Search backend: the Anthropic Messages tool or the native DeepSeek JSON API. */
export type SearchApi = "messages" | "native"

/** Minimal shape of a native Search API response. */
export interface NativeSearchResponse {
  results?: unknown
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
  /** Search backend: `messages` (default) or `native`. */
  searchApi?: string
  /** Base URL for the native Search & Fetch APIs. */
  searchBaseUrl?: string
  /** Number of native results to request (1-50). */
  count?: number | string
  /** Ask the native Search API for page content (`need_content`). */
  needContent?: boolean | string
  /** Fetch full page Markdown for the top N native results (0 disables). */
  fetch?: number | string
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

/** Parse and validate an http(s) URL; rejects empty authorities and credentials. */
function parseHttpUrl(value: string, label: string): URL {
  if (/^https?:\/\/[/\\]/i.test(value)) {
    throw new Error(`Invalid ${label}: expected an http(s) URL`)
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Invalid ${label}: expected an http(s) URL`)
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
    throw new Error(`Invalid ${label}: expected an http(s) URL`)
  }
  if (url.username || url.password) {
    throw new Error(`Invalid ${label}: credentials are not allowed`)
  }
  if (url.search || url.hash) {
    throw new Error(`Invalid ${label}: query and fragment are not allowed`)
  }
  return url
}

/** Resolve the Messages endpoint for the configured provider. */
export function resolveEndpoint(options?: WebsearchOptions): string {
  const override = readString(options?.baseUrl)
  if (override) {
    parseHttpUrl(override, "baseUrl")
    return override
  }
  const provider = resolveProvider(options)
  const preset = getPreset(provider)
  if (preset) return preset.endpoint
  throw new Error("Unknown provider: set the baseUrl plugin option to its /v1/messages URL")
}

/**
 * Resolve the search backend. Unknown explicit values are rejected so a typo
 * does not silently fall back to the other backend.
 */
export function resolveSearchApi(options?: WebsearchOptions): SearchApi {
  const value = options?.searchApi
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new Error('Invalid searchApi: expected "messages" or "native"')
  }
  const raw = readString(value) ?? readEnv("WEBSEARCH_SEARCH_API")
  if (!raw) return "messages"
  const normalized = raw.toLowerCase()
  if (normalized === "messages" || normalized === "native") return normalized
  throw new Error('Invalid searchApi: expected "messages" or "native"')
}

/**
 * Resolve the base URL for the native Search & Fetch APIs. An explicit
 * `searchBaseUrl` wins; otherwise it is derived from a custom Messages
 * endpoint (by stripping its `/v1/messages` suffix), then from the DeepSeek
 * default.
 */
export function resolveSearchBaseUrl(options?: WebsearchOptions): string {
  const strip = (value: string) => value.replace(/\/+$/, "")

  const override = readString(options?.searchBaseUrl) ?? readEnv("WEBSEARCH_SEARCH_BASE_URL")
  if (override) {
    const url = parseHttpUrl(override, "searchBaseUrl")
    const path = strip(url.pathname)
    if (/\/v1(\/tools(\/(search|fetch))?)?$/i.test(path)) {
      throw new Error("Invalid searchBaseUrl: use the API root without /v1")
    }
    return `${url.origin}${path}`
  }

  const baseUrl = readString(options?.baseUrl)
  if (baseUrl) {
    const url = parseHttpUrl(baseUrl, "baseUrl")
    const path = strip(url.pathname)
    const suffix = /\/anthropic\/v1\/messages$/i.test(path)
      ? /\/anthropic\/v1\/messages$/i
      : /\/v1\/messages$/i.test(path)
        ? /\/v1\/messages$/i
        : undefined
    if (!suffix) {
      throw new Error(
        'searchApi "native" cannot derive a base URL from baseUrl: set the searchBaseUrl plugin option',
      )
    }
    return `${url.origin}${strip(path.replace(suffix, ""))}`
  }

  if (resolveProvider(options) === DEFAULT_PROVIDER) return NATIVE_BASE_URL
  throw new Error('searchApi "native" requires the deepseek provider or the searchBaseUrl plugin option')
}

/** Parse an integer in `[min, max]` from a number or a plain-integer string. */
function pickIntegerInRange(value: unknown, min: number, max: number): number | undefined {
  let parsed: number | undefined
  if (typeof value === "number") {
    parsed = value
  } else if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    parsed = Number(value.trim())
  }
  if (parsed === undefined || !Number.isSafeInteger(parsed)) return undefined
  return parsed >= min && parsed <= max ? parsed : undefined
}

/** Parse a boolean from a boolean or a common string spelling. */
function pickBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes") {
    return true
  }
  if (normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no") {
    return false
  }
  return undefined
}

/** True when `value` has more than `limit` Unicode code points (early exit). */
function exceedsCodePoints(value: string, limit: number): boolean {
  // 128 code points cannot exceed 256 UTF-16 units; reject huge inputs in O(1).
  if (value.length > limit * 2) return true
  let count = 0
  for (const _ of value) {
    if (++count > limit) return true
  }
  return false
}

/** Resolve how many native results to request. Invalid input falls back to 10. */
export function resolveCount(raw: unknown = process.env.WEBSEARCH_COUNT): number {
  return pickIntegerInRange(raw, 1, MAX_COUNT) ?? DEFAULT_COUNT
}

/** Resolve the native `need_content` flag. */
export function resolveNeedContent(raw: unknown = process.env.WEBSEARCH_NEED_CONTENT): boolean {
  return pickBoolean(raw) ?? false
}

/** Resolve how many top results to enrich through the Fetch API. */
export function resolveFetchCount(raw: unknown = process.env.WEBSEARCH_FETCH): number {
  return pickIntegerInRange(raw, 0, MAX_COUNT) ?? 0
}

/** Human-readable name for the websearch provider entry. */
function providerDisplay(provider: string): string {
  if (provider === "deepseek") return "DeepSeek Web Search"
  if (provider === "anthropic") return "Anthropic Web Search"
  return getPreset(provider) ? `${provider} Web Search` : "Web Search"
}

/** Read an environment variable, treating blank strings as unset. */
function readEnv(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[name]
  return value && value.trim() ? value.trim() : undefined
}

/** Safe provider label for error messages: known presets only. */
function providerLabel(provider: string): string {
  return getPreset(provider) ? provider : "configured provider"
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
  if (signal?.aborted) throwCancellation(signal, undefined)
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
    throw new Error(`Failed to read the ${providerLabel(integrationID)} credential from OpenCode`, { cause: error })
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
 * Rethrow the cancellation reason from `signal`. Real `Error`/`DOMException`
 * instances are preserved; all other reasons are normalised to an `Error`.
 */
function throwCancellation(signal: AbortSignal, fallback: unknown): never {
  const reason: unknown = signal.reason
  if (reason instanceof Error) throw reason
  if (typeof DOMException !== "undefined" && reason instanceof DOMException) throw reason
  if (typeof reason === "object" && reason !== null) {
    throw new Error("The web search was aborted", { cause: reason })
  }
  if (typeof reason === "string" && reason.trim()) {
    throw new Error(remoteMessage(reason, "The web search was aborted"))
  }
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

/** Resolve after `ms`, or reject with the signal's reason when aborted. */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new Error("The web search was aborted"))
  }
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new Error("The web search was aborted"))
    }
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

/** Process-wide pacer: serialize slots and measure from the actual start. */
function createRateLimiter(intervalMs: number) {
  let last = 0
  let tail: Promise<void> = Promise.resolve()
  return {
    next(signal?: AbortSignal): Promise<void> {
      const run = tail.then(async () => {
        if (signal?.aborted) {
          throw signal.reason ?? new Error("The web search was aborted")
        }
        if (last > 0) {
          // `performance.now()` is monotonic, so clock jumps cannot extend a wait.
          const wait = intervalMs - (performance.now() - last)
          if (wait > 0) await abortableDelay(wait, signal)
        }
        if (signal?.aborted) {
          throw signal.reason ?? new Error("The web search was aborted")
        }
        last = performance.now()
      })
      // Keep the chain alive after a cancellation so later callers still run.
      tail = run.catch(() => {})
      // A caller that is still queued can cancel without waiting for its slot.
      return signal ? withAbort(run, signal) : run
    },
  }
}

const searchRateLimiter = createRateLimiter(RATE_LIMIT_INTERVAL_MS)
const fetchRateLimiter = createRateLimiter(RATE_LIMIT_INTERVAL_MS)

/** Resolve `promise`, or `undefined` if it does not settle within `ms`. */
async function raceTimeout<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  try {
    const racers: Array<Promise<T | undefined>> = [
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms)
      }),
    ]
    if (signal) {
      racers.push(
        new Promise<undefined>((_, reject) => {
          const abort = () => reject(signal.reason ?? new Error("The web search was aborted"))
          onAbort = abort
          if (signal.aborted) abort()
          else signal.addEventListener("abort", abort, { once: true })
        }),
      )
    }
    return await Promise.race(racers)
  } finally {
    if (timer) clearTimeout(timer)
    if (onAbort) signal?.removeEventListener("abort", onAbort)
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
 * `title`/`content` fields are filled from later duplicates; invalid and
 * non-http(s) URLs are dropped.
 */
export function dedupeSources(sources: readonly DeepSeekSource[]): DeepSeekSource[] {
  const byUrl = new Map<string, DeepSeekSource>()
  for (const source of Array.isArray(sources) ? sources : []) {
    if (typeof source?.url !== "string" || !isHttpSourceUrl(source.url)) continue
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

/** Only http(s) URLs with a host and no credentials are usable sources. */
function isHttpSourceUrl(value: string): boolean {
  if (value.length > 8192) return false
  if (!/^https?:\/\//i.test(value)) return false
  if (/^https?:\/\/[/\\]/i.test(value)) return false
  // Reject raw control/format characters and backslashes that URL parsers normalize.
  if (
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029\\\u034F\uD800-\uDFFF]|\p{Cf}|[\u180B-\u180D\u180F\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u.test(
      value,
    )
  ) {
    return false
  }
  try {
    const url = new URL(value)
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

/**
 * Map native Search API results to the plugin's source shape. Page `content`
 * wins when present, then the API's model-oriented `summary` (600-800 chars),
 * then the short `snippet`.
 */
export function mapNativeResults(results: unknown): DeepSeekSource[] {
  if (!Array.isArray(results)) return []
  const mapped: DeepSeekSource[] = []
  // The API caps `count` at 50; never process more than that even if a proxy
  // returns an unexpectedly large array.
  for (const item of results.slice(0, MAX_COUNT) as Array<Record<string, unknown>>) {
    const url = readString(item?.url)
    if (!url || !isHttpSourceUrl(url)) continue
    const content =
      readString(item.content) ?? readString(item.summary) ?? readString(item.snippet) ?? ""
    const title = readString(item.title)
    mapped.push(title ? { url, title, content } : { url, content })
  }
  return dedupeSources(mapped)
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
  let toolError: string | undefined

  for (const block of blocks) {
    if (block?.type === "web_search_tool_result") {
      if (Array.isArray(block.content)) {
        for (const item of block.content as Array<Record<string, unknown>>) {
          if (item?.type === "web_search_tool_result_error") {
            toolError = remoteMessage(item.error_code, "web_search_tool_result_error")
          }
          if (item?.type === "web_search_result" && typeof item.url === "string") {
            const url = item.url.trim()
            if (!url) continue
            collected.push({
              url,
              title: typeof item.title === "string" ? item.title : url,
            })
          }
        }
      } else {
        const content = block.content as { type?: unknown; error_code?: unknown } | undefined
        if (content && content.type === "web_search_tool_result_error") {
          toolError = remoteMessage(content.error_code, "web_search_tool_result_error")
        }
      }
    } else if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
      textParts.push(block.text.trim())
    }

    // Text blocks may carry `citations[].cited_text` snippets for their sources.
    const citations = (block as { citations?: unknown } | undefined)?.citations
    if (Array.isArray(citations)) {
      for (const citation of citations as Array<Record<string, unknown>>) {
        const url = typeof citation?.url === "string" ? citation.url.trim() : ""
        if (url && typeof citation.cited_text === "string" && citation.cited_text.trim()) {
          collected.push({ url, content: citation.cited_text.trim() })
        }
      }
    }
  }

  if (toolError) throw new Error(`Web search error: ${toolError}`)
  return { answer: textParts.join("\n\n"), sources: dedupeSources(collected) }
}

/**
 * Build the result list OpenCode expects: the synthesized answer first (when
 * present), followed by the individual sources.
 */
export function toResults(answer: string, sources: readonly DeepSeekSource[] = []): WebSearchResult[] {
  const valid = (Array.isArray(sources) ? sources : []).filter(
    (source): source is DeepSeekSource =>
      typeof source?.url === "string" && isHttpSourceUrl(source.url),
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
    (source): source is DeepSeekSource =>
      typeof source?.url === "string" && isHttpSourceUrl(source.url),
  )
  if (valid.length === 0) return answer
  const lines = valid.map((source) => `- ${source.title || source.url} — ${source.url}`)
  const prefix = answer ? `${answer}\n\n` : ""
  return `${prefix}Sources:\n${lines.join("\n")}`
}

/** Normalise sources into the structured output shape (title defaults to url). */
export function toSourceObjects(
  sources: readonly DeepSeekSource[],
): Array<{ url: string; title: string; content: string }> {
  return (Array.isArray(sources) ? sources : [])
    .filter(
      (source): source is DeepSeekSource =>
        typeof source?.url === "string" && isHttpSourceUrl(source.url),
    )
    .map((source) => ({ url: source.url, title: source.title || source.url, content: source.content ?? "" }))
}

/** Read and validate the API key, with a provider-specific error. */
async function requireApiKey(
  ctx: WebsearchContext,
  options: WebsearchOptions | undefined,
  signal?: AbortSignal,
): Promise<{ provider: string; apiKey: string }> {
  const provider = resolveProvider(options)
  const apiKey = await resolveApiKey(ctx, options, signal)
  if (!apiKey) {
    throw new Error(
      `No API key for provider "${providerLabel(provider)}": set its environment variable, pass the apiKey plugin option, or sign in to the "${providerLabel(provider)}" provider in OpenCode`,
    )
  }
  if (!/^[\x21-\x7e]+$/.test(apiKey)) {
    throw new Error("The API key contains invalid characters")
  }
  return { provider, apiKey }
}

/** Pull a human-readable message out of an OpenAI-style error body. */
function extractErrorMessage(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } }
    const message = parsed?.error?.message
    if (typeof message === "string" && message.trim()) return message.trim()
  } catch {
    // Not JSON: use the raw body.
  }
  return text
}

/** Normalize a remote error code/message for an error string. */
function remoteMessage(value: unknown, fallback: string): string {
  const text = typeof value === "string" && value.trim() ? value.trim() : fallback
  const sanitized = text.replace(
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/g,
    " ",
  )
  return Array.from(sanitized)
    .slice(0, 300)
    .join("")
    .replace(/[\uD800-\uDFFF]/gu, "\uFFFD")
}

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const MAX_ERROR_BYTES = 64 * 1024

/** Read a response stream up to `maxBytes`, then stop (bounded memory). */
async function readStreamLimited(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ""
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await withAbort(reader.read(), signal)
      if (done) break
      if (!value) continue
      bytes += value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {})
        break
      }
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // Already released.
    }
  }
}

/** Read a text body, streaming when the transport exposes a body. */
async function readTextLimited(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  const body = response.body
  if (!body) return withAbort(response.text(), signal)
  return readStreamLimited(body, maxBytes, signal)
}

/** Read a JSON body, streaming when the transport exposes a body. */
async function readJsonLimited(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const body = response.body
  if (!body) return withAbort(response.json(), signal)
  const text = await readStreamLimited(body, maxBytes, signal)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error("Web search API returned an invalid response")
  }
}

/** POST JSON to a native DeepSeek tool endpoint and parse the response. */
async function postNativeTool(
  url: string,
  apiKey: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  if (signal?.aborted) throwCancellation(signal, undefined)
  const response = await withAbort(
    fetch(url, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    }),
    signal,
  )

  if (!response.ok) {
    const text = await readTextLimited(response, MAX_ERROR_BYTES, signal).catch((error: unknown) => {
      if (signal?.aborted) return throwCancellation(signal, error)
      if ((error as { name?: string } | undefined)?.name === "AbortError") throw error
      const detail = error instanceof Error ? error.message : String(error)
      return `[body read failed: ${detail}]`
    })
    if (signal?.aborted) throwCancellation(signal, undefined)
    throw new Error(
      `Web search API error ${response.status}: ${remoteMessage(extractErrorMessage(text), "unknown error")}`,
    )
  }

  const data = await readJsonLimited(response, MAX_RESPONSE_BYTES, signal)
  if (signal?.aborted) throwCancellation(signal, undefined)
  return data
}

/** Fetch one page as Markdown; any non-abort failure is treated as absent. */
async function fetchNativePage(
  baseUrl: string,
  apiKey: string,
  url: string,
  signal?: AbortSignal,
): Promise<{ title?: string; content?: string } | undefined> {
  try {
    await fetchRateLimiter.next(signal)
    const data = (await postNativeTool(`${baseUrl}/v1/tools/fetch`, apiKey, { url }, signal)) as
      | { title?: unknown; content?: unknown }
      | undefined
    return { title: readString(data?.title), content: readString(data?.content) }
  } catch (error) {
    if (signal?.aborted) throwCancellation(signal, error)
    return undefined
  }
}

/** Replace the top-N snippets with full page Markdown, respecting 5 QPS. */
async function enrichWithFetch(
  baseUrl: string,
  apiKey: string,
  sources: readonly DeepSeekSource[],
  limit: number,
  signal?: AbortSignal,
): Promise<DeepSeekSource[]> {
  const enriched = [...sources]
  const count = Math.min(limit, enriched.length)
  let failed = 0
  for (let index = 0; index < count; index++) {
    const source = enriched[index]
    if (!source) continue
    const page = await fetchNativePage(baseUrl, apiKey, source.url, signal)
    if (!page) {
      failed++
      continue
    }
    enriched[index] = {
      ...source,
      title: page.title || source.title,
      content: page.content || source.content,
    }
  }
  if (failed > 0) {
    console.warn(
      `[opencode-websearch-deepseek] fetch enrichment failed for ${failed} of ${count} results`,
    )
  }
  return enriched
}

/** Run one search through the native Search & Fetch APIs. */
async function nativeSearch(
  ctx: WebsearchContext,
  options: WebsearchOptions,
  query: string,
  signal?: AbortSignal,
): Promise<{ answer: string; sources: DeepSeekSource[] }> {
  // The native Search API accepts 1-128 Unicode characters.
  if (exceedsCodePoints(query, 128)) {
    throw new Error("query must be at most 128 characters for the native search API")
  }
  const { apiKey } = await requireApiKey(ctx, options, signal)
  const baseUrl = resolveSearchBaseUrl(options)
  const count = pickIntegerInRange(options.count, 1, MAX_COUNT) ?? resolveCount(readEnv("WEBSEARCH_COUNT"))
  const needContent =
    pickBoolean(options.needContent) ?? resolveNeedContent(readEnv("WEBSEARCH_NEED_CONTENT"))
  const fetchCount =
    pickIntegerInRange(options.fetch, 0, MAX_COUNT) ?? resolveFetchCount(readEnv("WEBSEARCH_FETCH"))

  await searchRateLimiter.next(signal)
  const data = (await postNativeTool(
    `${baseUrl}/v1/tools/search`,
    apiKey,
    { query, count, need_content: needContent },
    signal,
  )) as NativeSearchResponse | undefined

  if (!data || !Array.isArray(data.results)) {
    const message = (data as { error?: { message?: unknown } } | undefined)?.error?.message
    if (typeof message === "string" && message.trim()) {
      throw new Error(`Web search API error: ${remoteMessage(message, "unknown error")}`)
    }
    throw new Error("Web search API returned no results array")
  }

  let sources = mapNativeResults(data.results)
  if (fetchCount > 0 && sources.length > 0) {
    sources = await enrichWithFetch(baseUrl, apiKey, sources, fetchCount, signal)
  }
  // A cancellation may arrive after the last fetch completed.
  if (signal?.aborted) throwCancellation(signal, undefined)
  return { answer: "", sources }
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
  searchApi: SearchApi = resolveSearchApi(options),
): Promise<{ answer: string; sources: DeepSeekSource[] }> {
  const provider = resolveProvider(options)
  // Reject absurd raw input before any linear work.
  if (searchApi !== "native" && typeof query === "string" && query.length > MAX_RAW_MESSAGE_QUERY_LENGTH) {
    throw new Error("query is too long")
  }
  const trimmedQuery = typeof query === "string" ? query.trim() : ""
  try {
    if (!trimmedQuery) throw new Error("query must be a non-empty string")
    if (searchApi === "native" && exceedsCodePoints(trimmedQuery, 128)) {
      throw new Error("query must be at most 128 characters for the native search API")
    }
    if (searchApi !== "native" && exceedsCodePoints(trimmedQuery, MAX_MESSAGE_QUERY_LENGTH)) {
      throw new Error(`query must be at most ${MAX_MESSAGE_QUERY_LENGTH} characters`)
    }
    // Cancellation wins over configuration and credential lookups.
    if (signal?.aborted) throwCancellation(signal, undefined)
    if (searchApi === "native") {
      return await nativeSearch(ctx, options, trimmedQuery, signal)
    }

    // Resolve the endpoint first so an unknown provider fails before key/model.
    const endpoint = resolveEndpoint(options)
    const { apiKey } = await requireApiKey(ctx, options, signal)
    if (!model) {
      throw new Error(
        `No model for provider "${providerLabel(provider)}": set the model plugin option or WEBSEARCH_MODEL`,
      )
    }

    const body = buildRequestBody(trimmedQuery, {
      model,
      maxUses: pickMaxUses(options.maxUses) ?? resolveMaxUses(readEnv("WEBSEARCH_MAX_USES")),
      thinking: pickThinking(options.thinking) ?? resolveThinking(readEnv("WEBSEARCH_THINKING")),
    })

    if (signal?.aborted) throwCancellation(signal, undefined)
    const response = await withAbort(
      fetch(endpoint, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      }),
      signal,
    )

    if (!response.ok) {
      const text = await readTextLimited(response, MAX_ERROR_BYTES, signal).catch((error: unknown) => {
        // Preserve cancellation: never turn an abort into an API error.
        if (signal?.aborted) return throwCancellation(signal, error)
        if ((error as { name?: string } | undefined)?.name === "AbortError") throw error
        const detail = error instanceof Error ? error.message : String(error)
        return `[body read failed: ${detail}]`
      })
      // An abort can also arrive after the body resolves; re-check so it is
      // not masked as an API error.
      if (signal?.aborted) throwCancellation(signal, undefined)
      throw new Error(
        `Web search API error ${response.status}: ${remoteMessage(extractErrorMessage(text), "unknown error")}`,
      )
    }

    const data = (await readJsonLimited(response, MAX_RESPONSE_BYTES, signal)) as DeepSeekResponse
    // A cancellation may arrive after the response completed.
    if (signal?.aborted) throwCancellation(signal, undefined)
    if (!data || !Array.isArray(data.content)) {
      const message = (data as { error?: { message?: unknown } } | undefined)?.error?.message
      if (typeof message === "string" && message.trim()) {
        throw new Error(`Web search API error: ${remoteMessage(message, "unknown error")}`)
      }
      throw new Error("Web search API returned an invalid response")
    }
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
    const searchApi = resolveSearchApi(options)
    if (searchApi === "native") {
      // Validate the native endpoint configuration at startup (fail fast).
      resolveSearchBaseUrl(options)
    }

    // Resolve the model once, but re-try lazily if the first attempt timed out
    // (e.g. a slow model API on start-up for a non-preset provider). The native
    // Search API needs no model, so skip the lookup entirely.
    let cachedModel: string | undefined =
      searchApi === "native"
        ? undefined
        : ((await raceTimeout(resolveModel(ctx, options), 2000)) ?? getPreset(provider)?.defaultModel)
    const getModel = async (signal?: AbortSignal): Promise<string | undefined> => {
      if (searchApi === "native") return undefined
      if (cachedModel) return cachedModel
      if (signal?.aborted) throwCancellation(signal, undefined)
      try {
        const resolved = await raceTimeout(resolveModel(ctx, options), 2000, signal)
        if (signal?.aborted) throwCancellation(signal, undefined)
        cachedModel = resolved ?? getPreset(provider)?.defaultModel
        return cachedModel
      } catch (error) {
        if (signal?.aborted) throwCancellation(signal, error)
        throw error
      }
    }

    await ctx.websearch.transform((editor) => {
      editor.add({
        id: provider,
        name: providerDisplay(provider),
        execute: async ({ query }, context) => {
          if (context?.signal?.aborted) throwCancellation(context.signal, undefined)
          const model = await getModel(context?.signal)
          const { answer, sources } = await searchDeepSeek(
            ctx,
            options,
            model,
            query,
            context?.signal,
            searchApi,
          )
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
            description: "Search the web and return relevant results with source URLs.",
            input: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  minLength: 1,
                  maxLength: searchApi === "native" ? 128 : MAX_MESSAGE_QUERY_LENGTH,
                  description:
                    searchApi === "native"
                      ? "Search query (up to 128 characters)"
                      : "Search query",
                },
              },
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
              const query = typeof input?.query === "string" ? input.query : ""
              if (context?.signal?.aborted) throwCancellation(context.signal, undefined)
              const model = await getModel(context?.signal)
              const { answer, sources } = await searchDeepSeek(
                ctx,
                options,
                model,
                query,
                context?.signal,
                searchApi,
              )
              return {
                output: { answer, sources: toSourceObjects(sources) },
                content: toContent(answer, sources) || "The search returned no results.",
              }
            },
          })
        })
      } catch (error) {
        // Best effort: the websearch provider still works without the tool.
        console.warn(
          "[opencode-websearch-deepseek] Code Mode tool registration failed:",
          error instanceof Error ? error.message : String(error),
        )
      }
    }
  },
}

export default plugin
