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

    const shape = shapes[shapeName];
    if (['service', 'operation'].includes(shape.type)) {
      return {};
    }
    if (!shape) throw new Error(`Shape ${shapeName} not found`);

    let schema;

    switch (shape.type) {
      case 'string':
        schema = z.string();
        if (shape.traits?.['smithy.api#pattern']) {
          schema = schema.regex(new RegExp(shape.traits['smithy.api#pattern']));
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

      case 'structure':
        const members: Record<string, z.ZodType> = {};
        for (const [memberName, member] of Object.entries(shape.members || {})) {
          const memberSchema = buildSchema((member as any).target);
          const required = shape.required?.includes(memberName);
          members[memberName] = required ? memberSchema : memberSchema.optional();
        }
        schema = z.object(members);
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
        const valueSchema = buildSchema(shape.value.target);
        schema = z.record(z.string(), valueSchema);
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
        throw new Error(`Unsupported shape type: ${shape.type}`);
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
