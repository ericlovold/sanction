import { AsyncLocalStorage } from "node:async_hooks"
import { mkdtemp, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { build } from "esbuild"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { createElement } from "react"
import type * as session from "../lib/session"

const db = {
  wallet: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  walletMember: { findFirst: vi.fn(), findMany: vi.fn() },
}
const getSession = vi.fn()
const cookieStore = { get: vi.fn(), set: vi.fn() }
const fixture = {
  db,
  auth: { api: { getSession } },
  cookies: async () => cookieStore,
  headers: async () => new Headers(),
}

type Runtime = typeof session & {
  createElement: typeof createElement
  renderToReadableStream: (
    element: ReturnType<typeof createElement>,
    manifest: object,
    options: { onError: (error: unknown) => void },
  ) => Promise<ReadableStream>
}
let runtime: Runtime
let temporaryDirectory: string

beforeAll(async () => {
  // Use Next's real RSC renderer and matching server React build. Ordinary
  // Vitest / react-dom SSR has no RSC cache dispatcher and cannot prove cache
  // behavior. Only IO is stubbed; React.cache is neither mocked nor emulated.
  temporaryDirectory = await mkdtemp(resolve(tmpdir(), "sanction-session-render-"))
  const outfile = resolve(temporaryDirectory, "session.cjs")
  const require = createRequire(import.meta.url)
  const react = require.resolve("next/dist/compiled/react/react.react-server.js")
  Object.assign(globalThis, { __sanctionSessionRenderFixture: fixture })
  await build({
    stdin: {
      contents: `export * from "./lib/session";
        export { createElement } from "react";
        export { renderToReadableStream } from "next/dist/compiled/react-server-dom-webpack/server.node";`,
      resolveDir: resolve(import.meta.dirname, ".."),
    },
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: {
      react,
      "next/dist/compiled/react": react,
      "react-dom": require.resolve("next/dist/compiled/react-dom/react-dom.react-server.js"),
    },
    plugins: [{
      name: "session-io",
      setup(builder) {
        builder.onResolve({ filter: /^(\.\/db|\.\/auth-config|next\/headers|\.\/log)$/ }, args => ({ path: args.path, namespace: "session-io" }))
        builder.onLoad({ filter: /.*/, namespace: "session-io" }, args => ({
          contents: {
            "./db": "export const db = globalThis.__sanctionSessionRenderFixture.db",
            "./auth-config": "export const auth = globalThis.__sanctionSessionRenderFixture.auth",
            "next/headers": "export const { cookies, headers } = globalThis.__sanctionSessionRenderFixture",
            "./log": "export const logger = () => ({ info() {}, warn() {}, error() {} })",
          }[args.path],
        }))
      },
    }],
  })
  runtime = require(outfile) as Runtime
})

afterAll(async () => {
  vi.unstubAllEnvs()
  Reflect.deleteProperty(globalThis, "__sanctionSessionRenderFixture")
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
})

async function render<T>(read: () => Promise<T>): Promise<T> {
  let result: T | undefined
  let failure: unknown
  async function ServerComponent() {
    result = await read()
    return null
  }
  const stream = await runtime.renderToReadableStream(runtime.createElement(ServerComponent), {}, {
    onError: error => { failure = error },
  })
  await new Response(stream).text()
  if (failure) throw failure
  return result as T
}

const USER = { id: "user_owner", email: "owner@example.test", emailVerified: true }
const OWNED = { id: "owned", name: "Owned", userId: USER.id, ownerEmail: USER.email }
const SHARED = { id: "shared", name: "Shared", userId: "other", ownerEmail: "other@example.test" }

beforeEach(() => {
  vi.resetAllMocks()
  vi.unstubAllEnvs()
  getSession.mockResolvedValue({ user: USER })
  db.wallet.findUnique.mockImplementation(async ({ where }) => where.id === SHARED.id ? SHARED : OWNED)
  db.wallet.findFirst.mockResolvedValue(OWNED)
  db.wallet.findMany.mockResolvedValue([OWNED])
  db.walletMember.findMany.mockResolvedValue([])
})

function selectMembership(role: "admin" | "viewer") {
  cookieStore.get.mockImplementation(name => name === "sanction_active_wallet" ? { value: SHARED.id } : undefined)
  db.walletMember.findFirst.mockResolvedValue({ walletId: SHARED.id, userId: USER.id, status: "active", role })
  db.walletMember.findMany.mockResolvedValue([{ wallet: SHARED, role }])
}

describe("dashboard session reads in a React Server Component render", () => {
  it("deduplicates layout/page wallet reads and their wallet lists with one social-auth read", async () => {
    const result = await render(async () => {
      const [layout, page] = await Promise.all([runtime.getViewWallet(), runtime.getViewWallet()])
      const [sidebar, pageWallets] = await Promise.all([runtime.listViewWallets(), runtime.listViewWallets()])
      return { layout, page, sidebar, pageWallets }
    })
    expect(result.layout).toEqual({ id: OWNED.id, name: OWNED.name, isSession: true, role: "owner" })
    expect(result.page).toBe(result.layout)
    expect(result.sidebar).toEqual([{ id: OWNED.id, name: OWNED.name, role: "owner" }])
    expect(result.pageWallets).toBe(result.sidebar)
    expect(getSession).toHaveBeenCalledTimes(1)
    expect(db.wallet.findUnique).toHaveBeenCalledTimes(1)
    expect(db.wallet.findFirst).toHaveBeenCalledTimes(1)
    expect(db.wallet.findMany).toHaveBeenCalledTimes(1)
    expect(db.walletMember.findMany).toHaveBeenCalledTimes(1)
  })

  it("starts fresh for a different user on the next render", async () => {
    expect((await render(runtime.getViewWallet))?.id).toBe(OWNED.id)
    const nextUser = { id: "next_user", email: "next@example.test", emailVerified: true }
    const nextWallet = { id: "next_wallet", name: "Next", userId: nextUser.id, ownerEmail: nextUser.email }
    getSession.mockResolvedValue({ user: nextUser })
    db.wallet.findUnique.mockResolvedValue(nextWallet)
    db.wallet.findFirst.mockResolvedValue(nextWallet)
    expect((await render(runtime.getViewWallet))?.id).toBe(nextWallet.id)
    expect(getSession).toHaveBeenCalledTimes(2)
  })

  it("isolates overlapping users' render caches", async () => {
    const requests = new AsyncLocalStorage<typeof USER>()
    getSession.mockImplementation(async () => {
      const user = requests.getStore()
      await new Promise(resolve => setImmediate(resolve))
      return { user }
    })
    db.wallet.findUnique.mockResolvedValue(null)
    db.wallet.findFirst.mockImplementation(async ({ where }) => ({ id: where.userId, name: where.userId, userId: where.userId }))
    const second = { ...USER, id: "second_user", email: "second@example.test" }
    const [firstResult, secondResult] = await Promise.all([USER, second].map(user => requests.run(user, () => render(async () => {
      const [a, b] = await Promise.all([runtime.getViewWallet(), runtime.getViewWallet()])
      expect(a).toBe(b)
      return a
    }))))
    expect(firstResult?.id).toBe(USER.id)
    expect(secondResult?.id).toBe(second.id)
    expect(getSession).toHaveBeenCalledTimes(2)
  })

  it("observes role changes and membership revocation on subsequent renders", async () => {
    selectMembership("admin")
    expect((await render(runtime.getViewWallet))?.role).toBe("admin")
    selectMembership("viewer")
    expect((await render(runtime.getViewWallet))?.role).toBe("viewer")
    db.walletMember.findFirst.mockResolvedValue(null)
    db.walletMember.findMany.mockResolvedValue([])
    const result = await render(async () => ({ view: await runtime.getViewWallet(), wallets: await runtime.listViewWallets() }))
    expect(result.view).toMatchObject({ id: OWNED.id, role: "owner" })
    expect(result.wallets).toEqual([{ id: OWNED.id, name: OWNED.name, role: "owner" }])
    expect(getSession).toHaveBeenCalledTimes(3)
  })

  it("rechecks action role floors after an earlier cached view in the same render", async () => {
    selectMembership("admin")
    await render(async () => {
      expect((await runtime.getViewWallet())?.role).toBe("admin")
      selectMembership("viewer")
      expect(await runtime.requireSessionRole("admin")).toBeNull()
      expect((await runtime.getSessionMember())?.role).toBe("viewer")
      expect(await runtime.listSessionWallets()).toContainEqual({ id: SHARED.id, name: SHARED.name, role: "viewer" })
    })
    expect(getSession).toHaveBeenCalledTimes(4)
  })

  it("rechecks auth revocation before an action even after caching a signed-in view", async () => {
    await render(async () => {
      expect((await runtime.getViewWallet())?.isSession).toBe(true)
      getSession.mockResolvedValue(null)
      expect(await runtime.requireSessionRole("admin")).toBeNull()
      expect(await runtime.getSessionWallet()).toBeNull()
      expect(await runtime.listSessionWallets()).toEqual([])
    })
    expect(getSession).toHaveBeenCalledTimes(4)
  })

  it("reads wallet selection changes afresh in actions and subsequent renders", async () => {
    selectMembership("admin")
    await render(async () => {
      expect((await runtime.getViewWallet())?.id).toBe(SHARED.id)
      cookieStore.set.mockImplementation((name, value) => cookieStore.get.mockImplementation(key => key === name ? { value } : undefined))
      await runtime.setActiveWallet(OWNED.id)
      expect((await runtime.getSessionMember())?.wallet.id).toBe(OWNED.id)
    })
    expect((await render(runtime.getViewWallet))?.id).toBe(OWNED.id)
  })

  it("shares failures within a render without retaining them on the next request", async () => {
    getSession.mockRejectedValue(new Error("auth unavailable"))
    await expect(render(async () => Promise.all([runtime.getViewWallet(), runtime.listViewWallets()]))).rejects.toThrow("temporarily unavailable")
    expect(getSession).toHaveBeenCalledTimes(1)
    expect(db.wallet.findUnique).not.toHaveBeenCalled()
    getSession.mockResolvedValue({ user: USER })
    expect((await render(runtime.getViewWallet))?.id).toBe(OWNED.id)
    expect(getSession).toHaveBeenCalledTimes(2)
  })

  it("keeps valid legacy fallback during social-auth failure", async () => {
    getSession.mockRejectedValue(new Error("auth unavailable"))
    cookieStore.get.mockImplementation(name => name === "sanction_session" ? { value: "sk_test_only" } : undefined)
    const result = await render(async () => ({ view: await runtime.getViewWallet(), wallets: await runtime.listViewWallets() }))
    expect(result.view).toMatchObject({ id: OWNED.id, role: "owner", isSession: true })
    expect(result.wallets).toEqual([{ id: OWNED.id, name: OWNED.name, role: "owner" }])
    expect(getSession).toHaveBeenCalledTimes(1)
  })

  it("deduplicates public demo reads only for genuinely anonymous sessions", async () => {
    vi.stubEnv("SANCTION_WALLET_ID", "demo")
    getSession.mockResolvedValue(null)
    db.wallet.findUnique.mockResolvedValue({ id: "demo", name: "Demo" })
    const views = await render(async () => Promise.all([runtime.getViewWallet(), runtime.getViewWallet()]))
    expect(views[0]).toEqual({ id: "demo", name: "Demo", role: "viewer", isSession: false })
    expect(views[1]).toBe(views[0])
    expect(getSession).toHaveBeenCalledTimes(1)
    expect(db.wallet.findUnique).toHaveBeenCalledTimes(1)
    getSession.mockRejectedValue(new Error("auth unavailable"))
    await expect(render(runtime.getViewWallet)).rejects.toThrow("temporarily unavailable")
  })
})
