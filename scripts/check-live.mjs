import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const target = process.argv[2] || "http://127.0.0.1:8787/mcp";
const url = new URL(target);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.protocol !== "http:" || url.pathname !== "/mcp") {
  throw new Error("This diagnostics script only accepts a local loopback MCP URL");
}
const client = new Client({ name: "skill-bridge-diagnostic", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(url);
await client.connect(transport);
try {
  const available = (await client.listTools()).tools.map((x) => x.name).sort();
  console.log(JSON.stringify({ connected: true, tools: available }, null, 2));
} finally {
  await client.close();
}
