import { file } from 'bun';
import path from 'path';
import { z } from 'zod';

export async function generateZodSchemasFromSmithy(service: string): Promise<Record<string, z.ZodType>> {
  const modelPath = path.join(process.cwd(), 'aws-sdk-js-v3', 'codegen', 'sdk-codegen', 'aws-models', `${service}.json`);
  const smithyJson = await file(modelPath).json();
  const shapes = smithyJson.shapes || {};

  // Cache to store generated schemas and avoid infinite recursion
  const schemaCache: Record<string, z.ZodType> = {};

  // Function to build a Zod schema for a given shape
  function buildSchema(shapeName: string): z.ZodType {
    if (schemaCache[shapeName]) {
      return schemaCache[shapeName];
    }
    // For built-in Smithy types, we map to their corresponding shapes
    if (shapeName.startsWith('smithy.api#')) {
      const baseType = shapeName.split('#')[1].toLowerCase();
      // Use a mock shape that matches the Smithy type
      const shape = {
        type: baseType,
        traits: {}
      };
      shapes[shapeName] = shape;
    }

    const shape = shapes[shapeName];
    if (['service', 'operation'].includes(shape?.type)) {
      return {};
    }
    if (!shape) throw new Error(`Shape ${shapeName} not found`);

    let schema;

    switch (shape.type) {
      case 'document':
      case 'string':
        schema = z.string();
        if (shape.traits?.['smithy.api#pattern']) {
          const pattern = shape.traits['smithy.api#pattern']
            .replace(/\\/g, '\\\\') // Escape backslashes
            .replace(/\//g, '\\/');  // Escape forward slashes
          try {
            schema = schema.regex(new RegExp(pattern, 'u'));
          } catch (e) {
            console.error(`Invalid pattern for ${shapeName}:`, pattern);
            // Fall back to basic string if pattern is invalid
          }
        }
        if (shape.traits?.['smithy.api#length']) {
          const { min, max } = shape.traits['smithy.api#length'];
          if (min !== undefined) schema = schema.min(min);
          if (max !== undefined) schema = schema.max(max);
        }
        if (shape.traits?.['smithy.api#enum']) {
          const enumValues = Object.values(shape.traits['smithy.api#enum']).map((e: any) => e.value);
          schema = z.enum(enumValues as [string, ...string[]]);
        }
        break;

      case 'float':
      case 'double':
        schema = z.number();
        if (shape.traits?.['smithy.api#range']) {
          const { min, max } = shape.traits['smithy.api#range'];
          if (min !== undefined) schema = schema.min(min);
          if (max !== undefined) schema = schema.max(max);
        }
        break;

      case 'integer':
      case 'long':
        schema = z.number().int();
        if (shape.traits?.['smithy.api#range']) {
          const { min, max } = shape.traits['smithy.api#range'];
          if (min !== undefined) schema = schema.min(min);
          if (max !== undefined) schema = schema.max(max);
        }
        break;

      case 'boolean':
        schema = z.boolean();
        break;

      case 'timestamp':
        schema = z.string().datetime(); // Adjust based on actual format
        break;

      case 'blob':
        schema = z.string(); // Assuming base64; adjust if needed
        break;

      case 'resource':
      case 'structure':
        // Create a placeholder to break circular references
        schemaCache[shapeName] = z.lazy(() => z.object({}));

        const members: Record<string, z.ZodType> = {};
        for (const [memberName, member] of Object.entries(shape.members || {})) {
          const memberSchema = buildSchema((member as any).target);
          const required = shape.required?.includes(memberName);
          members[memberName] = required ? memberSchema : memberSchema.optional();
        }
        schema = z.object(members);
        // Update the cache with the complete schema
        schemaCache[shapeName] = schema;
        break;

      case 'list':
        const itemSchema = buildSchema(shape.member.target);
        schema = z.array(itemSchema);
        if (shape.traits?.['smithy.api#length']) {
          const { min, max } = shape.traits['smithy.api#length'];
          if (min !== undefined) schema = schema.min(min);
          if (max !== undefined) schema = schema.max(max);
        }
        break;

      case 'map':
        const keySchema = shape.key?.target ? buildSchema(shape.key.target) : z.string();
        const valueSchema = shape.value?.target ? buildSchema(shape.value.target) : buildSchema(shape.value);
        schema = z.record(keySchema, valueSchema);
        break;

      case 'enum':
        const enumValues = Object.keys(shape.members);
        schema = z.enum(enumValues);
        break;

      case 'union':
        const unionMembers = Object.values(shape.members).reduce((acc: any, member) => {
          const memberSchema = buildSchema((member as any).target);
          return [...acc, memberSchema];
        }, [] as z.ZodType[]);
        schema = z.union(unionMembers);
        break;

      default:
        throw new Error(`Unsupported shape type: ${shapeName} - ${shape.type}`);
    }

    schemaCache[shapeName] = schema;
    return schema;
  }

  // Generate schemas for each operation's input
  const operationSchemas: Record<string, z.ZodType> = {};
  for (const [operationName, operation] of Object.entries(shapes) as any) {
    operationSchemas[operationName] = buildSchema(operationName);
  }

  return operationSchemas;
}
