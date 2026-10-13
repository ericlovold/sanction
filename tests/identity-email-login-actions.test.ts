import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ find: vi.fn(), limit: vi.fn(), signin: vi.fn(), verify: vi.fn() }))
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: mocks.find } } }))
vi.mock("@/lib/auth-config", () => ({ auth: { api: { signInMagicLink: mocks.signin, magicLinkVerify: mocks.verify } } }))
vi.mock("@/lib/rateLimit", () => ({ rateLimit: mocks.limit, ipFromHeaders: () => "test-ip" }))
vi.mock("next/headers", () => ({ headers: async () => new Headers() }))
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`) } }))
import { requestIdentityEmailLogin, confirmIdentityEmailLogin } from "@/app/connect/mcp/login/actions"
import { issueIdentityEmailEnvelope } from "@/lib/identityEmailLogin"
const form = (entries: Record<string,string>) => { const f = new FormData(); for (const [k,v] of Object.entries(entries)) f.set(k,v); return f }
describe("identity email login actions", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("BETTER_AUTH_SECRET", "test-only-identity-secret-long-enough-for-hmac"); mocks.limit.mockResolvedValue({ok:true}); mocks.find.mockResolvedValue({id:"reviewer"}); mocks.signin.mockResolvedValue({status:true}); mocks.verify.mockResolvedValue({user:{}}) })
  it("requests only existing normalized users with bound destination", async () => {
    expect(await requestIdentityEmailLogin({sent:false,error:""}, form({email:" Reviewer@Example.com ",callback_url:"/connect/mcp"}))).toEqual({sent:true,error:""})
    expect(mocks.signin).toHaveBeenCalledWith({headers:expect.any(Headers),body:{email:"reviewer@example.com",callbackURL:"/connect/mcp"}})
    mocks.find.mockResolvedValue(null); mocks.signin.mockClear()
    expect(await requestIdentityEmailLogin({sent:false,error:""},form({email:"absent@example.com"}))).toEqual({sent:true,error:""})
    expect(mocks.signin).not.toHaveBeenCalled()
  })
  it("limits requests before sending and hides address throttle", async () => {
    mocks.limit.mockResolvedValueOnce({ok:false})
    expect((await requestIdentityEmailLogin({sent:false,error:""},form({email:"reviewer@example.com"}))).sent).toBe(false)
    mocks.limit.mockResolvedValueOnce({ok:true}).mockResolvedValueOnce({ok:false})
    expect(await requestIdentityEmailLogin({sent:false,error:""},form({email:"reviewer@example.com"}))).toEqual({sent:true,error:""})
    expect(mocks.signin).not.toHaveBeenCalled()
  })
  it("ignores callback fields on confirmation and consumes only signed credential", async () => {
    const token = await issueIdentityEmailEnvelope("original","reviewer@example.com","/connect/mcp")
    await expect(confirmIdentityEmailLogin({error:""},form({token,callback_url:"https://evil.test"}))).rejects.toThrow("REDIRECT:/connect/mcp")
    expect(mocks.verify).toHaveBeenCalledWith({headers:expect.any(Headers),query:{token:"original"}})
  })
  it("fails closed on malformed envelope or provider refusal", async () => {
    expect((await confirmIdentityEmailLogin({error:""},form({token:"invalid"}))).error).toContain("invalid")
    expect(mocks.verify).not.toHaveBeenCalled()
    mocks.verify.mockRejectedValue(new Error("expired"))
    const token = await issueIdentityEmailEnvelope("original","reviewer@example.com","/dashboard")
    expect((await confirmIdentityEmailLogin({error:""},form({token}))).error).toContain("expired")
  })
})
