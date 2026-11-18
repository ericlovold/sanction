import { describe, expect, it, vi } from "vitest"
import { costUsd } from "../lib/gateway"
import { GatewayReservationRequestError, prepareGatewayRequest } from "../lib/gatewayRequestBudget"

vi.mock("../lib/db", () => ({ db: {} }))

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer
const decode = (body: ArrayBuffer) => JSON.parse(new TextDecoder().decode(body))
const chat = (extra: Record<string, unknown> = {}) => ({ model: "gpt-4o", messages: [{ role: "user", content: "Hello" }], ...extra })
const anthropic = (extra: Record<string, unknown> = {}) => ({ model: "claude-sonnet-5", messages: [{ role: "user", content: "Hello" }], ...extra })
const gemini = (extra: Record<string, unknown> = {}) => ({ contents: [{ role: "user", parts: [{ text: "Hello" }] }], generationConfig: { thinkingConfig: { thinkingBudget: 0 } }, ...extra })
const geminiPath = "v1beta/models/gemini-2.5-pro:generateContent"

function expectError(provider: string, path: string, body: unknown, message: string, code = "GATEWAY_RESERVATION_UNSUPPORTED") {
  let error: unknown
  try { prepareGatewayRequest(provider, path, encode(body)) } catch (caught) { error = caught }
  expect(error).toBeInstanceOf(GatewayReservationRequestError)
  expect(error).toMatchObject({ code, message: expect.stringContaining(message) })
}

describe("gateway request reservation sizing", () => {
  it.each([
    ["anthropic", "v1/messages", anthropic(), "max_tokens"],
    ["openai", "v1/chat/completions", chat(), "max_completion_tokens"],
    ["openai", "v1/responses", { model: "gpt-4o", input: "Hello" }, "max_output_tokens"],
    ["openai", "v1/completions", { model: "gpt-4o", prompt: "Hello" }, "max_tokens"],
  ])("injects a finite default output cap for %s/%s", (provider, path, request, key) => {
    const result = prepareGatewayRequest(provider as string, path as string, encode(request))
    expect(decode(result.body)[key as string]).toBe(1024)
    expect(result.reservedUsd).toBeGreaterThan(0)
  })

  it("normalizes the legacy chat limit to a cap that includes reasoning", () => {
    const result = prepareGatewayRequest("openai", "v1/chat/completions", encode(chat({ max_tokens: 23 })))
    expect(decode(result.body)).toMatchObject({ max_completion_tokens: 23 })
    expect(decode(result.body)).not.toHaveProperty("max_tokens")
    expect(result.reservedUsd).toBeLessThan(prepareGatewayRequest("openai", "v1/chat/completions", encode(chat())).reservedUsd)
  })

  it("sizes the actual forwarded UTF-8 bytes and message framing", () => {
    const result = prepareGatewayRequest("openai", "v1/chat/completions", encode(chat({
      max_completion_tokens: 80,
      messages: [{ role: "system", content: "日本語" }, { role: "user", content: "😀" }],
      tools: [{ type: "function", function: { name: "lookup", description: "x".repeat(2000), parameters: { type: "object" } } }],
    })))
    const characters = new TextDecoder().decode(result.body).length
    expect(result.body.byteLength).toBeGreaterThan(characters)
    expect(result.reservedUsd).toBe(costUsd("gpt-4o", result.body.byteLength + 1024 + 2 * 256, 80))
  })

  it("reserves the entire Anthropic input at the highest supported cache-write multiplier", () => {
    const result = prepareGatewayRequest("anthropic", "v1/messages", encode(anthropic({
      max_tokens: 200,
      system: [{ type: "text", text: "Rules", cache_control: { type: "ephemeral", ttl: "1h" } }],
      cache_control: { type: "ephemeral" },
    })))
    const tokensIn = result.body.byteLength + 1024 + 2 * 256
    expect(result.reservedUsd).toBe(costUsd(result.model, tokensIn * 2, 200))
    expect(result.reservedUsd).toBeGreaterThan(costUsd(result.model, tokensIn, 200))
  })

  it("preserves supplied caps and client text for Responses", () => {
    const request = { model: "gpt-4o", input: "Hello", max_output_tokens: 300, instructions: "Be brief", background: false }
    const result = prepareGatewayRequest("openai", "v1/responses", encode(request))
    expect(decode(result.body)).toEqual(request)
    expect(result.reservedUsd).toBe(costUsd(result.model, result.body.byteLength + 1024 + 2 * 256, 300))
  })

  it("sizes every text embedding input without reserving output tokens", () => {
    const request = { model: "gpt-4o", input: ["one", "two", "日本語"], encoding_format: "float" }
    const result = prepareGatewayRequest("openai", "v1/embeddings", encode(request))
    expect(decode(result.body)).toEqual(request)
    expect(result.reservedUsd).toBe(costUsd(result.model, result.body.byteLength + 1024 + 3 * 256, 0))
    expect(prepareGatewayRequest("openai", "v1/embeddings", encode({ model: "gpt-4o", input: "hello" })).reservedUsd).toBeGreaterThan(0)
  })

  it("accounts for Gemini thinking separately from candidate output and injects the output cap", () => {
    const result = prepareGatewayRequest("gemini", geminiPath, encode(gemini({ generationConfig: { thinkingConfig: { thinkingBudget: 300 } } })))
    expect(result.model).toBe("gemini-2.5-pro")
    expect(decode(result.body).generationConfig).toEqual({ maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 300 } })
    expect(result.reservedUsd).toBe(costUsd(result.model, result.body.byteLength + 1024 + 256, 1324))
  })

  it("uses the existing positive fallback estimate for an unknown model", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const result = prepareGatewayRequest("openai", "v1/responses", encode({ model: "unknown-budget-model", input: "Hi" }))
      expect(result.reservedUsd).toBeGreaterThan(0)
      expect(warn).toHaveBeenCalled()
    } finally { warn.mockRestore() }
  })
})

