/** Test fixture only: evidence is held in memory and resets on every restart. */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

export const MAX_FIXTURE_BODY_BYTES = 16 * 1024;

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

/** Factory does not listen automatically, so importing it has no server side effects. */
export function createApprovalFixture(token = process.env.SANCTION_FIXTURE_TOKEN) {
  if (!token?.trim()) throw new Error("SANCTION_FIXTURE_TOKEN is required");
  const expected = createHash("sha256").update(`Bearer ${token}`).digest();
  const runId = randomUUID();
  let invocationCount = 0;

  return createServer(async (request, response) => {
    const supplied = createHash("sha256").update(request.headers.authorization ?? "").digest();
    if (!timingSafeEqual(expected, supplied)) {
      json(response, 401, { error: "Unauthorized" });
      return;
    }
    if (request.url !== "/mcp" && request.url !== "/evidence") {
      json(response, 404, { error: "Not found" });
      return;
    }
    const method = request.url === "/evidence" ? "GET" : "POST";
    if (request.method !== method) {
      response.setHeader("allow", method);
      json(response, 405, { error: "Method not allowed" });
      return;
    }
    if (request.url === "/evidence") {
      json(response, 200, { runId, invocationCount });
      return;
    }
    if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
      json(response, 415, { error: "Expected application/json" });
      return;
    }

    // Bound the body ourselves before the SDK sees it, including chunked uploads.
    const chunks: Buffer[] = [];
    let bytes = 0;
    let body: unknown;
    try {
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > MAX_FIXTURE_BODY_BYTES) {
          json(response, 413, { error: "Request too large" });
          return;
        }
        chunks.push(buffer);
      }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      if (!response.destroyed) json(response, 400, { error: "Invalid JSON body" });
      return;
    }

    // A fresh transport/server per POST is required by the SDK's stateless mode.
    const mcp = new McpServer({ name: "sanction-approval-fixture", version: "1.0.0" });
    mcp.registerTool("fixture.echo", {
      description: "Echo synthetic text; only increments this test fixture's in-memory counter.",
      inputSchema: { text: z.string().max(4096) },
    }, async ({ text }) => {
      invocationCount += 1;
      return { content: [{ type: "text", text }] };
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    response.once("close", () => { void mcp.close(); });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch {
      if (!response.headersSent) json(response, 500, { error: "Fixture request failed" });
      else response.end();
      await mcp.close();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.SANCTION_FIXTURE_PORT ?? "4319");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SANCTION_FIXTURE_PORT must be between 1 and 65535");
  }
  const host = process.env.SANCTION_FIXTURE_HOST ?? "127.0.0.1";
  const server = createApprovalFixture();
  server.listen(port, host, () => {
    console.log(`Approval test fixture listening on ${host}:${port}; evidence resets on restart.`);
  });
}
