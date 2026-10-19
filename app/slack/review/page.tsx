import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import "../../brand.css"
import { brandFontVars } from "../../brand-fonts"

export const metadata: Metadata = {
  title: "Slack reviewer guide | Sanction",
  description: "Install Sanction in your Slack workspace and test approval, denial, reconnection, and reinstallation with synthetic requests.",
}

const steps = [
  {
    title: "Start in Sanction Approvals",
    body: "Sign in to Sanction as a wallet admin. Use a test wallet with an active agent and a policy. Open Approvals and select Add to Slack. A public demo session cannot install the app.",
    expected: "Slack opens its OAuth consent screen.",
  },
  {
    title: "Choose your own workspace and channel",
    body: "In Slack, choose a workspace where you have permission to install apps. Select a private channel containing only your intended approvers, then select Allow. Anyone in the connected channel can approve or deny requests. Invite Sanction to a private channel manually; for a public channel, Sanction attempts to join automatically.",
    expected: "Sanction returns you to Approvals. Check the selected Slack channel for the connection message before continuing.",
  },
  {
    title: "Send and approve a synthetic request",
    body: "In Approvals, send a test escalation. It creates a labeled $30 test request using an active agent and sends it through the configured notification channels. In Slack, review the request and select Approve. Use the card’s review link to inspect its dashboard record.",
    expected: "The Slack card records the decision and Approvals shows the request as approved. This test does not make a purchase or execute an agent tool.",
  },
  {
    title: "Test denial with a separate request",
    body: "Send another test escalation and select Deny on the new Slack card. Use a fresh request for each decision; an already resolved card is not a new approval opportunity.",
    expected: "The new request is denied in Sanction and its Slack card reflects the denial.",
  },
  {
    title: "Check an old card after reconnecting",
    body: "Send another test escalation and leave it pending. Disconnect Slack in Sanction Approvals, then use Add to Slack to reconnect. Before the request expires, try a decision button on the card sent before disconnection.",
    expected: "Slack reports that the old card is no longer authorized. It must not resolve the request. Review the pending request in Sanction, then send a fresh test to verify the new connection.",
  },
  {
    title: "Uninstall and reinstall",
    body: "Remove Sanction through Slack’s app management for your test workspace. Send a test escalation from Sanction so delivery detects the removed installation, then reload Approvals and use Add to Slack to reinstall. Select the channel again and invite the app if it is private. Send a fresh test escalation and decide it in Slack.",
    expected: "The new installation delivers a fresh card and records its decision. Cards from the previous installation cannot authorize a request through the new connection.",
  },
]

export default function SlackReviewPage() {
  return (
    <div className={`sanction ${brandFontVars}`} style={{ minHeight: "100vh", background: "var(--surface-page)", color: "var(--text-body)" }}>
      <header className="border-b" style={{ borderColor: "var(--paper-3)" }}>
        <nav aria-label="Main navigation" className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
          <Link href="/" className="font-semibold tracking-tight">Sanction</Link>
          <Link href="/slack" className="sanction-link text-sm">Sanction for Slack</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-16">
        <p className="sn-mono text-xs" style={{ color: "var(--ochre-7)" }}>SLACK REVIEWER GUIDE</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Test the approval loop.</h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          Install in your own Slack workspace, decide synthetic requests, and verify that old cards lose authority after reconnecting.
        </p>
        <Link href="/dashboard/approvals" className="sanction-link mt-6 inline-block">Open Sanction Approvals →</Link>

        <aside className="mt-8 rounded-lg border p-5" style={{ borderColor: "var(--paper-3)", background: "var(--surface-card)" }}>
          <h2 className="font-semibold">Approval does not execute the action</h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            Approval grants permission for the agent to retry under Sanction’s controls. The agent must redeem its single-use, expiring grant and perform the action separately. Adding Slack does not intercept agent tools.
          </p>
        </aside>

        <ol className="mt-12 space-y-10">
          {steps.map((step, index) => (
            <li key={step.title}>
              <h2 className="text-xl font-semibold">{index + 1}. {step.title}</h2>
              <p className="mt-3 leading-relaxed" style={{ color: "var(--text-secondary)" }}>{step.body}</p>
              <p className="mt-3 text-sm leading-relaxed"><strong>Expected:</strong> {step.expected}</p>
              {index === 2 && (
                <figure className="mt-6">
                  <a href="/slack-review/approval-card.png" aria-label="Open the synthetic approval card at full size">
                    <Image src="/slack-review/approval-card.png" alt="Synthetic Sanction request in Slack with Approve, Deny, and Review request in Sanction buttons." width={1078} height={148} className="h-auto w-full rounded-lg border" style={{ borderColor: "var(--paper-3)" }} />
                  </a>
                  <figcaption className="mt-3 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
                    Actual synthetic tool-approval card, cropped to omit channel history. The dashboard test uses a $30 spend request, so its wording differs. Neither test executes an action.
                  </figcaption>
                </figure>
              )}
              {index === 1 && (
                <figure className="mt-6">
                  <a href="/slack-review/slack-consent.png" aria-label="Open the Slack consent screenshot at full size">
                    <Image src="/slack-review/slack-consent.png" alt="Slack OAuth consent screen with workspace and channel selectors and the Allow button." width={1493} height={750} className="h-auto w-full rounded-lg border" style={{ borderColor: "var(--paper-3)" }} />
                  </a>
                  <figcaption className="mt-3 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
                    Actual consent screen from a test installation. The example uses a public test channel; choose your own workspace and approvers channel. Select the image to enlarge it.
                  </figcaption>
                </figure>
              )}
            </li>
          ))}
        </ol>

        <section className="mt-12 border-t pt-8" style={{ borderColor: "var(--paper-3)" }}>
          <h2 className="text-xl font-semibold">Finish the test</h2>
          <p className="mt-3 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            Deny any remaining synthetic requests in Sanction, then disconnect the test installation. Keep the test wallet separate from production agents and credentials.
          </p>
          <h2 className="mt-8 text-xl font-semibold">If a request does not arrive</h2>
          <p className="mt-3 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            Confirm the selected workspace and channel, check that Sanction is a channel member, and send a fresh test. For private channels, invite the app manually. If no active agent exists, create one in Sanction before sending the test.
          </p>
          <nav aria-label="Reviewer resources" className="mt-6 flex flex-wrap gap-5 text-sm">
            <Link href="/support" className="sanction-link">Support</Link>
            <Link href="/privacy" className="sanction-link">Privacy policy</Link>
            <Link href="/docs/connect" className="sanction-link">Connect an agent</Link>
          </nav>
        </section>
      </main>
    </div>
  )
}
