import Link from "next/link"
import { requireSessionRole } from "@/lib/session"
import { walkthroughView } from "@/lib/brokerWalkthrough"
import { BrokerWalkthroughControl } from "@/components/broker-walkthrough-control"
export const maxDuration = 120
export const dynamic = "force-dynamic"
export default async function WalkthroughPage() {
  const wallet = await requireSessionRole("admin")
  if (!wallet) return <p className="p-6">Sign in as an admin to run the broker walkthrough.</p>
  const run = await walkthroughView(wallet.id)
  const expired = run && new Date(run.expiresAt) <= new Date()
  return <main className="mx-auto max-w-3xl space-y-6 p-6">
    <h1 className="text-2xl font-semibold">Prove a governed tool call</h1>
    <p className="text-sm text-muted-foreground">Read a virtual test note through the broker. Nothing is installed, purchased, or read from your filesystem. A separate test pool inherits your restrictions; your existing policy stays unchanged.</p>
    <p className="text-sm text-muted-foreground">This creates a test agent and approval in your wallet tree. The test expires after one hour. Review and approve it in the inbox, then return here.</p>
    {!run || (expired && run.state !== "completed") ? <BrokerWalkthroughControl operation="start" label="Create test pool" /> : <>
      <ol className="space-y-3 rounded border border-border p-5 text-sm">
        <li>{run.initialStopped ? "Verified" : "Waiting"}: original call stopped before reaching the upstream.</li>
        <li>{run.approval?.status === "approved" ? "Approved" : run.approval?.status === "denied" ? "Denied" : run.approval?.status === "expired" ? "Expired" : "Waiting"}: approval for the exact request.</li>
        <li>{run.changedStopped ? "Verified" : "Waiting"}: changed arguments refused without using the grant.</li>
        <li>Upstream executions recorded: <strong>{run.executionCount}</strong>.</li>
        <li>{run.reuseStopped ? "Verified" : "Waiting"}: reused grant refused.</li>
      </ol>
      {run.state === "ready" && <BrokerWalkthroughControl operation="advance" id={run.id} label="Send test tool call" />}
      {run.state === "pending" && <div className="space-y-3">
        <Link className="underline" href={run.approval ? `/dashboard/approvals?review=${run.approval.id}` : "/dashboard/approvals"}>Review exact request in Approvals</Link>
        <BrokerWalkthroughControl operation="advance" id={run.id} label="Verify approved execution and replay protection" />
      </div>}
      {run.state === "completed" && <div className="space-y-3">
        <p role="status" className="font-medium">Walkthrough complete. One approved execution recorded; changed arguments and grant reuse were refused.</p>
        <p className="text-sm text-muted-foreground">Next, connect your own tool. This test does not establish protection for your other agents.</p>
        <Link href="/dashboard#connect-tools" className="inline-block rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Next: connect your agent</Link>
      </div>}
      {run.state === "failed" && <p role="alert">The proof did not complete. Your inherited policy may deny this tool, or the upstream outcome may be uncertain. Review Approvals and the count above. No success is claimed. A new walkthrough is available after expiry.</p>}
      {run.state === "initializing" && <p>Preparing the test pool. Refresh shortly.</p>}
    </>}
    <p className="text-xs text-muted-foreground">This proves this controlled broker path only. Traffic outside the broker is not governed. It does not establish exactly-once execution for other upstream systems.</p>
    <Link href="/dashboard" className="text-sm underline">Back to roster</Link>
  </main>
}
