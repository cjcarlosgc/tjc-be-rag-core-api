import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { CONTRACT_SCHEMAS } from './generated/contract-schemas.js';

/** Validación de payloads contra los esquemas JSON canónicos de `spec/contracts/schemas` (INTEROP-2.17 §10). */
export type ContractSchemaFile = keyof typeof CONTRACT_SCHEMAS;

export interface ContractValidationResult {
  valid: boolean;
  /** Mensajes legibles `ruta: motivo`; vacío cuando `valid` es true. Nunca incluye valores del payload. */
  errors: string[];
}

type AddFormats = (ajv: Ajv2020) => Ajv2020;
const addFormats = ((addFormatsModule as unknown as { default?: AddFormats }).default ?? addFormatsModule) as unknown as AddFormats;

const ajv = addFormats(new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true }));
for (const schema of Object.values(CONTRACT_SCHEMAS)) ajv.addSchema(schema as unknown as object);

/**
 * Valida `data` contra la definición `definition` (clave de `$defs`) del esquema `file`, o contra la raíz del
 * esquema cuando se omite `definition` (p. ej. `error-envelope.schema.json`).
 */
export function validateContract(file: ContractSchemaFile, definition: string | null, data: unknown): ContractValidationResult {
  const id = (CONTRACT_SCHEMAS[file] as { $id: string }).$id;
  const validate = ajv.getSchema(definition ? `${id}#/$defs/${definition}` : id);
  if (!validate) throw new Error(`Contrato desconocido: ${file}${definition ? `#${definition}` : ''}`);
  if (validate(data)) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: (validate.errors ?? []).map((e) => `${e.instancePath || '/'}: ${e.message ?? 'inválido'}`),
  };
}
