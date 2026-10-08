import { createHash } from 'node:crypto';
import {
  Node,
  Project,
  SyntaxKind,
  ts,
  type ConstructorDeclaration,
  type FunctionDeclaration,
  type MethodDeclaration,
  type SourceFile,
} from 'ts-morph';

// DEC-FK-003 / DEC-FK-004: huella determinista de las construcciones de comportamiento
// de un símbolo TypeScript. Módulo puro: no toca disco ni base de datos.

export type BehaviorScenarioKind =
  'EXPECTED_RESULT' | 'BOUNDARY' | 'EXCEPTION' | 'STATE_TRANSITION';

export interface BehaviorConstruct {
  scenarioKind: BehaviorScenarioKind;
  /** Forma normalizada (AST estructural). No incluye el targetRef. */
  form: string;
  /** SHA-256 hexadecimal completo de `form`. */
  formHash: string;
  /** Orden de aparición en el código fuente (0..n). */
  order: number;
  /** Texto original colapsado en una línea, máximo 160 caracteres. */
  snippet: string;
}

type BehaviorSymbolNode =
  MethodDeclaration | ConstructorDeclaration | FunctionDeclaration;

interface FormContext {
  locals: Set<string>;
  placeholders: Map<string, string>;
}

interface DescribedConstruct {
  node: Node;
  scenarioKind: BehaviorScenarioKind;
  form: string;
  snippet: string;
}

const INPUT_FILE_NAME = 'behavior-fingerprint-input.ts';
const SNIPPET_MAX_LENGTH = 160;

const COMPARISON_OPERATORS = new Set<SyntaxKind>([
  SyntaxKind.LessThanToken,
  SyntaxKind.LessThanEqualsToken,
  SyntaxKind.GreaterThanToken,
  SyntaxKind.GreaterThanEqualsToken,
]);

const ASSIGNMENT_OPERATORS = new Set<SyntaxKind>([
  SyntaxKind.EqualsToken,
  SyntaxKind.PlusEqualsToken,
  SyntaxKind.MinusEqualsToken,
  SyntaxKind.AsteriskEqualsToken,
  SyntaxKind.AsteriskAsteriskEqualsToken,
  SyntaxKind.SlashEqualsToken,
  SyntaxKind.PercentEqualsToken,
  SyntaxKind.LessThanLessThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  SyntaxKind.AmpersandEqualsToken,
  SyntaxKind.BarEqualsToken,
  SyntaxKind.CaretEqualsToken,
  SyntaxKind.AmpersandAmpersandEqualsToken,
  SyntaxKind.BarBarEqualsToken,
  SyntaxKind.QuestionQuestionEqualsToken,
]);

export function extractBehaviorConstructs(
  sourceText: string,
  qualifiedName: string,
): BehaviorConstruct[] {
  try {
    const project = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: false, noLib: true, noResolve: true },
    });
    const sourceFile = project.createSourceFile(INPUT_FILE_NAME, sourceText, {
      overwrite: true,
    });
    if (project.getProgram().getSyntacticDiagnostics(sourceFile).length > 0) {
      return [];
    }

    const symbol = findSymbol(sourceFile, qualifiedName);
    const body = symbol?.getBody();
    if (!symbol || !body) {
      return [];
    }

    const ownParamNames = new Set<string>();
    for (const parameter of symbol.getParameters()) {
      collectBindingNames(parameter.getNameNode(), ownParamNames);
    }
    const locals = collectBodyLocals(body);
    const declared = new Set<string>([...locals, ...ownParamNames]);

    const described: DescribedConstruct[] = [];
    for (const node of body.getDescendants()) {
      const construct = describeConstruct(node, locals, declared);
      if (construct) {
        described.push(construct);
      }
    }
    described.sort(
      (left, right) => left.node.getStart() - right.node.getStart(),
    );

    return described.map((construct, order) => ({
      scenarioKind: construct.scenarioKind,
      form: construct.form,
      formHash: sha256(construct.form),
      order,
      snippet: collapseSnippet(construct.snippet),
    }));
  } catch {
    return [];
  }
}

export function scenarioKeyFor(
  targetRef: string,
  construct: Pick<BehaviorConstruct, 'scenarioKind' | 'form'>,
): string {
  return `${construct.scenarioKind}:${sha256(`${targetRef}\n${construct.form}`).slice(0, 16)}`;
}

