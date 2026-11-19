import { costUsd } from "./gateway"

// Upper bound for one response, and the reservation when a caller sets no
// output limit. The request is forwarded unchanged: a default written into the
// body would silently truncate answers, and a small estimate without one would
// let a governed agent buy large outputs against a tiny hold.
const MAX_OUTPUT_TOKENS = 131_072
const MAX_REQUEST_BYTES = 8 * 1024 * 1024
const FIXED_INPUT_OVERHEAD = 1024
const MESSAGE_INPUT_OVERHEAD = 256

export class GatewayReservationRequestError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = "GatewayReservationRequestError"
  }
}

type JsonObject = Record<string, unknown>

function invalid(message: string): never {
  throw new GatewayReservationRequestError("GATEWAY_RESERVATION_INVALID_REQUEST", message)
}

function unsupported(message: string): never {
  throw new GatewayReservationRequestError("GATEWAY_RESERVATION_UNSUPPORTED", message)
}

/** Validate original bytes before any JSON rewrite can shrink the body or
 * replace invalid UTF-8. Returns the decoded text without normalizing it. */
export function validateGatewayRequestBytes(rawBody: ArrayBuffer | undefined): string {
  if (!rawBody || !rawBody.byteLength || rawBody.byteLength > MAX_REQUEST_BYTES) invalid(`The request body must be non-empty JSON no larger than ${MAX_REQUEST_BYTES} bytes.`)
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(rawBody)
  } catch {
    invalid("The request body must be valid UTF-8 JSON.")
  }
}

function object(value: unknown, at: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${at} must be a JSON object.`)
  return value as JsonObject
}

function fields(value: JsonObject, allowed: string, at: string): void {
  const keys = new Set(allowed.split(" "))
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) unsupported(`${at}.${key} is not supported by gateway reservations. Send explicit text and client function tools; media, stored context, retrieval, and server tools cannot be sized.`)
  }
}

function text(value: unknown, at: string): asserts value is string {
  if (typeof value !== "string") invalid(`${at} must be text.`)
}

function list(value: unknown, at: string): unknown[] {
  if (!Array.isArray(value) || !value.length) invalid(`${at} must be a non-empty array.`)
  return value
}

function limit(value: unknown, at: string, allowZero = false): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > MAX_OUTPUT_TOKENS) {
    throw new GatewayReservationRequestError("GATEWAY_RESERVATION_INVALID_LIMIT", `${at} must be an integer from ${allowZero ? 0 : 1} to ${MAX_OUTPUT_TOKENS}.`)
  }
  return value
}

type Estimate = { output: number; messages: number; defaultedOutput?: boolean; hiddenInputTokens?: number }

/** The caller's own output limit, or the maximum when it set none. Never written back. */
function outputLimit(body: JsonObject, key: string): { output: number; defaultedOutput: boolean } {
  if (!Object.hasOwn(body, key)) return { output: MAX_OUTPUT_TOKENS, defaultedOutput: true }
  return { output: limit(body[key], key), defaultedOutput: false }
}

const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength

function oneCandidate(value: unknown, at: string): void {
  if (value !== undefined && value !== 1) unsupported(`${at} must be 1. Submit separate requests for multiple candidates so each reserves its own budget.`)
}

// Schemas and tool arguments are client-provided JSON, fully counted in the
// forwarded bytes. External schema references would add uncounted context.
function schema(value: unknown, at: string, depth = 0): void {
  if (depth > 64) unsupported(`${at} exceeds the supported schema nesting depth.`)
  if (Array.isArray(value)) {
    value.forEach((entry) => schema(entry, at, depth + 1))
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if ((key === "$ref" || key === "$dynamicRef") && (typeof entry !== "string" || !entry.startsWith("#"))) {
        unsupported(`${at} may only use local schema references beginning with #.`)
      }
      schema(entry, at, depth + 1)
    }
  }
}

function cacheControl(value: unknown, at: string): void {
  if (value === undefined) return
  const cache = object(value, at)
  fields(cache, "type ttl", at)
  if (cache.type !== "ephemeral" || (cache.ttl !== undefined && cache.ttl !== "5m" && cache.ttl !== "1h")) {
    unsupported(`${at} supports only ephemeral caching with a 5m or 1h TTL.`)
  }
}

