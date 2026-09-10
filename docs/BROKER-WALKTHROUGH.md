# Prove a governed tool call

Open **Prove a governed tool call** on the roster as a wallet admin. The walkthrough creates a test child pool and a one-hour agent. Your policy is unchanged; the test pool inherits your restrictions.

1. Create the test pool, then send its tool call.
2. Open the linked approval and select **Review exact request**. The call is `filesystem.read_file` with `path: sanction-demo.txt` against the test upstream. This reads a virtual note, never a file on your machine.
3. Approve through the normal inbox, then return to the walkthrough.
4. Select **Verify approved execution and replay protection**. Sanction first submits changed arguments, then the approved request, then repeats the consumed grant.

Completion requires the initial call to stop with zero upstream invocations, the changed request to be refused without consuming the grant, one successful invocation, and the reused grant to be refused. The upstream records its own invocation count. Completion is stored and displayed after reload and on the roster.

This uses the existing broker and approval engine. An inherited denial stops the walkthrough; it does not weaken policy to make the demonstration pass. Unknown upstream outcomes never count as completion and are not retried automatically. An expired walkthrough may be restarted; its historical pool and approval records remain. The agent is disabled after completed verification and otherwise expires after one hour.

The test upstream has a separate vaulted credential. Neither it nor the encrypted test agent key is returned to the browser. Only the fixed test endpoint is configured; this flow does not accept arbitrary upstream URLs. On Vercel the current deployment URL is used unless `SANCTION_PUBLIC_ORIGIN` overrides it. A protected preview must permit the deployment's server to call its own test endpoint.

This proves the controlled broker path, not coverage of traffic outside it, filesystem containment, or exactly-once execution for other upstreams. The endpoint implements the walkthrough's direct `tools/call` only; it is not an installable general-purpose MCP server.