export function diffBehaviorConstructs(
  base: readonly BehaviorConstruct[],
  head: readonly BehaviorConstruct[],
): BehaviorConstruct[] {
  const baseHashes = new Set(base.map((construct) => construct.formHash));
  const seenHashes = new Set<string>();
  const changed: BehaviorConstruct[] = [];

  for (const construct of head) {
    if (
      baseHashes.has(construct.formHash) ||
      seenHashes.has(construct.formHash)
    ) {
      continue;
    }
    seenHashes.add(construct.formHash);
    changed.push(construct);
  }

  return changed;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function findSymbol(
  sourceFile: SourceFile,
  qualifiedName: string,
): BehaviorSymbolNode | undefined {
  const parts = qualifiedName.split('.');

  if (parts.length === 1) {
    return sourceFile
      .getFunctions()
      .find((fn) => fn.getName() === parts[0] && fn.hasBody());
  }

  if (parts.length !== 2) {
    return undefined;
  }

  const [className, memberName] = parts;
  for (const classDeclaration of sourceFile
    .getClasses()
    .filter((cls) => cls.getName() === className)) {
    if (memberName === 'constructor') {
      const constructorDeclaration = classDeclaration
        .getConstructors()
        .find((ctor) => ctor.hasBody());
      if (constructorDeclaration) {
        return constructorDeclaration;
      }
      continue;
    }

    const method = classDeclaration
      .getMethods()
      .find(
        (candidate) =>
          candidate.getName() === memberName && candidate.hasBody(),
      );
    if (method) {
      return method;
    }
  }

  return undefined;
}

function collectBindingNames(name: Node, into: Set<string>): void {
  if (Node.isIdentifier(name)) {
    into.add(name.getText());
    return;
  }

  if (Node.isObjectBindingPattern(name) || Node.isArrayBindingPattern(name)) {
    for (const element of name.getElements()) {
      if (Node.isBindingElement(element)) {
        collectBindingNames(element.getNameNode(), into);
      }
    }
  }
}

/** Locals declared inside the body (variables, destructuring, catch and nested parameters). */
function collectBodyLocals(body: Node): Set<string> {
  const locals = new Set<string>();
  for (const node of body.getDescendants()) {
    if (Node.isVariableDeclaration(node) || Node.isParameterDeclaration(node)) {
      collectBindingNames(node.getNameNode(), locals);
    }
  }
  return locals;
}

function describeConstruct(
  node: Node,
  locals: Set<string>,
  declared: Set<string>,
): DescribedConstruct | undefined {
  if (Node.isIfStatement(node)) {
    const condition = node.getExpression();
    return describeBranch(
      node,
      'IfStatement',
      condition,
      `if (${condition.getText()})`,
      locals,
    );
  }

  if (Node.isConditionalExpression(node)) {
    const condition = node.getCondition();
    return describeBranch(
      node,
      'ConditionalExpression',
      condition,
      node.getText(),
      locals,
    );
  }

  if (Node.isSwitchStatement(node)) {
    const context = createContext(locals);
    const discriminant = serializeNode(node.getExpression(), context);
    const labels = node
      .getCaseBlock()
      .getClauses()
      .map((clause) =>
        Node.isCaseClause(clause)
          ? `Case(${serializeNode(clause.getExpression(), context)})`
          : 'Default',
      );
    return {
      node,
      scenarioKind: containsComparison(node.getExpression())
        ? 'BOUNDARY'
        : 'EXPECTED_RESULT',
      form: `SwitchStatement(${[discriminant, ...labels].join(',')})`,
      snippet: `switch (${node.getExpression().getText()})`,
    };
  }

  if (Node.isThrowStatement(node)) {
    const expression = node.getExpression();
    return {
      node,
      scenarioKind: 'EXCEPTION',
      form: `ThrowStatement(${serializeNode(expression, createContext(locals))})`,
      snippet: node.getText(),
    };
  }

  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    const target = node.getLeft();
    if (
      !ASSIGNMENT_OPERATORS.has(operator) ||
      !isStateTarget(target, declared)
    ) {
      return undefined;
    }
    const context = createContext(locals);
    return {
      node,
      scenarioKind: 'STATE_TRANSITION',
      form: `StateWrite(${serializeNode(target, context)},${SyntaxKind[operator]},${serializeNode(node.getRight(), context)})`,
      snippet: node.getText(),
    };
  }

  if (
    Node.isPrefixUnaryExpression(node) ||
    Node.isPostfixUnaryExpression(node)
  ) {
    const operator = node.getOperatorToken();
    if (
      operator !== SyntaxKind.PlusPlusToken &&
      operator !== SyntaxKind.MinusMinusToken
    ) {
      return undefined;
    }
    const operand = node.getOperand();
    if (!isStateTarget(operand, declared)) {
      return undefined;
    }
    const position = Node.isPrefixUnaryExpression(node) ? 'prefix' : 'postfix';
    return {
      node,
      scenarioKind: 'STATE_TRANSITION',
      form: `StateUpdate(${SyntaxKind[operator]},${position},${serializeNode(operand, createContext(locals))})`,
      snippet: node.getText(),
    };
  }

  return undefined;
}

function describeBranch(
  node: Node,
  label: string,
  condition: Node,
  snippet: string,
  locals: Set<string>,
): DescribedConstruct {
  return {
    node,
    scenarioKind: containsComparison(condition)
      ? 'BOUNDARY'
      : 'EXPECTED_RESULT',
    form: `${label}(${serializeNode(condition, createContext(locals))})`,
    snippet,
  };
}

