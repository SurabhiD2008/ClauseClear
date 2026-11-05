// A local HTTP server for adapter tests. Each test queues handlers; every
// request is recorded (method, url, headers, parsed body) so tests can assert
// exactly what an adapter sent. Never part of the build (tsconfig.build.json).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: unknown;
}

export interface Reply {
  status?: number;
  headers?: Record<string, string>;
  /** JSON-encoded unless it is a string. */
  body?: unknown;
  /** Never answer; the client must time out or abort. */
  hang?: boolean;
}

export type Handler = (request: RecordedRequest) => Reply;

export interface FakeHttpServer {
  baseUrl: string;
  requests: RecordedRequest[];
  /** Handlers answer requests in order; the last one repeats. */
  reply(...handlers: (Handler | Reply)[]): void;
  /** How many hanging requests the client has closed (timeouts and aborts). */
  closedConnections(): number;
  close(): Promise<void>;
}

export async function startFakeHttpServer(): Promise<FakeHttpServer> {
  const requests: RecordedRequest[] = [];
  let handlers: Handler[] = [() => ({ status: 500, body: { error: "no handler" } })];
  let closed = 0;
  const hanging = new Set<ServerResponse>();

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: unknown = raw;
      try {
        body = raw === "" ? undefined : (JSON.parse(raw) as unknown);
      } catch {
        // Keep the raw text.
      }
      const recorded: RecordedRequest = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body,
      };
      requests.push(recorded);
      const handler = handlers.length > 1 ? handlers.shift() : handlers[0];
      const reply = handler?.(recorded) ?? { status: 500 };
      if (reply.hang === true) {
        hanging.add(res);
        res.on("close", () => {
          closed += 1;
          hanging.delete(res);
        });
        return;
      }
      res.writeHead(reply.status ?? 200, {
        "content-type": "application/json",
        ...reply.headers,
      });
      res.end(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? {}));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    requests,
    reply(...next) {
      handlers = next.map((item) => (typeof item === "function" ? item : () => item));
    },
    closedConnections: () => closed,
    async close() {
      for (const res of hanging) res.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    },
  };
}
