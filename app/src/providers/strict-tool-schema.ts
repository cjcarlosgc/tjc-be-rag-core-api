/**
 * Validador puro de las reglas que Responses exige con `strict: true` en un esquema
 * de herramienta (WI-CORE-031): `type: 'object'`, `additionalProperties: false` y toda
 * propiedad listada en `required`. Se aplica recursivamente a objetos anidados y a
 * `items` de arreglos. Devuelve las infracciones encontradas (vacío = cumple).
 */
export function strictToolSchemaViolations(
  schema: unknown,
  path = '$',
): string[] {
  if (!isRecord(schema)) {
    return [`${path}: el esquema debe ser un objeto JSON.`];
  }

  const violations: string[] = [];
  if (schema.type !== 'object') {
    violations.push(`${path}: type debe ser "object".`);
  }
  if (schema.additionalProperties !== false) {
    violations.push(`${path}: additionalProperties debe ser false.`);
  }

  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : null;
  if (required === null) {
    violations.push(`${path}: required debe ser un arreglo.`);
  } else {
    const requiredNames = new Set(required);
    for (const name of Object.keys(properties)) {
      if (!requiredNames.has(name)) {
        violations.push(`${path}.properties.${name}: falta en required.`);
      }
    }
    for (const name of required) {
      if (!(name in properties)) {
        violations.push(
          `${path}.required: "${String(name)}" no es una propiedad.`,
        );
      }
    }
  }

  for (const [name, property] of Object.entries(properties)) {
    violations.push(
      ...nestedViolations(property, `${path}.properties.${name}`),
    );
  }

  return violations;
}

function nestedViolations(property: unknown, path: string): string[] {
  if (!isRecord(property)) return [];
  if (property.type === 'object') {
    return strictToolSchemaViolations(property, path);
  }
  if (property.type === 'array' && isRecord(property.items)) {
    return nestedViolations(property.items, `${path}.items`);
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