function anthropicText(value: unknown, at: string): void {
  if (typeof value === "string") return
  for (const entry of list(value, at)) {
    const block = object(entry, at)
    fields(block, "type text cache_control", at)
    if (block.type !== "text") unsupported(`${at} supports text blocks only; include media or file contents as explicit text.`)
    text(block.text, `${at}.text`)
    cacheControl(block.cache_control, `${at}.cache_control`)
  }
}

function anthropicRequest(body: JsonObject): Estimate {
  fields(body, "model messages max_tokens system metadata stop_sequences stream temperature top_p top_k tools tool_choice thinking output_config cache_control service_tier", "request")
  // Anthropic requires max_tokens and documents it as the hard ceiling on all
  // output, thinking included, so it bounds every thinking mode below.
  if (!Object.hasOwn(body, "max_tokens")) invalid("max_tokens is required for Anthropic messages.")
  const output = limit(body.max_tokens, "max_tokens")
  let hiddenInputTokens = 0
  const messages = list(body.messages, "messages")
  for (const entry of messages) {
    const message = object(entry, "messages[]")
    fields(message, "role content", "messages[]")
    if (message.role !== "user" && message.role !== "assistant") invalid("messages[].role must be user or assistant.")
    if (typeof message.content === "string") continue
    for (const value of list(message.content, "messages[].content")) {
      const block = object(value, "messages[].content[]")
      if (block.type === "thinking" || block.type === "redacted_thinking") {
        // Replayed reasoning is billed as input on models that keep prior
        // turns' thinking. Anthropic documents the signature (and redacted
        // data) as an encrypted copy of the full reasoning, so its encoded
        // size bounds the hidden tokens. Those bytes are already in the body
        // estimate; count them once more for margin over encoding overhead.
        if (message.role !== "assistant") invalid("Thinking blocks may only appear in assistant messages.")
        const sealed = block.type === "thinking" ? "signature" : "data"
        fields(block, block.type === "thinking" ? "type thinking signature" : "type data", block.type)
        if (block.type === "thinking") text(block.thinking, "thinking.thinking")
        text(block[sealed], `${block.type}.${sealed}`)
        if (!(block[sealed] as string).length) invalid(`${block.type}.${sealed} must be non-empty.`)
        hiddenInputTokens += utf8Bytes(block[sealed] as string)
      } else if (block.type === "tool_use") {
        fields(block, "type id name input cache_control", "tool_use")
        text(block.id, "tool_use.id")
        text(block.name, "tool_use.name")
        object(block.input, "tool_use.input")
        cacheControl(block.cache_control, "tool_use.cache_control")
      } else if (block.type === "tool_result") {
        fields(block, "type tool_use_id content is_error cache_control", "tool_result")
        text(block.tool_use_id, "tool_result.tool_use_id")
        anthropicText(block.content, "tool_result.content")
        cacheControl(block.cache_control, "tool_result.cache_control")
      } else {
        anthropicText([block], "messages[].content")
      }
    }
  }
  if (body.system !== undefined) anthropicText(body.system, "system")
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools)) invalid("tools must be an array.")
    for (const entry of body.tools) {
      const tool = object(entry, "tools[]")
      fields(tool, "name description input_schema cache_control strict", "tools[]")
      text(tool.name, "tools[].name")
      schema(object(tool.input_schema, "tools[].input_schema"), "tools[].input_schema")
      cacheControl(tool.cache_control, "tools[].cache_control")
    }
  }
  if (body.tool_choice !== undefined) {
    const choice = object(body.tool_choice, "tool_choice")
    fields(choice, "type name disable_parallel_tool_use", "tool_choice")
    if (!["auto", "any", "tool", "none"].includes(String(choice.type))) unsupported("tool_choice must select a client function tool.")
  }
  if (body.thinking !== undefined) {
    // Every mode, with or without tools, is bounded by max_tokens above. The
    // provider validates budget placement (interleaved thinking may exceed
    // max_tokens across a turn); the reservation does not need to.
    const thinking = object(body.thinking, "thinking")
    fields(thinking, "type budget_tokens display", "thinking")
    if (thinking.type === "enabled") limit(thinking.budget_tokens, "thinking.budget_tokens")
    else if (!["adaptive", "disabled", "between_tools"].includes(String(thinking.type))) {
      unsupported("thinking.type must be adaptive, enabled, between_tools, or disabled.")
    } else if (thinking.budget_tokens !== undefined) invalid("thinking.budget_tokens applies only to enabled thinking.")
    if (thinking.display !== undefined && !["summarized", "omitted", "updates"].includes(String(thinking.display))) {
      unsupported("thinking.display must be summarized, omitted, or updates.")
    }
  }
  if (body.output_config !== undefined) {
    const config = object(body.output_config, "output_config")
    fields(config, "effort format", "output_config")
    if (config.format !== undefined) {
      const format = object(config.format, "output_config.format")
      fields(format, "type schema", "output_config.format")
      if (format.type !== "json_schema") unsupported("output_config.format must be json_schema.")
      schema(format.schema, "output_config.format.schema")
    }
  }
  cacheControl(body.cache_control, "cache_control")
  return { output, messages: messages.length + (body.system === undefined ? 0 : 1), hiddenInputTokens }
}

