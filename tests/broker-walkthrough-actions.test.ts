import { beforeEach, expect, it, vi } from "vitest"
const { role, start, advance, restart, redirect, revalidate } = vi.hoisted(() => ({ role: vi.fn(), start: vi.fn(), advance: vi.fn(), restart: vi.fn(), redirect: vi.fn(), revalidate: vi.fn() }))
vi.mock("@/lib/session", () => ({ requireSessionRole: role }))
vi.mock("@/lib/brokerWalkthrough", () => ({ startWalkthrough: start, advanceWalkthrough: advance, restartWalkthrough: restart }))
vi.mock("next/navigation", () => ({ redirect }))
vi.mock("next/cache", () => ({ revalidatePath: revalidate }))
import { walkthroughAction } from "../app/dashboard/walkthrough/actions"
beforeEach(() => { vi.clearAllMocks(); role.mockResolvedValue({ id: "owner" }); start.mockResolvedValue("trial"); advance.mockResolvedValue(undefined) })
it("refuses viewers without preparing a trial", async () => {
  role.mockResolvedValue(null)
  expect(await walkthroughAction({}, new FormData())).toHaveProperty("error")
  expect(start).not.toHaveBeenCalled()
  expect(role).toHaveBeenCalledWith("admin")
})
it("uses the authenticated owner, ignoring forged owner fields", async () => {
  const form = new FormData(); form.set("operation", "start"); form.set("ownerWalletId", "other")
  expect(await walkthroughAction({}, form)).toEqual({})
  expect(start).toHaveBeenCalledWith("owner")
})
it("passes only the run id with the authenticated owner", async () => {
  const form = new FormData(); form.set("operation", "advance"); form.set("id", "trial")
  await walkthroughAction({}, form)
  expect(advance).toHaveBeenCalledWith("owner", "trial")
})
it("returns a safe message without leaking internal failures", async () => {
  start.mockRejectedValue(Error("secret-upstream-token"))
  const form = new FormData(); form.set("operation", "start")
  expect(JSON.stringify(await walkthroughAction({}, form))).not.toContain("secret-upstream-token")
})
it("rejects an unknown operation", async () => {
  expect(await walkthroughAction({}, new FormData())).toEqual({ error: "Invalid operation." })
  expect(advance).not.toHaveBeenCalled()
})

it("restarts the explicit run as the authenticated admin and opens its replacement", async () => {
  restart.mockResolvedValue("replacement")
  const form = new FormData(); form.set("operation", "restart"); form.set("id", "old"); form.set("ownerWalletId", "forged")
  await walkthroughAction({}, form)
  expect(restart).toHaveBeenCalledWith("owner", "old")
  expect(redirect).toHaveBeenCalledWith("/dashboard/walkthrough?run=replacement")
})
it("rejects restart without a run id and does not restart for viewers", async () => {
  const form = new FormData(); form.set("operation", "restart")
  expect(await walkthroughAction({}, form)).toHaveProperty("error")
  role.mockResolvedValue(null); form.set("id", "old")
  expect(await walkthroughAction({}, form)).toHaveProperty("error")
  expect(restart).not.toHaveBeenCalled()
})
