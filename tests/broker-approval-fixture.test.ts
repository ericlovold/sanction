import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApprovalFixture, MAX_FIXTURE_BODY_BYTES } from "@/examples/broker-approval-loop/fixture";

const servers: Server[] = [];
const token = "synthetic-fixture-test-token";
const headers = { Authorization: `Bearer ${token}` };
async function start() {
  const server = createApprovalFixture(token);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No TCP listener");
  return `http://127.0.0.1:${address.port}`;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe("approval demo MCP fixture", () => {
  it("fails closed without a configured token", () => {
    expect(() => createApprovalFixture("")).toThrow("SANCTION_FIXTURE_TOKEN");
    expect(() => createApprovalFixture("  ")).toThrow("SANCTION_FIXTURE_TOKEN");
  });

  it("authenticates both endpoints and rejects unknown routes and methods", async () => {
    const url = await start();
    for (const path of ["/mcp", "/evidence"]) {
      expect((await fetch(url + path)).status).toBe(401);
      expect((await fetch(url + path, { headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
    }
    expect((await fetch(url + "/missing", { headers })).status).toBe(404);
    expect((await fetch(url + "/mcp", { headers })).status).toBe(405);
    expect((await fetch(url + "/evidence", { headers, method: "POST" })).status).toBe(405);
  });

  it("executes through an actual MCP client and exposes only restart-scoped counts", async () => {
    const url = await start();
    const before = await (await fetch(url + "/evidence", { headers })).json();
    expect(before).toEqual({ runId: expect.any(String), invocationCount: 0 });
    const client = new Client({ name: "fixture-test", version: "1.0.0" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(url + "/mcp"), { requestInit: { headers } }));
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["fixture.echo"]);
      const invalid = await client.callTool({ name: "fixture.echo", arguments: { text: 42 } });
      expect(invalid.isError).toBe(true);
      const result = await client.callTool({ name: "fixture.echo", arguments: { text: "synthetic test payload" } });
      expect(result.content).toEqual([{ type: "text", text: "synthetic test payload" }]);
      expect(await (await fetch(url + "/evidence", { headers })).json()).toEqual({ ...before, invocationCount: 1 });
    } finally {
      await client.close();
    }
    const restarted = await start();
    const fresh = await (await fetch(restarted + "/evidence", { headers })).json();
    expect(fresh.invocationCount).toBe(0);
    expect(fresh.runId).not.toBe(before.runId);
  });

  it("rejects malformed, oversized and non-JSON requests without execution", async () => {
    const url = await start();
    const post = (body: string, contentType = "application/json") => fetch(url + "/mcp", {
      method: "POST", headers: { ...headers, "content-type": contentType }, body,
    });
    expect((await post("{")).status).toBe(400);
    expect((await post("{}", "text/plain")).status).toBe(415);
    expect((await post("x".repeat(MAX_FIXTURE_BODY_BYTES + 1))).status).toBe(413);
    expect((await (await fetch(url + "/evidence", { headers })).json()).invocationCount).toBe(0);
  });
});
