#!/usr/bin/env node
// Genera `src/contracts/generated/*` desde los esquemas JSON canónicos de `spec/contracts/schemas`.
// Uso: node scripts/generate-contract-types.mjs [--check]   (--check falla si el resultado difiere del commit)
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';

const here = dirname(fileURLToPath(import.meta.url));
const schemasDir = resolve(here, '../../spec/contracts/schemas');
const outDir = resolve(here, '../src/contracts/generated');
const check = process.argv.includes('--check');

const files = readdirSync(schemasDir).filter((f) => f.endsWith('.schema.json')).sort();
const schemas = Object.fromEntries(files.map((f) => [f, JSON.parse(readFileSync(join(schemasDir, f), 'utf8'))]));

// Un esquema con solo `$defs` no produce tipos por sí mismo: se envuelve en una raíz que referencia cada definición.
const wrap = (name, schema) => {
  const defs = Object.keys(schema.$defs ?? {});
  if (schema.type || defs.length === 0) return { ...schema, title: schema.title ?? name };
  return {
    $schema: schema.$schema,
    title: `${name}Definitions`,
    type: 'object',
    additionalProperties: false,
    required: defs,
    properties: Object.fromEntries(defs.map((d) => [d, { $ref: `#/$defs/${d}` }])),
    $defs: schema.$defs,
  };
};

// Quita el ruido de la envoltura: la interfaz `<Nombre>Definitions` y los comentarios «This interface was referenced by».
const REF_NOISE = /^\s*\*\s*(This interface was referenced by|via the `definition`)/;
function clean(source) {
  const withoutWrapper = source.replace(/export interface \w+Definitions \{[\s\S]*?\n\}\n/g, '');
  return withoutWrapper.replace(/[ \t]*\/\*\*[\s\S]*?\*\/\n/g, (block) => {
    const lines = block.split('\n').filter((l) => !REF_NOISE.test(l));
    const text = lines.filter((l) => !/^\s*(\/\*\*|\*\/|\*)?\s*$/.test(l));
    if (text.length === 0) return '';
    // elimina la línea vacía de comentario que quedó justo antes del cierre
    return lines.filter((l, i) => !(/^\s*\*\s*$/.test(l) && /^\s*\*\//.test(lines[i + 1] ?? ''))).join('\n');
  }).replace(/\n{3,}/g, '\n\n');
}

const banner = '/* AUTO-GENERADO por scripts/generate-contract-types.mjs desde spec/contracts/schemas. No editar a mano. */';
let types = `${banner}\n`;
for (const f of files) {
  const name = f.replace(/\.schema\.json$/, '').split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join('');
  const raw = await compile(wrap(name, schemas[f]), name, {
    bannerComment: '', cwd: schemasDir, additionalProperties: false, declareExternallyReferenced: true,
    unreachableDefinitions: true, strictIndexSignatures: false, format: true,
  });
  types += `\n// ===== ${f} =====\n${clean(raw).trim()}\n`;
}
const bundle = `${banner}\nexport const CONTRACT_SCHEMAS = ${JSON.stringify(schemas, null, 2)} as const;\n`;

const outputs = { 'contract-types.ts': types, 'contract-schemas.ts': bundle };
mkdirSync(outDir, { recursive: true });
let drift = false;
for (const [name, content] of Object.entries(outputs)) {
  const target = join(outDir, name);
  if (check) {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== content) {
      console.error(`DESACTUALIZADO: ${name} (ejecuta pnpm contracts:generate)`);
      drift = true;
    }
  } else writeFileSync(target, content);
}
if (check) process.exit(drift ? 1 : 0);
console.log(`Contratos generados en src/contracts/generated (${files.length} esquemas).`);