function openaiText(value: unknown, at: string, responses: boolean): void {
  if (typeof value === "string") return
  for (const entry of list(value, at)) {
    const part = object(entry, at)
    fields(part, responses && part.type === "output_text" ? "type text annotations" : "type text", at)
    if (!(responses ? ["input_text", "output_text"] : ["text"]).includes(String(part.type))) {
      unsupported(`${at} supports text only; media, files, and stored items cannot be sized.`)
    }
    text(part.text, `${at}.text`)
    if (part.annotations !== undefined) {
      if (!Array.isArray(part.annotations)) invalid(`${at}.annotations must be an array.`)
      if (part.annotations.length > 0) unsupported(`${at}.annotations must be empty; file, URL, and container references are not supported by text-only reservations.`)
    }
  }
}

// IDs/status label a fully supplied inline item. They never substitute for its
// text or function arguments; item_reference remains outside the allowlist.
function responseItemMetadata(item: JsonObject, at: string): void {
  if (item.id !== undefined) {
    text(item.id, `${at}.id`)
    if (!item.id.trim()) invalid(`${at}.id must be a non-empty string.`)
  }
  if (item.status !== undefined && (typeof item.status !== "string" || !["in_progress", "completed", "incomplete"].includes(item.status))) {
    invalid(`${at}.status must be in_progress, completed, or incomplete.`)
  }
}

function functionCall(value: unknown, at: string): void {
  const call = object(value, at)
  fields(call, "name arguments", at)
  text(call.name, `${at}.name`)
  text(call.arguments, `${at}.arguments`)
}

function functionDefinition(value: unknown, at: string, responses = false): void {
  const fn = object(value, at)
  fields(fn, responses ? "type name description parameters strict" : "name description parameters strict", at)
  text(fn.name, `${at}.name`)
  if (fn.parameters !== undefined) schema(object(fn.parameters, `${at}.parameters`), `${at}.parameters`)
}

function openaiTools(body: JsonObject, responses: boolean): void {
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools)) invalid("tools must be an array.")
    for (const entry of body.tools) {
      const tool = object(entry, "tools[]")
      if (tool.type !== "function") unsupported("tools[] supports client function tools only. Remove web search, file search, computer use, and other server tools.")
      if (responses) functionDefinition(tool, "tools[]", true)
      else {
        fields(tool, "type function", "tools[]")
        functionDefinition(tool.function, "tools[].function")
      }
    }
  }
  if (body.functions !== undefined) {
    if (!Array.isArray(body.functions)) invalid("functions must be an array.")
    body.functions.forEach((fn) => functionDefinition(fn, "functions[]"))
  }
  if (body.tool_choice !== undefined && typeof body.tool_choice !== "string") {
    const choice = object(body.tool_choice, "tool_choice")
    fields(choice, responses ? "type name" : "type function", "tool_choice")
    if (choice.type !== "function") unsupported("tool_choice must select a client function tool.")
    if (responses) text(choice.name, "tool_choice.name")
    else {
      const fn = object(choice.function, "tool_choice.function")
      fields(fn, "name", "tool_choice.function")
      text(fn.name, "tool_choice.function.name")
    }
  }
}

function responseFormat(value: unknown, at: string, responses = false): void {
  const format = object(value, at)
  fields(format, responses ? "type name description schema strict" : "type json_schema", at)
  if (!["text", "json_object", "json_schema"].includes(String(format.type))) unsupported(`${at} must describe text or JSON output.`)
  if (format.type === "json_schema") {
    const json = responses ? format : object(format.json_schema, `${at}.json_schema`)
    if (!responses) fields(json, "name description schema strict", `${at}.json_schema`)
    schema(object(json.schema, `${at}.schema`), `${at}.schema`)
  }
}

