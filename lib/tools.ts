import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { file } from 'bun';
import path from 'path';
import { generateZodSchemasFromSmithy } from './schema-generator';


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

        const zodSchema = await generateZodSchemasFromSmithy(serviceName);
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

          server.tool(
            `${serviceName}_${operationName}`,
            `${serviceName} ${operationName}`,
            zodSchema[schemaKey].shape,
            async (args) => {
              const command = new CommandClass(args);
              const content = await client.send(command);
              return {
                content: [
                  { text: JSON.stringify(content, null, 2), type: 'sdf' }
                ]
              };
            }
          );
          console.error(`Loaded tool for ${serviceName}_${operationName}`);
        });
      } else {
        console.error(`Client class not found in package ${pkg}`);
      }
    } catch (error) {
      console.error(`Failed to load package ${pkg}:`, error);
    }
  }

}
