import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadTools } from "./lib/tools";

(async () => {
  const server = new McpServer({
    name: "example",
    version: "0.1.0"
  });

  await loadTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
})();
