import { createHash } from 'node:crypto';
import { Parser, type Node as SyntaxNode, type Tree } from 'web-tree-sitter';
import { loadPhpLanguage } from '../../project-versions/parsing/php-parser.service.js';
import {
  collapseSnippet,
  type BehaviorConstruct,
  type BehaviorScenarioKind,
} from './behavior-fingerprint.js';

// DEC-FK-003 / DEC-FK-004 para PHP (WI-CORE-032): mismo contrato BehaviorConstruct que el
// extractor TypeScript, con el AST de tree-sitter-php. Módulo puro: no toca disco ni base de datos.

interface DescribedConstruct {
  node: SyntaxNode;
  scenarioKind: BehaviorScenarioKind;
  form: string;
  snippet: string;
}

interface Scope {
  /** Variables normalizables (cuerpo y closures anidadas); los parámetros propios quedan fuera. */
  locals: Set<string>;
  /** Variables declaradas en el símbolo (propias, del cuerpo y de closures); base de la regla de estado. */
  declared: Set<string>;
}

interface FormContext {
  locals: Set<string>;
  placeholders: Map<string, string>;
}

const COMPARISON_OPERATORS = new Set(['<', '<=', '>', '>=']);
const STATE_ACCESS_TYPES = new Set([
  'member_access_expression',
  'nullsafe_member_access_expression',
  'scoped_property_access_expression',
]);
const THROW_TYPES = new Set(['throw_expression', 'throw_statement']);
const WRITE_TYPES = new Set(['assignment_expression', 'augmented_assignment_expression']);
const CLASS_LIKE_TYPES = new Set(['class_declaration', 'trait_declaration', 'enum_declaration']);
/** Variables que no son locales al símbolo: `$this` y superglobales. */
const NON_LOCAL_VARIABLES = new Set([
  '$this', '$GLOBALS', '$_SERVER', '$_GET', '$_POST', '$_COOKIE', '$_FILES', '$_ENV', '$_REQUEST', '$_SESSION',
]);

/**
 * Construcciones de comportamiento de un método o función PHP identificado por
 * `Namespace\Clase.metodo` o `Namespace\funcion` (también sin namespace).
 * Devuelve [] si el símbolo no existe, el parseo tiene errores o algo falla.
 */