describe("finite request limits", () => {
  it.each([0, -1, 0.5, null, "100", 131073, Number.NaN, Number.POSITIVE_INFINITY])("rejects max_completion_tokens=%s", (max_completion_tokens) => {
    expectError("openai", "v1/chat/completions", chat({ max_completion_tokens }), "max_completion_tokens", "GATEWAY_RESERVATION_INVALID_LIMIT")
  })

  it.each([
    ["anthropic", "v1/messages", anthropic({ max_tokens: 0 }), "max_tokens"],
    ["openai", "v1/responses", { model: "gpt-4o", input: "Hi", max_output_tokens: 0 }, "max_output_tokens"],
    ["openai", "v1/completions", { model: "gpt-4o", prompt: "Hi", max_tokens: 0 }, "max_tokens"],
    ["gemini", geminiPath, gemini({ generationConfig: { maxOutputTokens: 0, thinkingConfig: { thinkingBudget: 0 } } }), "maxOutputTokens"],
    ["gemini", geminiPath, gemini({ generationConfig: { thinkingConfig: { thinkingBudget: -1 } } }), "thinkingBudget"],
  ])("rejects an invalid provider limit for %s/%s", (provider, path, body, field) => {
    expectError(provider as string, path as string, body, field as string, "GATEWAY_RESERVATION_INVALID_LIMIT")
  })

  it("rejects conflicting chat output limits", () => {
    expectError("openai", "v1/chat/completions", chat({ max_tokens: 20, max_completion_tokens: 30 }), "either", "GATEWAY_RESERVATION_INVALID_REQUEST")
  })

  it.each([0, 2, -1, 1.5, null, "1"])('rejects multiple or invalid candidates n=%s', (n) => {
    expectError("openai", "v1/chat/completions", chat({ n }), "n must be 1")
  })

  it("rejects hidden best_of output, batched completions, and Gemini candidate multiplication", () => {
    expectError("openai", "v1/completions", { model: "gpt-4o", prompt: "Hi", best_of: 2 }, "best_of must be 1")
    expectError("openai", "v1/completions", { model: "gpt-4o", prompt: ["Hi", "Bye"] }, "one text prompt")
    expectError("gemini", geminiPath, gemini({ generationConfig: { candidateCount: 2 } }), "candidateCount must be 1")
    expect(decode(prepareGatewayRequest("openai", "v1/completions", encode({ model: "gpt-4o", prompt: ["Hi"], best_of: 1, n: 1 })).body).max_tokens).toBe(1024)
  })

  it("requires explicit Gemini thinking instead of automatic or level-based thinking", () => {
    expectError("gemini", geminiPath, gemini({ generationConfig: undefined }), "thinkingBudget")
    expectError("gemini", geminiPath, gemini({ generationConfig: { thinkingConfig: { thinkingLevel: "high" } } }), "thinkingLevel")
  })
})