function openaiRequest(body: JsonObject, path: string): Estimate {
  if (path === "v1/embeddings") {
    fields(body, "model input encoding_format dimensions user", "request")
    const inputs = typeof body.input === "string" ? [body.input] : list(body.input, "input")
    inputs.forEach((input) => text(input, "input[]"))
    return { output: 0, messages: inputs.length }
  }
  if (path === "v1/completions") {
    fields(body, "model prompt max_tokens temperature top_p n stream stream_options logprobs echo stop presence_penalty frequency_penalty best_of logit_bias user seed suffix", "request")
    oneCandidate(body.n, "n")
    oneCandidate(body.best_of, "best_of")
    const prompts = typeof body.prompt === "string" ? [body.prompt] : list(body.prompt, "prompt")
    if (prompts.length !== 1) unsupported("prompt must contain one text prompt. Submit separate completion requests for multiple prompts.")
    text(prompts[0], "prompt")
    return { ...outputLimit(body, "max_tokens"), messages: 1 }
  }
  const responses = path === "v1/responses"
  fields(body, responses
    ? "model input instructions max_output_tokens temperature top_p stream tools tool_choice parallel_tool_calls text reasoning metadata store user service_tier background truncation"
    : "model messages max_tokens max_completion_tokens temperature top_p n stop stream stream_options tools tool_choice functions function_call response_format presence_penalty frequency_penalty logit_bias logprobs top_logprobs seed user metadata store service_tier reasoning_effort parallel_tool_calls verbosity modalities", "request")
  if (body.background !== undefined && body.background !== false) unsupported("background must be false or omitted. A reservation requires usage on this response.")
  oneCandidate(body.n, "n")
  if (body.modalities !== undefined && (!Array.isArray(body.modalities) || body.modalities.length !== 1 || body.modalities[0] !== "text")) unsupported("modalities must contain only text.")
  if (!responses && Object.hasOwn(body, "max_tokens")) {
    if (Object.hasOwn(body, "max_completion_tokens")) invalid("Send either max_tokens or max_completion_tokens, not both.")
    // Normalize the legacy field to the cap that includes reasoning tokens.
    body.max_completion_tokens = limit(body.max_tokens, "max_tokens")
    delete body.max_tokens
  }
  const { output, defaultedOutput } = outputLimit(body, responses ? "max_output_tokens" : "max_completion_tokens")
  const input = responses ? body.input : body.messages
  const messages = responses && typeof input === "string" ? [{ role: "user", content: input }] : list(input, responses ? "input" : "messages")
  for (const entry of messages) {
    const message = object(entry, "messages[]")
    if (responses && message.type === "function_call_output") {
      fields(message, "type call_id output", "input.function_call_output")
      text(message.call_id, "input.function_call_output.call_id")
      text(message.output, "input.function_call_output.output")
    } else if (responses && message.type === "function_call") {
      fields(message, "type call_id name arguments id status", "input.function_call")
      text(message.call_id, "input.function_call.call_id")
      text(message.name, "input.function_call.name")
      text(message.arguments, "input.function_call.arguments")
      responseItemMetadata(message, "input.function_call")
    } else {
      fields(message, responses ? "type role content id status phase" : "role content name tool_call_id tool_calls function_call refusal", "messages[]")
      if (responses && message.type !== undefined && message.type !== "message") unsupported("input supports explicit messages and function calls only; stored items cannot be sized.")
      if (!["user", "assistant", "system", "developer", ...(responses ? [] : ["tool", "function"])].includes(String(message.role))) invalid("messages[].role is not supported.")
      if (!(message.content == null && !responses && (message.tool_calls || message.function_call))) openaiText(message.content, "messages[].content", responses)
      if (responses) {
        responseItemMetadata(message, "messages[]")
        if (message.phase !== undefined && (message.role !== "assistant" ||
            (message.phase !== null && message.phase !== "commentary" && message.phase !== "final_answer"))) {
          invalid("messages[].phase must be commentary, final_answer, or null on an assistant message.")
        }
      }
      if (message.function_call !== undefined) functionCall(message.function_call, "messages[].function_call")
      if (message.tool_calls !== undefined) {
        for (const value of list(message.tool_calls, "messages[].tool_calls")) {
          const call = object(value, "messages[].tool_calls[]")
          fields(call, "id type function", "messages[].tool_calls[]")
          if (call.type !== "function") unsupported("messages[].tool_calls[] supports client function tools only.")
          text(call.id, "messages[].tool_calls[].id")
          functionCall(call.function, "messages[].tool_calls[].function")
        }
      }
    }
  }
  if (body.instructions !== undefined) text(body.instructions, "instructions")
  openaiTools(body, responses)
  if (body.response_format !== undefined) responseFormat(body.response_format, "response_format")
  if (body.text !== undefined) {
    const config = object(body.text, "text")
    fields(config, "format verbosity", "text")
    if (config.format !== undefined) responseFormat(config.format, "text.format", true)
  }
  if (body.reasoning !== undefined) fields(object(body.reasoning, "reasoning"), "effort summary", "reasoning")
  return { output, defaultedOutput, messages: messages.length + (body.instructions === undefined ? 0 : 1) }
}

