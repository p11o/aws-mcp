import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express, { Request, Response } from "express";
import { loadTools } from "./lib/tools";

const app = express();
const transports: { [sessionId: string]: SSEServerTransport } = {};

const server = new McpServer({
  name: "example",
  version: "0.1.0"
});

app.get("/sse", async (_: Request, res: Response) => {
  const transport = new SSEServerTransport('/messages', res);
  transports[transport.sessionId] = transport;
  res.on("close", () => {
    delete transports[transport.sessionId];
  });
  await server.connect(transport);
});

app.post("/messages", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports[sessionId];
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send('No transport found for sessionId');
  }
});

(async () => {
  console.log('Loading tools...');
  await loadTools(server);
  console.log('Tools loaded.');
  console.log('Starting server...');
  app.listen(3000);
  console.log("Server is running on http://localhost:3000");
})();
