import { EventEmitter } from "node:events"
import { createConnection, createServer, type Server, type Socket } from "node:net"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { gatewayLatencyProxy } from "./helpers/gatewayLatencyProxy"

vi.mock("node:net", () => ({ createConnection: vi.fn(), createServer: vi.fn() }))

function fakeSocket() {
  const socket = Object.assign(new EventEmitter(), {
    destroyed: false,
    setNoDelay: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(() => { socket.destroyed = true; socket.emit("close") }),
  })
  return socket
}

async function connectedProxy() {
  const upstream = fakeSocket()
  const downstream = fakeSocket()
  const server = Object.assign(new EventEmitter(), {
    listen: vi.fn((_port: number, _host: string, ready: () => void) => ready()),
    address: () => ({ address: "127.0.0.1", family: "IPv4", port: 6543 }),
    close: vi.fn((closed: () => void) => closed()),
  })
  vi.mocked(createServer).mockReturnValue(server as unknown as Server)
  vi.mocked(createConnection).mockReturnValue(upstream as unknown as Socket)
  const proxy = await gatewayLatencyProxy("postgresql://test@127.0.0.1:5432/disposable")
  const accept = vi.mocked(createServer).mock.calls[0][0] as (socket: Socket) => void
  accept(downstream as unknown as Socket)
  return { proxy, upstream, downstream, server }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
})
afterEach(() => { vi.useRealTimers() })

describe("gateway latency proxy delivery ordering", () => {
  it("rejects an RTT change until queued bytes drain, then permits immediate delivery", async () => {
    const { proxy, upstream, downstream } = await connectedProxy()
    try {
      proxy.setRoundTripMs(100)
      upstream.emit("data", Buffer.from("first"))
      expect(() => proxy.setRoundTripMs(0)).toThrow("network deliveries are pending")
      expect(() => proxy.setRoundTripMs(100)).not.toThrow()
      upstream.emit("data", Buffer.from("second"))
      expect(downstream.write).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(50)
      expect(downstream.write.mock.calls.map(([chunk]) => chunk.toString())).toEqual(["first", "second"])
      expect(() => proxy.setRoundTripMs(0)).not.toThrow()
      upstream.emit("data", Buffer.from("third"))
      expect(downstream.write.mock.calls.map(([chunk]) => chunk.toString())).toEqual(["first", "second", "third"])
    } finally {
      await proxy.close()
    }
  })

  it("cancels queued writes and socket endings when closed", async () => {
    const { proxy, upstream, downstream, server } = await connectedProxy()
    proxy.setRoundTripMs(100)
    upstream.emit("data", Buffer.from("queued"))
    upstream.emit("end")
    await proxy.close()
    await vi.runAllTimersAsync()
    expect(downstream.write).not.toHaveBeenCalled()
    expect(downstream.end).not.toHaveBeenCalled()
    expect(upstream.destroy).toHaveBeenCalledOnce()
    expect(downstream.destroy).toHaveBeenCalledOnce()
    expect(server.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    "postgresql://test@remote.example/disposable",
    "postgresql://test@127.0.0.1/disposable?host=remote.example",
    "postgresql://test@127.0.0.1/disposable?hostaddr=192.0.2.1",
    "postgresql://test@127.0.0.1/disposable?port=5433",
  ])("refuses non-loopback targets and connection overrides: %s", async (url) => {
    await expect(gatewayLatencyProxy(url)).rejects.toThrow(/loopback|host overrides/)
    expect(createServer).not.toHaveBeenCalled()
    expect(createConnection).not.toHaveBeenCalled()
  })
})