function geminiContent(value: unknown, at: string): void {
  const content = object(value, at)
  fields(content, "role parts", at)
  for (const entry of list(content.parts, `${at}.parts`)) {
    const part = object(entry, `${at}.parts[]`)
    fields(part, "text functionCall functionResponse", `${at}.parts[]`)
    if (Object.keys(part).length !== 1) invalid(`${at}.parts[] must contain one text or client function value.`)
    if (part.text !== undefined) text(part.text, `${at}.parts[].text`)
    else if (part.functionCall !== undefined) {
      const call = object(part.functionCall, "functionCall")
      fields(call, "name args id", "functionCall")
      text(call.name, "functionCall.name")
      object(call.args, "functionCall.args")
    } else {
      const result = object(part.functionResponse, "functionResponse")
      fields(result, "name response id", "functionResponse")
      text(result.name, "functionResponse.name")
      object(result.response, "functionResponse.response")
    }
  }
}

function geminiRequest(body: JsonObject): Estimate {
  fields(body, "contents systemInstruction generationConfig tools toolConfig safetySettings labels", "request")
  const contents = list(body.contents, "contents")
  contents.forEach((content) => geminiContent(content, "contents[]"))
  if (body.systemInstruction !== undefined) geminiContent(body.systemInstruction, "systemInstruction")
  const config = body.generationConfig === undefined ? {} : object(body.generationConfig, "generationConfig")
  fields(config, "maxOutputTokens temperature topP topK stopSequences candidateCount presencePenalty frequencyPenalty seed responseMimeType responseSchema responseJsonSchema thinkingConfig responseModalities logprobs responseLogprobs", "generationConfig")
  oneCandidate(config.candidateCount, "generationConfig.candidateCount")
  // Google documents maxOutputTokens as the cap on thinking and answer tokens
  // combined (ai.google.dev/gemini-api/docs/thinking), so it bounds every
  // thinking setting, including dynamic thinking and thinking levels.
  const { output, defaultedOutput } = outputLimit(config, "maxOutputTokens")
  if (config.responseModalities !== undefined && (!Array.isArray(config.responseModalities) || config.responseModalities.length !== 1 || config.responseModalities[0] !== "TEXT")) unsupported("generationConfig.responseModalities must contain only TEXT.")
  if (config.responseMimeType !== undefined && config.responseMimeType !== "text/plain" && config.responseMimeType !== "application/json") unsupported("generationConfig.responseMimeType must be text/plain or application/json.")
  if (config.responseSchema !== undefined) schema(config.responseSchema, "generationConfig.responseSchema")
  if (config.responseJsonSchema !== undefined) schema(config.responseJsonSchema, "generationConfig.responseJsonSchema")
  if (config.thinkingConfig !== undefined) {
    const thinking = object(config.thinkingConfig, "generationConfig.thinkingConfig")
    fields(thinking, "thinkingBudget includeThoughts thinkingLevel", "generationConfig.thinkingConfig")
    // -1 selects dynamic thinking; otherwise a finite budget, 0 turns it off.
    if (thinking.thinkingBudget !== undefined && thinking.thinkingBudget !== -1) {
      limit(thinking.thinkingBudget, "generationConfig.thinkingConfig.thinkingBudget", true)
    }
    if (thinking.thinkingLevel !== undefined &&
      !["minimal", "low", "medium", "high", "xhigh"].includes(String(thinking.thinkingLevel).toLowerCase())) {
      invalid("generationConfig.thinkingConfig.thinkingLevel must be minimal, low, medium, high, or xhigh.")
    }
  }
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools)) invalid("tools must be an array.")
    for (const value of body.tools) {
      const tool = object(value, "tools[]")
      fields(tool, "functionDeclarations", "tools[]")
      for (const entry of list(tool.functionDeclarations, "tools[].functionDeclarations")) {
        const fn = object(entry, "functionDeclarations[]")
        fields(fn, "name description parameters parametersJsonSchema", "functionDeclarations[]")
        text(fn.name, "functionDeclarations[].name")
        if (fn.parameters !== undefined) schema(fn.parameters, "functionDeclarations[].parameters")
        if (fn.parametersJsonSchema !== undefined) schema(fn.parametersJsonSchema, "functionDeclarations[].parametersJsonSchema")
      }
    }
  }
  if (body.toolConfig !== undefined) {
    const toolConfig = object(body.toolConfig, "toolConfig")
    fields(toolConfig, "functionCallingConfig", "toolConfig")
    fields(object(toolConfig.functionCallingConfig, "toolConfig.functionCallingConfig"), "mode allowedFunctionNames", "toolConfig.functionCallingConfig")
  }
  return { output, defaultedOutput, messages: contents.length + (body.systemInstruction === undefined ? 0 : 1) }
}