describe("unsupported hidden input and output", () => {
  it.each(["previous_response_id", "conversation", "prompt", "cached_content", "future_hidden_input"])('rejects Responses field %s', (field) => {
    expectError("openai", "v1/responses", { model: "gpt-4o", input: "Hi", [field]: "server-reference" }, field)
  })

  it.each([
    { type: "input_image", image_url: "https://example.com/large.png" },
    { type: "input_file", file_id: "file-hidden" },
    { type: "input_audio", data: "AA==" },
    { type: "input_text", text: "Hi", future_hidden_input: "server-id" },
  ])("rejects media and unknown content fields %#", (content) => {
    expectError("openai", "v1/responses", { model: "gpt-4o", input: [{ role: "user", content: [content] }] }, "not supported")
  })

  it("rejects stored response item references and background requests", () => {
    expectError("openai", "v1/responses", { model: "gpt-4o", input: [{ type: "item_reference", id: "item-hidden" }] }, "id")
    expectError("openai", "v1/responses", { model: "gpt-4o", input: "Hi", background: true }, "background")
  })

  it.each(["web_search_preview", "file_search", "computer_use_preview", "mcp", "code_interpreter"])('rejects server tool %s', (type) => {
    expectError("openai", "v1/responses", { model: "gpt-4o", input: "Hi", tools: [{ type }] }, "client function")
  })

  it("rejects provider-native retrieval and media", () => {
    expectError("anthropic", "v1/messages", anthropic({ tools: [{ type: "web_search_20250305", name: "web_search" }] }), "tools[].type")
    expectError("anthropic", "v1/messages", anthropic({ messages: [{ role: "user", content: [{ type: "image", source: {} }] }] }), "source")
    expectError("anthropic", "v1/messages", anthropic({ container: "server-container" }), "container")
    expectError("gemini", geminiPath, gemini({ cachedContent: "cachedContents/1" }), "cachedContent")
    expectError("gemini", geminiPath, gemini({ tools: [{ googleSearch: {} }] }), "googleSearch")
    expectError("gemini", geminiPath, gemini({ contents: [{ parts: [{ fileData: { fileUri: "gs://bucket/object" } }] }] }), "fileData")
    expectError("gemini", geminiPath, gemini({ contents: [{ parts: [{ text: "Hi", thoughtSignature: "hidden" }] }] }), "thoughtSignature")
  })

  it("rejects generated audio and media output", () => {
    expectError("openai", "v1/chat/completions", chat({ modalities: ["text", "audio"] }), "modalities")
    expectError("gemini", geminiPath, gemini({ generationConfig: { responseModalities: ["IMAGE"] } }), "responseModalities")
    expectError("gemini", geminiPath, gemini({ generationConfig: { responseMimeType: "image/png" } }), "responseMimeType")
  })

  it("rejects Perplexity search rather than reserving only its visible prompt", () => {
    expectError("perplexity", "chat/completions", { model: "sonar", messages: [{ role: "user", content: "Hi" }] }, "retrieval adds hidden input")
  })

  it.each([
    ["anthropic", "v1/messages/count_tokens"], ["openai", "v1/files"],
    ["openai", "v1/responses/previous"], ["gemini", "v1beta/models/x:countTokens"],
    ["constructor", "v1/chat/completions"],
  ])("rejects unsupported endpoint %s/%s", (provider, path) => {
    expectError(provider, path, {}, "do not support")
  })
})

