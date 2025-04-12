import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { file } from 'bun';
import { JSDOM } from 'jsdom';
import path from 'path';
import { generateZodSchemasFromSmithy } from "./schema-generator";

const stripHtmlTags = (html: string): string => {
  const dom = new JSDOM();
  const div = dom.window.document.createElement('div');
  div.innerHTML = html;
  return div.textContent.replace(/\s+/g, ' ') || '';
};

export const getToolDescription = (smithy: any, service: string, operation: string): string => {
  const shapes = smithy.shapes || {};

  const desc = shapes[`com.amazonaws.${service}#${operation}`]?.traits?.['smithy.api#documentation'] || '';
  return stripHtmlTags(desc);
}


// Load AWS clients from package.json
export async function loadTools(server: McpServer): Promise<Map<string, any>> {

  // Read package.json using Bun's file API
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const packageJsonText = await file(packageJsonPath).text();
  const packageJson = JSON.parse(packageJsonText);
  const dependencies = packageJson.dependencies || {};

  // Identify AWS SDK client packages
  const awsClientPackages = Object.keys(dependencies).filter(dep =>
    dep.startsWith('@aws-sdk/client-')
  );

  // Dynamically import and instantiate each client
  for (const pkg of awsClientPackages) {
    const serviceName = pkg.replace('@aws-sdk/client-', '').toLowerCase();
    try {
      const module = await import(pkg);
      const clientKey = Object.keys(module).find(key => key.endsWith('Client'));
      if (clientKey) {
        const ClientClass = module[clientKey];
        const client = new ClientClass();

        const commandClasses = Object.entries(module)
          .filter(([key, value]) =>
            key.endsWith('Command') &&
            typeof value === 'function' &&
            value.prototype
          );

        const { zodSchema, smithy } = await generateZodSchemasFromSmithy(serviceName);

        commandClasses.forEach(([commandName, CommandClass]) => {
          const operationName = commandName.replace('Command', '');
          const schemaKey = Object.keys(zodSchema).find(key =>
            key.toLowerCase().includes(operationName.toLowerCase()) &&
            key.toLowerCase().endsWith('request')
          );
          if (!schemaKey) {
            console.error(`Schema not found for ${serviceName}_${operationName}`);
            return;
          }

          const description = getToolDescription(smithy, serviceName, operationName);
          server.tool(
            `${serviceName}_${operationName}`,
            description,
            zodSchema[schemaKey].shape,
            async (args: any) => {
              const command = new CommandClass(args);
              const content = await client.send(command);
              return {
                content: [
                  { text: JSON.stringify(content, null, 2), type: 'text' }
                ]
              };
            }
          );
        });
      } else {
        console.error(`Client class not found in package ${pkg}`);
      }
    } catch (error) {
      console.error(`Failed to load package ${pkg}:`, error);
    }
    console.log(`Loaded tool for ${serviceName}`);

  }

}
