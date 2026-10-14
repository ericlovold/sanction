import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ find: vi.fn(), limit: vi.fn(), signin: vi.fn(), verify: vi.fn(), redirect: vi.fn() }))
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: mocks.find } } }))
vi.mock("@/lib/auth-config", () => ({ auth: { api: { signInMagicLink: mocks.signin, magicLinkVerify: mocks.verify } } }))
vi.mock("@/lib/rateLimit", () => ({ rateLimit: mocks.limit, ipFromHeaders: () => "test-ip" }))
vi.mock("next/headers", () => ({ headers: async () => new Headers() }))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
import { requestIdentityEmailLogin, confirmIdentityEmailLogin } from "@/app/connect/mcp/login/actions"
import { identityEmailRateKey, issueIdentityEmailEnvelope } from "@/lib/identityEmailLogin"
const form = (entries: Record<string,string>) => { const f = new FormData(); for (const [k,v] of Object.entries(entries)) f.set(k,v); return f }
describe("identity email login actions", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("BETTER_AUTH_SECRET", "test-only-identity-secret-long-enough-for-hmac"); mocks.limit.mockResolvedValue({ok:true}); mocks.find.mockResolvedValue({id:"reviewer"}); mocks.signin.mockResolvedValue({status:true}); mocks.verify.mockResolvedValue({user:{}}); mocks.redirect.mockImplementation((path: string) => { throw new Error(`REDIRECT:${path}`) }) })
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
  it("rejects confirmation at the IP throttle before verifying or redirecting", async () => {
    const token = await issueIdentityEmailEnvelope("original", "reviewer@example.com", "/connect/mcp")
    mocks.limit.mockResolvedValueOnce({ ok: false })

    await expect(confirmIdentityEmailLogin({ error: "" }, form({ token }))).resolves.toEqual({
      error: "Too many attempts. Try again later.",
    })
    expect(mocks.limit).toHaveBeenCalledExactlyOnceWith("identity_email_verify_ip", "test-ip", 20, 600)
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
  it("rejects confirmation at the email throttle before verifying or redirecting", async () => {
    const token = await issueIdentityEmailEnvelope("original", "reviewer@example.com", "/connect/mcp")
    mocks.limit.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false })

    await expect(confirmIdentityEmailLogin({ error: "" }, form({ token }))).resolves.toEqual({
      error: "Too many attempts. Try again later.",
    })
    expect(mocks.limit).toHaveBeenCalledTimes(2)
    expect(mocks.limit).toHaveBeenNthCalledWith(1, "identity_email_verify_ip", "test-ip", 20, 600)
    expect(mocks.limit).toHaveBeenNthCalledWith(2, "identity_email_verify_email", identityEmailRateKey("reviewer@example.com"), 10, 600)
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
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
