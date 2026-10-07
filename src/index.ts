/**
 * opencode-websearch-deepseek
 *
 * A DeepSeek-powered web search provider for OpenCode's built-in `websearch`
 * tool. It registers through the OpenCode V2 plugin API
 * (`ctx.websearch.transform`) as a native search provider — no MCP server
 * required.
 *
 * Queries are answered by DeepSeek's Anthropic-compatible Messages API using
 * the server-side `web_search_20250305` tool. The provider returns a
 * synthesized answer plus the source URLs it was based on.
 *
 * Environment:
 *   DEEPSEEK_API_KEY     (required)  DeepSeek API key.
 *   WEBSEARCH_API_KEY    (optional)  Generic fallback API key.
 *   WEBSEARCH_MODEL      (optional)  Model override, defaults to "deepseek-v4-flash".
 *   WEBSEARCH_MAX_USES   (optional)  Max server-side searches per query, defaults to 5.
 *   WEBSEARCH_THINKING   (optional)  "enabled" (default) or "disabled".
 */

/** Default DeepSeek model used for search + synthesis. */
export const DEFAULT_MODEL = "deepseek-v4-flash"

/** Default number of server-side searches DeepSeek may run per query. */
export const DEFAULT_MAX_USES = 5

/** Anthropic API version header required by the DeepSeek compatibility layer. */
export const ANTHROPIC_VERSION = "2023-06-01"

/** DeepSeek Anthropic-compatible Messages endpoint. */
export const API_URL = "https://api.deepseek.com/anthropic/v1/messages"

/** Fallback URL used when a result has no source of its own. */
export const FALLBACK_URL = "https://api.deepseek.com"

/** Server-side web search tool type understood by the DeepSeek API. */
export const WEB_SEARCH_TOOL_TYPE = "web_search_20250305"

/**
 * System prompt that keeps DeepSeek from emitting tool-call XML or looping on
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

/** A source URL reported by DeepSeek's server-side search. */
export interface DeepSeekSource {
  url: string
  title?: string
}

/** Options accepted by {@link buildRequestBody}. */
export interface BuildRequestOptions {
  model: string
  maxUses: number
  thinking: "enabled" | "disabled"
  maxTokens?: number
  system?: string
}

/** Minimal shape of a content block in a DeepSeek Anthropic-style response. */
interface ResponseBlock {
  type?: string
  text?: string
  content?: unknown
}

/** Minimal shape of a DeepSeek Anthropic-style Messages response. */
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

/** Context passed to the plugin's `setup`. */
export interface WebsearchContext {
  websearch: {
    transform(callback: (editor: WebsearchEditor) => void): Promise<unknown> | unknown
  }
}

/** Read an environment variable, treating blank strings as unset. */
function readEnv(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[name]
  return value && value.trim() ? value.trim() : undefined
}

/**
 * Resolve the `max_uses` value for the search tool declaration.
 * Falls back to {@link DEFAULT_MAX_USES} for missing or invalid input.
 */
export function resolveMaxUses(raw: string | undefined = process.env.WEBSEARCH_MAX_USES): number {
  const parsed = Number.parseInt((raw ?? "").trim(), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_USES
}

/**
 * Resolve the thinking mode. Only `disabled` disables extended thinking;
 * anything else (including unset) keeps the historical `enabled` behavior.
 */
export function resolveThinking(
  raw: string | undefined = process.env.WEBSEARCH_THINKING,
): "enabled" | "disabled" {
  const value = (raw ?? "").trim().toLowerCase()
  return value === "disabled" || value === "off" || value === "false" || value === "0"
    ? "disabled"
    : "enabled"
}

/** Build the JSON request body sent to the DeepSeek Messages endpoint. */
export function buildRequestBody(query: string, options: BuildRequestOptions): Record<string, unknown> {
  const tool: Record<string, unknown> = {
    type: WEB_SEARCH_TOOL_TYPE,
    name: "web_search",
    max_uses: options.maxUses,
  }

  const body: Record<string, unknown> = {
    model: options.model,
    max_tokens: options.maxTokens ?? 32768,
    messages: [
      { role: "system", content: options.system ?? SYSTEM_PROMPT },
      { role: "user", content: query },
    ],
    tools: [tool],
    tool_choice: { type: "auto" },
  }

  if (options.thinking === "enabled") {
    body.thinking = { type: "enabled" }
  }

  return body
}

/** Remove duplicate sources by URL while preserving first-seen order. */
export function dedupeSources(sources: readonly DeepSeekSource[]): DeepSeekSource[] {
  const seen = new Set<string>()
  const unique: DeepSeekSource[] = []
  for (const source of sources) {
    if (!source?.url || seen.has(source.url)) continue
    seen.add(source.url)
    unique.push(source)
  }
  return unique
}

/**
 * Split a DeepSeek response into a synthesized answer and its source URLs.
 * Sources reported by multiple search rounds are de-duplicated by URL.
 */
export function extractAnswerAndSources(data: DeepSeekResponse): {
  answer: string
  sources: DeepSeekSource[]
} {
  const sources: DeepSeekSource[] = []
  const textParts: string[] = []

  for (const block of data?.content ?? []) {
    if (block?.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const item of block.content as Array<Record<string, unknown>>) {
        if (item?.type === "web_search_result" && typeof item.url === "string") {
          sources.push({
            url: item.url,
            title: typeof item.title === "string" ? item.title : item.url,
          })
        }
      }
    } else if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
      textParts.push(block.text.trim())
    }
  }

  return { answer: textParts.join("\n\n"), sources: dedupeSources(sources) }
}

/**
 * Build the result list OpenCode expects: the synthesized answer first (when
 * present), followed by the individual sources.
 */
export function toResults(answer: string, sources: readonly DeepSeekSource[]): WebSearchResult[] {
  const results: WebSearchResult[] = []
  if (answer) {
    results.push({
      url: sources[0]?.url ?? FALLBACK_URL,
      title: "DeepSeek answer",
      content: answer,
      time: {},
    })
  }
  for (const source of sources) {
    results.push({ url: source.url, title: source.title || source.url, content: "", time: {} })
  }
  if (results.length === 0) {
    results.push({
      url: FALLBACK_URL,
      title: "DeepSeek web search",
      content: "The search returned no results.",
      time: {},
    })
  }
  return results
}

/** OpenCode plugin definition. */
export const plugin = {
  id: "websearch.deepseek",

  async setup(ctx: WebsearchContext): Promise<void> {
    await ctx.websearch.transform((editor) => {
      editor.add({
        id: "deepseek",
        name: "DeepSeek Web Search",
        execute: async ({ query }, { signal }) => {
          const apiKey = readEnv("DEEPSEEK_API_KEY") ?? readEnv("WEBSEARCH_API_KEY")
          if (!apiKey) {
            throw new Error("DEEPSEEK_API_KEY is not set in the OpenCode environment")
          }

          const body = buildRequestBody(query, {
            model: readEnv("WEBSEARCH_MODEL") ?? DEFAULT_MODEL,
            maxUses: resolveMaxUses(),
            thinking: resolveThinking(),
          })

          const response = await fetch(API_URL, {
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
            const text = await response.text().catch(() => "")
            throw new Error(`DeepSeek API error ${response.status}: ${text.slice(0, 300)}`)
          }

          const data = (await response.json()) as DeepSeekResponse
          const { answer, sources } = extractAnswerAndSources(data)
          return toResults(answer, sources)
        },
      })
      editor.default.set("deepseek")
    })
  },
}

export default plugin