export async function extractPhpBehaviorConstructs(
  source: string,
  qualifiedName: string,
): Promise<BehaviorConstruct[]> {
  let parser: Parser | undefined;
  let tree: Tree | null = null;
  try {
    const language = await loadPhpLanguage();
    parser = new Parser();
    parser.setLanguage(language);
    tree = parser.parse(source);
    if (!tree || tree.rootNode.hasError) {
      return [];
    }

    const symbol = findSymbol(tree.rootNode, qualifiedName);
    const body = symbol?.childForFieldName('body');
    if (!symbol || !body) {
      return [];
    }

    const scope = collectScope(symbol);
    const described: DescribedConstruct[] = [];
    for (const node of descendantsOf(body)) {
      const construct = describeConstruct(node, scope);
      if (construct) {
        described.push(construct);
      }
    }
    described.sort((left, right) => left.node.startIndex - right.node.startIndex);

    return described.map((construct, order) => ({
      scenarioKind: construct.scenarioKind,
      form: construct.form,
      formHash: sha256(construct.form),
      order,
      snippet: collapseSnippet(construct.snippet),
    }));
  } catch {
    return [];
  } finally {
    tree?.delete();
    parser?.delete();
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function describeConstruct(node: SyntaxNode, scope: Scope): DescribedConstruct | undefined {
  if (node.type === 'if_statement' || node.type === 'else_if_clause') {
    const condition = node.childForFieldName('condition');
    if (!condition) {
      return undefined;
    }
    const expression = unwrap(condition);
    const keyword = node.type === 'else_if_clause' ? 'elseif' : 'if';
    return {
      node,
      scenarioKind: scenarioFor(expression),
      form: `IfStatement(${serializeNode(expression, createContext(scope))})`,
      snippet: `${keyword} (${expression.text})`,
    };
  }

  if (node.type === 'conditional_expression') {
    const condition = node.childForFieldName('condition');
    // `?:` abreviado: no tiene campo `body`; no cuenta (paridad con TypeScript).
    if (!condition || !node.childForFieldName('body')) {
      return undefined;
    }
    const expression = unwrap(condition);
    return {
      node,
      scenarioKind: scenarioFor(expression),
      form: `ConditionalExpression(${serializeNode(expression, createContext(scope))})`,
      snippet: node.text,
    };
  }

  if (node.type === 'switch_statement') {
    const discriminant = node.childForFieldName('condition');
    if (!discriminant) {
      return undefined;
    }
    const expression = unwrap(discriminant);
    const context = createContext(scope);
    const discriminantForm = serializeNode(expression, context);
    const labels = caseLabels(node.childForFieldName('body'), context);
    return {
      node,
      scenarioKind: scenarioFor(expression),
      form: `SwitchStatement(${[discriminantForm, ...labels].join(',')})`,
      snippet: `switch (${expression.text})`,
    };
  }

  if (node.type === 'match_expression') {
    const discriminant = node.childForFieldName('condition');
    if (!discriminant) {
      return undefined;
    }
    const expression = unwrap(discriminant);
    const context = createContext(scope);
    const discriminantForm = serializeNode(expression, context);
    const labels = matchLabels(node.childForFieldName('body'), context);
    return {
      node,
      scenarioKind: scenarioFor(expression),
      form: `MatchExpression(${[discriminantForm, ...labels].join(',')})`,
      snippet: `match (${expression.text})`,
    };
  }

  if (THROW_TYPES.has(node.type)) {
    const expression = namedChildrenOf(node)[0];
    if (!expression) {
      return undefined;
    }
    return {
      node,
      scenarioKind: 'EXCEPTION',
      form: `ThrowStatement(${serializeNode(expression, createContext(scope))})`,
      snippet: node.text,
    };
  }

  if (WRITE_TYPES.has(node.type)) {
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    if (!left || !right || !isStateTarget(left, scope)) {
      return undefined;
    }
    const operator = childrenOf(node).find((child) => !child.isNamed && child.startIndex >= left.endIndex);
    if (!operator) {
      return undefined;
    }
    const context = createContext(scope);
    return {
      node,
      scenarioKind: 'STATE_TRANSITION',
      form: `StateWrite(${serializeNode(left, context)},${operator.type},${serializeNode(right, context)})`,
      snippet: node.text,
    };
  }

  if (node.type === 'update_expression') {
    const argument = node.childForFieldName('argument');
    const operator = childrenOf(node).find((child) => !child.isNamed);
    if (!argument || !operator || !isStateTarget(argument, scope)) {
      return undefined;
    }
    const position = operator.startIndex < argument.startIndex ? 'prefix' : 'postfix';
    return {
      node,
      scenarioKind: 'STATE_TRANSITION',
      form: `StateUpdate(${operator.type},${position},${serializeNode(argument, createContext(scope))})`,
      snippet: node.text,
    };
  }

  return undefined;
}

function scenarioFor(expression: SyntaxNode): BehaviorScenarioKind {
  return containsComparison(expression) ? 'BOUNDARY' : 'EXPECTED_RESULT';
}

function caseLabels(body: SyntaxNode | null, context: FormContext): string[] {
  if (!body) {
    return [];
  }
  return namedChildrenOf(body).flatMap((clause) => {
    if (clause.type === 'case_statement') {
      const value = clause.childForFieldName('value');
      return [`Case(${value ? serializeNode(value, context) : ''})`];
    }
    if (clause.type === 'default_statement') {
      return ['Default'];
    }
    return [];
  });
}

function matchLabels(body: SyntaxNode | null, context: FormContext): string[] {
  if (!body) {
    return [];
  }
  return namedChildrenOf(body).flatMap((arm) => {
    if (arm.type === 'match_default_expression') {
      return ['Default'];
    }
    if (arm.type !== 'match_conditional_expression') {
      return [];
    }
    const conditions = arm.childForFieldName('conditional_expressions');
    const items = conditions?.type === 'match_condition_list'
      ? namedChildrenOf(conditions)
      : conditions ? [conditions] : [];
    return items.map((item) => `Case(${serializeNode(item, context)})`);
  });
}

function containsComparison(expression: SyntaxNode): boolean {
  return descendantsOf(expression).some((candidate) => {
    if (candidate.type !== 'binary_expression') {
      return false;
    }
    const operator = childrenOf(candidate).find((child) => !child.isNamed);
    return operator !== undefined && COMPARISON_OPERATORS.has(operator.type);
  });
}

/**
 * Un destino es estado si es acceso a miembro/propiedad estática o subíndice de estado.
 * Una variable declarada en el símbolo (propia, del cuerpo o de closure) no es estado;
 * una superglobal o `$this` sí, igual que un identificador no declarado en TypeScript.
 */
function isStateTarget(target: SyntaxNode, scope: Scope): boolean {
  const node = unwrap(target);
  if (STATE_ACCESS_TYPES.has(node.type)) {
    return true;
  }
  switch (node.type) {
    case 'subscript_expression': {
      const base = namedChildrenOf(node)[0];
      return base !== undefined && isStateTarget(base, scope);
    }
    case 'variable_name':
      return !scope.declared.has(node.text);
    case 'list_literal':
    case 'array_creation_expression':
      return namedChildrenOf(node).some((element) => {
        const value = element.type === 'array_element_initializer'
          ? namedChildrenOf(element)[namedChildrenOf(element).length - 1]
          : element;
        return value !== undefined && isStateTarget(value, scope);
      });
    default:
      return false;
  }
}

/**
 * Ámbito del símbolo. `declared` recoge todas las variables (parámetros propios, cuerpo y closures
 * anidadas, como hace el extractor TypeScript) excepto `$this` y superglobales. `locals` excluye los
 * parámetros propios: en PHP una variable del cuerpo con el mismo nombre que un parámetro propio es
 * ese parámetro. Los parámetros propios quedan literales en la forma; el resto se normaliza.
 */
function collectScope(symbol: SyntaxNode): Scope {
  const declared = new Set<string>();
  for (const node of descendantsOf(symbol)) {
    if (node.type === 'variable_name' && !NON_LOCAL_VARIABLES.has(node.text)) {
      declared.add(node.text);
    }
  }
  const ownParameters = new Set<string>();
  const parameters = symbol.childForFieldName('parameters');
  if (parameters) {
    for (const node of descendantsOf(parameters)) {
      if (node.type === 'variable_name') {
        ownParameters.add(node.text);
      }
    }
  }
  const locals = new Set([...declared].filter((name) => !ownParameters.has(name)));
  return { locals, declared };
}

function createContext(scope: Scope): FormContext {
  return { locals: scope.locals, placeholders: new Map<string, string>() };
}

/**
 * Serialización estructural canónica: sin comentarios ni espacios, paréntesis desenvueltos,
 * literales por valor y variables locales como marcadores posicionales en orden de aparición.
 */
function serializeNode(node: SyntaxNode, context: FormContext): string {
  const current = unwrap(node);

  if (current.type === 'variable_name' && context.locals.has(current.text)) {
    let placeholder = context.placeholders.get(current.text);
    if (placeholder === undefined) {
      placeholder = `$${context.placeholders.size + 1}`;
      context.placeholders.set(current.text, placeholder);
    }
    return placeholder;
  }

  const literal = serializeLiteral(current);
  if (literal !== undefined) {
    return literal;
  }

  const children = childrenOf(current);
  if (children.length === 0) {
    return current.isNamed ? `${current.type}:${JSON.stringify(current.text)}` : current.type;
  }
  return `${current.type}(${children.map((child) => serializeNode(child, context)).join(',')})`;
}

function serializeLiteral(node: SyntaxNode): string | undefined {
  switch (node.type) {
    case 'integer':
      return `Num:${integerValue(node.text)}`;
    case 'float':
      return `Num:${Number(node.text.replace(/_/g, ''))}`;
    case 'string':
      return `Str:${JSON.stringify(node.text.slice(1, -1))}`;
    case 'boolean':
    case 'null':
      return `${node.type}:${node.text.toLowerCase()}`;
    default:
      return undefined;
  }
}

/** Entero PHP: separadores `_`, octal legado (`017`) y prefijos 0x/0b/0o. */
function integerValue(text: string): number {
  const digits = text.replace(/_/g, '').toLowerCase();
  if (/^0[0-7]+$/.test(digits)) {
    return Number.parseInt(digits, 8);
  }
  return Number(digits);
}

function unwrap(node: SyntaxNode): SyntaxNode {
  let current = node;
  while (current.type === 'parenthesized_expression') {
    const inner = namedChildrenOf(current)[0];
    if (!inner) {
      break;
    }
    current = inner;
  }
  return current;
}

function childrenOf(node: SyntaxNode): SyntaxNode[] {
  return node.children.filter((child): child is SyntaxNode => child !== null && child.type !== 'comment');
}

function namedChildrenOf(node: SyntaxNode): SyntaxNode[] {
  return node.namedChildren.filter((child): child is SyntaxNode => child !== null && child.type !== 'comment');
}

/** Nodo y descendientes en preorden (incluye closures anidadas). */
function descendantsOf(root: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  const stack: SyntaxNode[] = [root];
  for (let node = stack.pop(); node; node = stack.pop()) {
    result.push(node);
    const children = childrenOf(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }
  return result;
}

function normalizeNamespace(name: string): string {
  return name.replace(/^\\+|\\+$/g, '');
}

function splitQualified(name: string): { namespace: string; shortName: string } {
  const index = name.lastIndexOf('\\');
  return index < 0
    ? { namespace: '', shortName: name }
    : { namespace: normalizeNamespace(name.slice(0, index)), shortName: name.slice(index + 1) };
}

/**
 * Declaraciones de nivel superior que pertenecen a `namespace`: cuerpo de la forma con bloque,
 * o hermanos posteriores a `namespace X;` hasta el siguiente `namespace`.
 */
function declarationsInNamespace(root: SyntaxNode, namespace: string): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  let current = '';
  for (const child of namedChildrenOf(root)) {
    if (child.type === 'namespace_definition') {
      const name = normalizeNamespace(child.childForFieldName('name')?.text ?? '');
      const body = child.childForFieldName('body');
      if (body) {
        if (name === namespace) {
          result.push(...namedChildrenOf(body));
        }
        current = '';
      } else {
        current = name;
      }
      continue;
    }
    if (current === namespace) {
      result.push(child);
    }
  }
  return result;
}

function findSymbol(root: SyntaxNode, qualifiedName: string): SyntaxNode | undefined {
  const name = normalizeNamespace(qualifiedName);
  const separator = name.lastIndexOf('.');

  if (separator < 0) {
    const { namespace, shortName } = splitQualified(name);
    return declarationsInNamespace(root, namespace).find(
      (declaration) => declaration.type === 'function_definition'
        && declaration.childForFieldName('name')?.text === shortName
        && declaration.childForFieldName('body') !== null,
    );
  }

  const classPath = name.slice(0, separator);
  const memberName = name.slice(separator + 1);
  const { namespace, shortName } = splitQualified(classPath);
  for (const declaration of declarationsInNamespace(root, namespace)) {
    if (!CLASS_LIKE_TYPES.has(declaration.type) || declaration.childForFieldName('name')?.text !== shortName) {
      continue;
    }
    const classBody = declaration.childForFieldName('body');
    if (!classBody) {
      continue;
    }
    const method = namedChildrenOf(classBody).find(
      (member) => member.type === 'method_declaration'
        && member.childForFieldName('name')?.text === memberName
        && member.childForFieldName('body') !== null,
    );
    if (method) {
      return method;
    }
  }
  return undefined;
}
