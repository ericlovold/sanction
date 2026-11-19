// The frame every connect page shares: what the connection is for on one side,
// the decision on the other. The story names no host. A host's name comes from
// its own registration, and text a third party chose does not belong in
// Sanction's voice; pages show it in the decision column, attributed.
export function ConnectShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="sn-connect">
      <aside className="sn-connect-story" aria-label="What this connection does">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/sanction-wordmark-white.svg" alt="Sanction" width="130" height="25" />
        <div>
          <p className="sn-connect-label">What you&apos;re setting up</p>
          <h2>Give your AI tool a way to ask first.</h2>
          <ol className="sn-connect-steps">
            <li><span aria-hidden="true">1</span><span>It reaches a step that needs a person, and asks.</span></li>
            <li><span aria-hidden="true">2</span><span>The exact request reaches you in your inbox, or in Slack if connected.</span></li>
            <li><span aria-hidden="true">3</span><span>It continues only with your yes, for that one action, once.</span></li>
          </ol>
        </div>
        <p className="sn-connect-tagline">Authorize. Protect. Govern.</p>
      </aside>
      <main className="sn-connect-main">
        <div className="sn-connect-column">{children}</div>
      </main>
    </div>
  )
}
