// Minimal MCP server over stdio for testing the client. No external deps.
// Speaks JSON-RPC with Content-Length framing, answers initialize, tools/list,
// tools/call, and optionally dies on a specific tool call.

const DEBUG = process.env.MCP_TEST_DEBUG === "1";
const tools = [
  {
    name: "echo",
    description: "Echo the input back",
    inputSchema: { type: "object", properties: { text: { type: "string" } } },
  },
  {
    name: "boom",
    description: "Always fail",
    inputSchema: {},
  },
  {
    name: "die",
    description: "Crashes the server",
    inputSchema: {},
  },
];

let buf = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const headerEnd = buf.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;
    const head = buf.subarray(0, headerEnd).toString("utf8");
    const m = /Content-Length:\s*(\d+)/i.exec(head);
    buf = buf.subarray(headerEnd + 4);
    if (!m) continue;
    const len = Number(m[1]);
    if (buf.length < len) break;
    const body = buf.subarray(0, len).toString("utf8");
    buf = buf.subarray(len);
    handle(JSON.parse(body));
  }
});

function send(msg) {
  const body = Buffer.from(JSON.stringify(msg), "utf8");
  const head = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
  process.stdout.write(Buffer.concat([head, body]));
  if (DEBUG) process.stderr.write(`server sent: ${body.toString()}\n`);
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function handle(msg) {
  if (msg.id === undefined) return; // notifications: ignore
  if (msg.method === "initialize") {
    respond(msg.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: "test-server", version: "1.0.0" },
    });
    return;
  }
  if (msg.method === "tools/list") {
    respond(msg.id, { tools });
    return;
  }
  if (msg.method === "tools/call") {
    const name = msg.params?.name;
    const args = msg.params?.arguments ?? {};
    if (name === "echo") {
      respond(msg.id, { content: [{ type: "text", text: `echo: ${args.text ?? ""}` }], isError: false });
    } else if (name === "boom") {
      respond(msg.id, { content: [{ type: "text", text: "boom failed" }], isError: true });
    } else if (name === "die") {
      // Exit without answering so the client's pending request rejects.
      process.exit(3);
    } else {
      respondError(msg.id, -32602, `unknown tool ${name}`);
    }
    return;
  }
  respondError(msg.id, -32601, `unknown method ${msg.method}`);
}