describe("counted client function and structured text shapes", () => {
  const parameters = { type: "object", properties: { file: { type: "string" } }, $defs: { text: { type: "string" } }, $ref: "#/$defs/text" }

  it("preserves Anthropic client function exchange, schemas, and bounded thinking", () => {
    const request = anthropic({ max_tokens: 2000, thinking: { type: "enabled", budget_tokens: 1024 },
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "call-1", name: "lookup", input: { file: "report.txt" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call-1", content: [{ type: "text", text: "Result" }] }] },
      ],
      tools: [{ name: "lookup", input_schema: parameters, cache_control: { type: "ephemeral", ttl: "5m" } }],
      tool_choice: { type: "auto" }, output_config: { format: { type: "json_schema", schema: parameters } },
    })
    expect(decode(prepareGatewayRequest("anthropic", "v1/messages", encode(request)).body)).toEqual(request)
    expect(prepareGatewayRequest("anthropic", "v1/messages", encode(anthropic({ thinking: { type: "disabled" } }))).reservedUsd).toBeGreaterThan(0)
  })

  it("preserves chat client functions and JSON schema output", () => {
    const request = chat({ messages: [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "lookup", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call-1", content: "Result" },
    ], tools: [{ type: "function", function: { name: "lookup", parameters } }],
      tool_choice: { type: "function", function: { name: "lookup" } }, modalities: ["text"], n: 1,
      response_format: { type: "json_schema", json_schema: { name: "reply", schema: parameters } },
    })
    expect(decode(prepareGatewayRequest("openai", "v1/chat/completions", encode(request)).body)).toMatchObject(request)
    const legacy = chat({ functions: [{ name: "lookup", parameters }], messages: [{ role: "assistant", function_call: { name: "lookup", arguments: "{}" } }] })
    expect(prepareGatewayRequest("openai", "v1/chat/completions", encode(legacy)).reservedUsd).toBeGreaterThan(0)
  })

  it("preserves explicit Responses function exchange and structured text", () => {
    const request = { model: "gpt-4o", input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "Hi" }] },
      { type: "function_call", call_id: "call-1", name: "lookup", arguments: "{}" },
      { type: "function_call_output", call_id: "call-1", output: "Result" },
      { role: "assistant", content: [{ type: "output_text", text: "Done" }] },
    ], tools: [{ type: "function", name: "lookup", parameters }], tool_choice: { type: "function", name: "lookup" },
      text: { format: { type: "json_schema", name: "reply", schema: parameters }, verbosity: "low" }, reasoning: { effort: "low", summary: "auto" },
    }
    expect(decode(prepareGatewayRequest("openai", "v1/responses", encode(request)).body)).toMatchObject(request)
  })

  it("preserves Gemini client functions, JSON output, and explicit disabled thinking", () => {
    const request = gemini({ contents: [
      { role: "model", parts: [{ functionCall: { name: "lookup", args: {} } }] },
      { role: "user", parts: [{ functionResponse: { name: "lookup", response: { result: "Hi" } } }] },
    ], systemInstruction: { parts: [{ text: "Be brief" }] },
      tools: [{ functionDeclarations: [{ name: "lookup", parameters, parametersJsonSchema: parameters }] }],
      toolConfig: { functionCallingConfig: { mode: "AUTO", allowedFunctionNames: ["lookup"] } },
      generationConfig: { maxOutputTokens: 50, thinkingConfig: { thinkingBudget: 0 }, responseModalities: ["TEXT"], responseMimeType: "application/json", responseSchema: parameters, responseJsonSchema: parameters },
    })
    const result = prepareGatewayRequest("gemini", "v1/models/gemini-2.5-pro:streamGenerateContent", encode(request))
    expect(decode(result.body)).toEqual(request)
    expect(result.reservedUsd).toBe(costUsd(result.model, result.body.byteLength + 1024 + 3 * 256, 50))
  })

  it("rejects external schema references and unsupported cache or thinking settings", () => {
    expectError("anthropic", "v1/messages", anthropic({ tools: [{ name: "lookup", input_schema: { $ref: "https://example.com/schema" } }] }), "local schema")
    expectError("anthropic", "v1/messages", anthropic({ cache_control: { type: "ephemeral", ttl: "24h" } }), "5m or 1h")
    expectError("anthropic", "v1/messages", anthropic({ thinking: { type: "adaptive" } }), "explicit budget_tokens")
    expectError("anthropic", "v1/messages", anthropic({ max_tokens: 20, thinking: { type: "enabled", budget_tokens: 20 } }), "less than max_tokens", "GATEWAY_RESERVATION_INVALID_REQUEST")
  })
})

describe("malformed requests fail closed", () => {
  it.each([undefined, new ArrayBuffer(0), new ArrayBuffer(8 * 1024 * 1024 + 1)])("rejects absent, empty, or oversized bodies", (body) => {
    expect(() => prepareGatewayRequest("openai", "v1/chat/completions", body)).toThrow("non-empty JSON")
  })

  it.each(["not-json", "{\"model\":NaN}", "{\"model\":\"gpt-4o\",\"max_completion_tokens\":1e400}"])("rejects invalid or nonfinite JSON: %s", (body) => {
    expect(() => prepareGatewayRequest("openai", "v1/chat/completions", new TextEncoder().encode(body).buffer)).toThrow(GatewayReservationRequestError)
  })

  it("rejects invalid UTF-8 instead of silently replacing characters", () => {
    expect(() => prepareGatewayRequest("openai", "v1/chat/completions", new Uint8Array([0xff]).buffer)).toThrow("valid UTF-8 JSON")
  })

  it.each([null, [], "text", { model: "" }, { model: "gpt-4o", messages: [] }, { model: "gpt-4o", messages: [null] }, chat({ messages: [{ role: "user", content: 5 }] })])("rejects malformed text input %#", (body) => {
    expectError("openai", "v1/chat/completions", body, "must", "GATEWAY_RESERVATION_INVALID_REQUEST")
  })

  it("rejects token-id arrays for the explicitly text-only embeddings contract", () => {
    expectError("openai", "v1/embeddings", { model: "gpt-4o", input: [1, 2, 3] }, "must be text", "GATEWAY_RESERVATION_INVALID_REQUEST")
  })
})