/** Prepare an estimated-token budget reservation, not a provider invoice quote.
 * Full UTF-8 request bytes plus framing headroom deliberately overestimate
 * ordinary text input; this is not a tokenizer proof for arbitrary providers.
 * Only explicit text/client functions are supported: unknown input mechanisms
 * must be reviewed before they may spend against a finite reservation. */
export function prepareGatewayRequest(provider: string, path: string, rawBody: ArrayBuffer | undefined): {
  body: ArrayBuffer
  model: string
  reservedUsd: number
  /** True when the caller set no output limit and the maximum was reserved. */
  defaultedOutput: boolean
} {
  const geminiModel = path.match(/^v1(?:alpha|beta)?\/models\/([^/:]+):(?:generateContent|streamGenerateContent)$/)?.[1]
  if (provider === "perplexity") {
    // Search adds server-side prompt material absent from the submitted bytes.
    unsupported("Perplexity search requests cannot be conservatively reserved because retrieval adds hidden input. Use a supported text-only provider request.")
  }
  if (!((provider === "anthropic" && path === "v1/messages") ||
    (provider === "openai" && ["v1/chat/completions", "v1/responses", "v1/completions", "v1/embeddings"].includes(path)) ||
    (provider === "gemini" && geminiModel))) unsupported(`Gateway reservations do not support ${provider}/${path}. Use a supported text-generation or text-embedding endpoint.`)
  const decoded = validateGatewayRequestBytes(rawBody)
  let parsed: unknown
  try {
    parsed = JSON.parse(decoded, (_key, value: unknown) => {
      if (typeof value === "number" && !Number.isFinite(value)) invalid("All JSON numbers must be finite.")
      return value
    })
  } catch (error) {
    if (error instanceof GatewayReservationRequestError) throw error
    invalid("The request body must be valid UTF-8 JSON.")
  }
  const request = object(parsed, "request")
  const model = provider === "gemini" ? geminiModel : request.model
  if (typeof model !== "string" || !model.trim()) invalid("model must be a non-empty string.")
  const estimate = provider === "anthropic" ? anthropicRequest(request)
    : provider === "gemini" ? geminiRequest(request) : openaiRequest(request, path)
  const encoded = new TextEncoder().encode(JSON.stringify(request))
  const tokensIn = encoded.byteLength + FIXED_INPUT_OVERHEAD + MESSAGE_INPUT_OVERHEAD * estimate.messages + (estimate.hiddenInputTokens ?? 0)
  const cache = provider === "anthropic" ? { cacheWriteTokens: tokensIn, cacheWrite1hTokens: tokensIn } : {}
  return {
    body: encoded.buffer, model, reservedUsd: costUsd(model, tokensIn, estimate.output, cache),
    defaultedOutput: estimate.defaultedOutput === true,
  }
}
