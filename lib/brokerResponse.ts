/** Reserved metadata is evidence minted by Sanction, never by an upstream. */
const JSON_LIMIT = 8 * 1024 * 1024
const SSE_FRAME_LIMIT = 1024 * 1024
const encoder = new TextEncoder()

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function stripMetadata(value: unknown): void {
  if (!record(value) || !record(value._meta)) return
  for (const key of Object.keys(value._meta)) {
    if (key.startsWith("sanction/")) delete value._meta[key]
  }
}

function sanitizeMessage(value: unknown): unknown {
  for (const message of Array.isArray(value) ? value : [value]) {
    stripMetadata(message)
    if (record(message)) stripMetadata(message.result)
  }
  return value
}

function sanitizeJson(text: string): string {
  return JSON.stringify(sanitizeMessage(JSON.parse(text)))
}

function sanitizeFrame(bytes: number[], firstFrame: boolean): Uint8Array {
  const lines = new TextDecoder("utf-8", { fatal: true, ignoreBOM: !firstFrame }).decode(new Uint8Array(bytes)).split("\n")
  // The frame accumulator includes the terminating newline of each nonempty line.
  if (lines.at(-1) === "") lines.pop()
  const data: string[] = []
  const preserved: string[] = []
  let insertion = -1
  for (const line of lines) {
    const colon = line.indexOf(":")
    const field = colon === -1 ? line : line.slice(0, colon)
    if (field === "data") {
      if (insertion === -1) insertion = preserved.length
      const value = colon === -1 ? "" : line.slice(colon + 1)
      data.push(value.startsWith(" ") ? value.slice(1) : value)
    } else {
      preserved.push(line)
    }
  }
  if (data.length) {
    const payload = data.join("\n")
    preserved.splice(insertion, 0, `data: ${payload === "" ? "" : sanitizeJson(payload)}`)
  }
  return encoder.encode(preserved.join("\n") + "\n\n")
}

/**
 * Wrap before adding broker-owned metadata. Each SSE frame is validated before
 * release; malformed/oversized bodies error the stream, never pass through raw.
 * Backpressure and cancellation stay connected to the upstream reader.
 */
export function sanitizeUpstreamResponse(res: Response): Response {
  if (!res.body) return res
  const mediaType = res.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase()
  const sse = mediaType === "text/event-stream"
  const json = mediaType === "application/json"
  const reader = res.body.getReader()
  let cancelled = false
  let chunk = new Uint8Array(0)
  let offset = 0
  let skipLf = false
  let frame: number[] = []
  let firstFrame = true
  let frameSize = 0
  let lineLength = 0

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!sse) {
          const decoder = new TextDecoder("utf-8", { fatal: true })
          let text = ""
          let size = 0
          while (true) {
            const next = await reader.read()
            if (cancelled) return
            if (next.done) break
            size += next.value.byteLength
            if ((!json && size > 0) || size > JSON_LIMIT) throw new Error("Unsupported or oversized upstream response")
            text += decoder.decode(next.value, { stream: true })
          }
          text += decoder.decode()
          // Bodyless acknowledgements (including DELETE) need no media type.
          if (size) controller.enqueue(encoder.encode(sanitizeJson(text)))
          controller.close()
          reader.releaseLock()
          return
        }

        while (!cancelled) {
          if (offset === chunk.length) {
            const next = await reader.read()
            if (cancelled) return
            if (next.done) {
              if (frame.length) throw new Error("Truncated upstream SSE frame")
              controller.close()
              reader.releaseLock()
              return
            }
            chunk = next.value
            offset = 0
          }
          while (offset < chunk.length) {
            const byte = chunk[offset++]
            if (skipLf) {
              skipLf = false
              if (byte === 10) {
                if (frame.length && ++frameSize > SSE_FRAME_LIMIT) throw new Error("Oversized upstream SSE frame")
                continue
              }
            }
            if (++frameSize > SSE_FRAME_LIMIT) throw new Error("Oversized upstream SSE frame")
            if (byte === 10 || byte === 13) {
              skipLf = byte === 13
              if (lineLength === 0) {
                const output = sanitizeFrame(frame, firstFrame)
                firstFrame = false
                frame = []
                frameSize = 0
                controller.enqueue(output)
                return
              }
              frame.push(10)
              lineLength = 0
            } else {
              frame.push(byte)
              lineLength++
            }
          }
        }
      } catch (error) {
        if (!cancelled) {
          controller.error(error)
          await reader.cancel(error).catch(() => {})
          reader.releaseLock()
        }
      }
    },
    async cancel(reason) {
      cancelled = true
      await reader.cancel(reason)
      reader.releaseLock()
    },
  })
  const headers = new Headers(res.headers)
  headers.delete("content-length")
  headers.delete("content-encoding")
  return new Response(body, { status: res.status, statusText: res.statusText, headers })
}
