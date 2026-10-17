import { describe, expect, it } from 'vitest';
import { AGENT_TOOL_SCHEMAS } from '../generation/agent/workspace-agent-tools.js';
import { strictToolSchemaViolations } from './strict-tool-schema.js';

describe('strictToolSchemaViolations (WI-CORE-031)', () => {
  it('accepts every real AGENT_TOOL_SCHEMAS parameters as strict', () => {
    for (const schema of AGENT_TOOL_SCHEMAS) {
      expect(
        strictToolSchemaViolations(schema.function.parameters),
        schema.function.name,
      ).toEqual([]);
    }
  });

  it('covers exactly the four agent tools', () => {
    expect(AGENT_TOOL_SCHEMAS.map((schema) => schema.function.name)).toEqual([
      'list_files',
      'read_file',
      'search_text',
      'inspect_symbol',
    ]);
  });

  it('requires additionalProperties false', () => {
    expect(
      strictToolSchemaViolations({
        type: 'object',
        properties: { q: { type: 'string' } },
        required: ['q'],
      }),
    ).toEqual(['$: additionalProperties debe ser false.']);
  });

  it('requires type object at the root', () => {
    expect(
      strictToolSchemaViolations({
        type: 'string',
        additionalProperties: false,
      }),
    ).toContain('$: type debe ser "object".');
  });

  it('requires every property to be listed in required', () => {
    expect(
      strictToolSchemaViolations({
        type: 'object',
        properties: { q: { type: 'string' }, limit: { type: 'number' } },
        required: ['q'],
        additionalProperties: false,
      }),
    ).toEqual(['$.properties.limit: falta en required.']);
  });

  it('rejects required names that are not properties', () => {
    expect(
      strictToolSchemaViolations({
        type: 'object',
        properties: {},
        required: ['ghost'],
        additionalProperties: false,
      }),
    ).toEqual(['$.required: "ghost" no es una propiedad.']);
  });

  it('checks nested objects and array items recursively', () => {
    const violations = strictToolSchemaViolations({
      type: 'object',
      properties: {
        filter: {
          type: 'object',
          properties: { a: { type: 'string' } },
          required: [],
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { b: { type: 'string' } },
            required: ['b'],
          },
        },
      },
      required: ['filter', 'items'],
      additionalProperties: false,
    });

    expect(violations).toEqual([
      '$.properties.filter: additionalProperties debe ser false.',
      '$.properties.filter.properties.a: falta en required.',
      '$.properties.items.items: additionalProperties debe ser false.',
    ]);
  });

  it('rejects a schema that is not an object', () => {
    expect(strictToolSchemaViolations(null)).toEqual([
      '$: el esquema debe ser un objeto JSON.',
    ]);
  });
});
