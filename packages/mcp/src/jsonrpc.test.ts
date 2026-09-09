import { describe, expect, it } from "vitest";
import { frame, JsonRpcParser, request } from "./jsonrpc.js";

describe("JsonRpc framing", () => {
  it("frames a message with Content-Length headers", () => {
    const message = request(1, "tools/list", {});
    const buffer = frame(message);
    const header = buffer.subarray(0, buffer.indexOf("\r\n\r\n") + 4).toString("utf8");
    expect(header).toMatch(/Content-Length:\s*\d+\r\n\r\n/);
    const body = JSON.parse(buffer.subarray(buffer.indexOf("\r\n\r\n") + 4).toString("utf8"));
    expect(body.id).toBe(1);
  });

  it("parses messages split across arbitrary chunk boundaries", () => {
    const parser = new JsonRpcParser();
    const a = frame(request(1, "a"));
    const b = frame(request(2, "b"));
    const combined = Buffer.concat([a, b]);

    const first = parser.push(combined.subarray(0, 3));
    expect(first).toEqual([]);
    const rest = parser.push(combined.subarray(3));
    expect(rest).toHaveLength(2);
    expect(rest[0]).toMatchObject({ id: 1, method: "a" });
    expect(rest[1]).toMatchObject({ id: 2, method: "b" });
  });

  it("throws on a frame with no Content-Length", () => {
    const parser = new JsonRpcParser();
    expect(() => parser.push(Buffer.from("hello\r\n\r\n{}"))).toThrow(/Content-Length/);
  });
});