function containsComparison(expression: Node): boolean {
  return [expression, ...expression.getDescendants()].some(
    (candidate) =>
      Node.isBinaryExpression(candidate) &&
      COMPARISON_OPERATORS.has(candidate.getOperatorToken().getKind()),
  );
}

/** A write target is a member, or a variable that is not declared inside the symbol. */
function isStateTarget(target: Node, declared: Set<string>): boolean {
  if (Node.isParenthesizedExpression(target)) {
    return isStateTarget(target.getExpression(), declared);
  }
  if (
    Node.isPropertyAccessExpression(target) ||
    Node.isElementAccessExpression(target)
  ) {
    return true;
  }
  if (Node.isIdentifier(target)) {
    return !declared.has(target.getText());
  }
  if (Node.isArrayLiteralExpression(target)) {
    return target
      .getElements()
      .some((element) => isStateTarget(element, declared));
  }
  if (Node.isObjectLiteralExpression(target)) {
    return target.getProperties().some((property) => {
      if (Node.isPropertyAssignment(property)) {
        const initializer = property.getInitializer();
        return (
          initializer !== undefined && isStateTarget(initializer, declared)
        );
      }
      if (Node.isShorthandPropertyAssignment(property)) {
        return isStateTarget(property.getNameNode(), declared);
      }
      if (Node.isSpreadAssignment(property)) {
        return isStateTarget(property.getExpression(), declared);
      }
      return false;
    });
  }
  if (Node.isSpreadElement(target)) {
    return isStateTarget(target.getExpression(), declared);
  }
  if (
    Node.isBinaryExpression(target) &&
    target.getOperatorToken().getKind() === SyntaxKind.EqualsToken
  ) {
    return isStateTarget(target.getLeft(), declared);
  }
  return false;
}

function createContext(locals: Set<string>): FormContext {
  return { locals, placeholders: new Map<string, string>() };
}

/**
 * Canonical structural serialization. Trivia and comments are not children of AST nodes,
 * parentheses are unwrapped, literals are serialized by value and local identifiers become
 * positional placeholders in order of first appearance within the form.
 */
function serializeNode(node: Node, context: FormContext): string {
  if (Node.isParenthesizedExpression(node)) {
    return serializeNode(node.getExpression(), context);
  }

  if (Node.isIdentifier(node)) {
    const name = node.getText();
    if (!isMemberNamePosition(node) && context.locals.has(name)) {
      let placeholder = context.placeholders.get(name);
      if (placeholder === undefined) {
        placeholder = `$${context.placeholders.size}`;
        context.placeholders.set(name, placeholder);
      }
      return placeholder;
    }
    return `Id:${name}`;
  }

  const compiler = node.compilerNode;
  if (
    ts.isStringLiteral(compiler) ||
    ts.isNoSubstitutionTemplateLiteral(compiler) ||
    ts.isTemplateHead(compiler) ||
    ts.isTemplateMiddle(compiler) ||
    ts.isTemplateTail(compiler)
  ) {
    return `Str:${JSON.stringify(compiler.text)}`;
  }
  if (ts.isNumericLiteral(compiler)) {
    return `Num:${Number(compiler.text)}`;
  }

  const kindName = node.getKindName();
  const children = node
    .getChildren()
    .filter((child) => !child.getKindName().startsWith('JSDoc'))
    .map((child) => serializeNode(child, context));

  if (children.length === 0) {
    const carriesText =
      ts.isBigIntLiteral(compiler) ||
      ts.isRegularExpressionLiteral(compiler) ||
      ts.isPrivateIdentifier(compiler);
    return carriesText ? `${kindName}:${node.getText()}` : kindName;
  }

  return `${kindName}(${children.join(',')})`;
}

function isMemberNamePosition(identifier: Node): boolean {
  const parent = identifier.getParent();
  if (!parent) {
    return false;
  }
  const id = identifier.compilerNode;

  if (Node.isPropertyAccessExpression(parent)) {
    return parent.getNameNode().compilerNode === id;
  }
  if (Node.isQualifiedName(parent)) {
    return parent.getRight().compilerNode === id;
  }
  if (
    Node.isPropertyAssignment(parent) ||
    Node.isPropertyDeclaration(parent) ||
    Node.isPropertySignature(parent) ||
    Node.isMethodDeclaration(parent) ||
    Node.isMethodSignature(parent) ||
    Node.isGetAccessorDeclaration(parent) ||
    Node.isSetAccessorDeclaration(parent) ||
    Node.isEnumMember(parent)
  ) {
    return parent.getNameNode().compilerNode === id;
  }
  return false;
}

function collapseSnippet(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= SNIPPET_MAX_LENGTH) {
    return singleLine;
  }
  return `${singleLine.slice(0, SNIPPET_MAX_LENGTH - 3)}...`;
}
