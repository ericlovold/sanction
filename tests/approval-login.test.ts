import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const mocks=vi.hoisted(()=>({wallet:vi.fn(),create:vi.fn(),setSession:vi.fn(),clearSession:vi.fn(),send:vi.fn(),limit:vi.fn()}))
vi.mock("@/lib/db",()=>({db:{wallet:{findUnique:mocks.wallet},magicLink:{create:mocks.create}}}))
vi.mock("@/lib/session",()=>({setSession:mocks.setSession,clearSession:mocks.clearSession}))
vi.mock("@/lib/email",()=>({sendMagicLinkEmail:mocks.send}))
vi.mock("@/lib/rateLimit",()=>({rateLimit:mocks.limit,ipFromHeaders:()=>"127.0.0.1"}))
vi.mock("next/headers",()=>({headers:async()=>new Headers({host:"localhost:3113"})}))
vi.mock("next/navigation",()=>({redirect:(path:string)=>{throw new Error(`REDIRECT:${path}`)}}))
import {loginAction,requestMagicLinkAction} from "../app/login/actions"
function form(values:Record<string,string>){const f=new FormData();Object.entries(values).forEach(([k,v])=>f.set(k,v));return f}
beforeEach(()=>{vi.clearAllMocks();mocks.limit.mockResolvedValue({ok:true});mocks.wallet.mockResolvedValue({id:"wallet_1"});mocks.send.mockResolvedValue(undefined)})
afterEach(()=>vi.restoreAllMocks())
describe("interrupted approval sign-in",()=>{
 it("replaces the previous session only after validating the new wallet key and returns to review",async()=>{
  await expect(loginAction({error:""},form({management_key:"sk_test",next:"/dashboard/approvals?review=pa_1"}))).rejects.toThrow("REDIRECT:/dashboard/approvals?review=pa_1")
  expect(mocks.clearSession).toHaveBeenCalledOnce();expect(mocks.setSession).toHaveBeenCalledWith("sk_test")
  expect(mocks.clearSession.mock.invocationCallOrder[0]).toBeLessThan(mocks.setSession.mock.invocationCallOrder[0])
 })
 it("does not log the current user out when the replacement key is invalid",async()=>{
  mocks.wallet.mockResolvedValue(null)
  expect((await loginAction({error:""},form({management_key:"bad"}))).error).toContain("doesn't match")
  expect(mocks.clearSession).not.toHaveBeenCalled()
 })
 it("carries the review destination in the emailed verification link",async()=>{
  await requestMagicLinkAction({sent:false,error:""},form({email:"owner@example.test",next:"/dashboard/approvals?review=pa_1"}))
  const link=new URL(mocks.send.mock.calls[0][1]);expect(link.searchParams.get("next")).toBe("/dashboard/approvals?review=pa_1")
 })
 it("rejects off-site return URLs before emailing",async()=>{
  await requestMagicLinkAction({sent:false,error:""},form({email:"owner@example.test",next:"//evil.test"}))
  expect(new URL(mocks.send.mock.calls[0][1]).searchParams.get("next")).toBe("/dashboard")
 })
 it("does not log provider errors that echo the recovery link and preserves the unknown-account response",async()=>{
  const error=vi.spyOn(console,"error").mockImplementation(()=>{})
  mocks.send.mockImplementation(async(_to:string,link:string)=>{throw new Error(`Provider echoed ${link}`)})
  const failed=await requestMagicLinkAction({sent:false,error:""},form({email:"owner@example.test"}))
  const link=mocks.send.mock.calls[0][1]
  expect(error).toHaveBeenCalledOnce()
  expect(error.mock.calls.flat().join(" ")).not.toContain(link)
  expect(error.mock.calls[0].every(value=>typeof value==="string")).toBe(true)
  mocks.wallet.mockResolvedValue(null)
  expect(await requestMagicLinkAction({sent:false,error:""},form({email:"unknown@example.test"}))).toEqual(failed)
  expect(failed).toEqual({sent:true,error:""})
 })
})
