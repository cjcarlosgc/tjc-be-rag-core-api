// Pruebas del replay de calibracion offline (WI-CORE-063). Fixtures sinteticos (clases inventadas).
// Ejecutar: node --test harness/calibration/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  loadCase, loadDeps, baselineTopK, recompute, collaboratorsOf, m1Collaborators, m3Noise, m4Tokens,
  m5Stability, m6Static, isFinalPhpDeclaration, loadTokenizer, discoverCases, DEFAULT_CONFIG, REPO_ROOT, round,
  aggregateM6Precision, precisionOf,
} from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures');
const SYN = 'SYN-1';
const TAX = 'Acme\\Tax\\Tax';
const MONEY = 'Acme\\Orders\\Money';
const GATEWAY = 'Acme\\Orders\\Gateway';

const load = (deps = true) => loadCase(FIX, SYN, deps ? loadDeps(FIX) : null);
const tokOf = (c, ids) => ids.reduce((a, id) => a + c.byId.get(id).tokenCount, 0);
const tok = await loadTokenizer(REPO_ROOT);

test('carga de caso: meta, anclaje, candidatos y deps', () => {
  const c = load();
  assert.equal(c.id, SYN);
  assert.equal(c.anchor.id, 'c-anchor');
  assert.equal(c.anchorClass, 'Acme\\Orders\\Pricer');
  assert.equal(c.cands.length, 12);
  assert.equal(c.trials.length, 3);
  assert.equal(c.deps.entries.length, 3);
  assert.deepEqual(discoverCases(FIX), [SYN]);
  assert.equal(load(false).deps, null);
});

test('linea base: el top-10 recalculado reproduce el SELECTED persistido (10/10)', () => {
  const c = load();
  const base = baselineTopK(c);
  assert.equal(base.length, 10);
  assert.deepEqual(recompute(c, DEFAULT_CONFIG).selected, base);
});

test('recompute con pesos distintos cambia el orden esperado', () => {
  const c = load();
  const base = baselineTopK(c);
  const structOnly = recompute(c, { semanticWeight: 0, structuralWeight: 1, topK: 10, minimumScore: 0 }).selected;
  // Solo cuatro candidatos tienen struct (Pricer, Money, Gateway, Other): Other sube al cuarto puesto.
  assert.equal(structOnly[3], 'c-other');
  assert.equal(base[3], 'c-tax');
  assert.equal(structOnly.length, 10);
  assert.ok(structOnly.indexOf('c-tax') > 3);
});

test('recompute respeta topK y minimumScore', () => {
  const c = load();
  assert.equal(recompute(c, { topK: 8 }).selected.length, 8);
  const high = recompute(c, { minimumScore: 0.5 }).selected;
  assert.deepEqual(high, ['c-pricer', 'c-money', 'c-gateway', 'c-tax', 'c-ctor']);
});

test('M5: 10/10 frente a si misma y <10/10 con topK 8 o con orden distinto', () => {
  const c = load();
  const base = baselineTopK(c);
  const same = m5Stability(base, base);
  assert.equal(same.overlapLabel, '10/10');
  assert.equal(same.tenOfTen, true);
  assert.equal(same.sameOrder, true);

  const k8 = m5Stability(base, recompute(c, { topK: 8 }).selected);
  assert.equal(k8.overlapLabel, '8/10');
  assert.equal(k8.tenOfTen, false);
  assert.equal(k8.sameSet, false);

  const reordered = m5Stability(base, recompute(c, { semanticWeight: 0, structuralWeight: 1 }).selected);
  assert.equal(reordered.sameSet, true);
  assert.equal(reordered.sameOrder, false);
  assert.equal(reordered.tenOfTen, false);
});

test('M1: detecta un colaborador fuera del top-10 pero presente en la seccion de dependencias', () => {
  const c = load();
  const base = baselineTopK(c);
  const collab = collaboratorsOf(c);
  assert.deepEqual(collab, [GATEWAY, MONEY, TAX].sort());

  const full = m1Collaborators(c, base);
  assert.equal(full.inTop.length, 3);
  assert.equal(full.pctInTop, 100);
  assert.deepEqual(full.missingTop, []);

  const top3 = m1Collaborators(c, recompute(c, { topK: 3 }).selected);
  assert.deepEqual(top3.missingTop, [TAX]);
  assert.ok(top3.inSection.includes(TAX));
  assert.deepEqual(top3.missingAnywhere, []);
  assert.equal(top3.pctInTop, round((2 / 3) * 100));
});

test('M1 sin deps.json: el faltante cuenta como ausente', () => {
  const c = load(false);
  const top3 = m1Collaborators(c, recompute(c, { topK: 3 }).selected);
  assert.equal(top3.inSection, null);
  assert.deepEqual(top3.missingAnywhere, [TAX]);
});

test('M3: porcentajes de ruido de pruebas y de miembros ajenos', () => {
  const c = load();
  const base = baselineTopK(c);
  const total = tokOf(c, base);
  const m3 = m3Noise(c, base);
  assert.equal(m3.selectedTokens, total);
  // OtherTest (31 tokens) no menciona price; PricerTest si. Other::total (14) es miembro ajeno sin nombre en el objetivo.
  // Gateway::rate (12) SI aparece en el objetivo (->rate()), no es ruido.
  assert.equal(m3.testNoiseTokens, 31);
  assert.equal(m3.testNoiseCount, 1);
  assert.equal(m3.testNoisePct, round((31 / total) * 100));
  assert.equal(m3.memberNoiseTokens, 14);
  assert.equal(m3.memberNoisePct, round((14 / total) * 100));
});

test('M4: tokens de seccion y delta de tokens seleccionados frente a la base', () => {
  const c = load();
  const base = baselineTopK(c);
  const top3 = recompute(c, { topK: 3 }).selected;
  const same = m4Tokens(c, base, tok, base);
  assert.equal(same.sectionTokens, 80);
  assert.equal(same.baselineContextTokens, 400);
  assert.equal(same.deltaVsBaselinePct, 0);
  assert.ok(['cl100k_base', 'estimate'].includes(same.tokenizer));
  const smaller = m4Tokens(c, top3, tok, base);
  assert.ok(smaller.deltaVsBaselinePct < 0);
  assert.equal(smaller.selectedTokensPersisted, tokOf(c, top3));
});

test('tokenizador: si no hay gpt-tokenizer usa estimacion ceil(chars/4)', async () => {
  const est = await loadTokenizer('/ruta/que/no/existe');
  assert.equal(est.name, 'estimate');
  assert.equal(est.count('abcde'), 2);
  const real = await loadTokenizer(REPO_ROOT);
  assert.ok(['cl100k_base', 'estimate'].includes(real.name));
});

test('M6: detecta createMock sobre final, assertSame con objetos y use inventado', () => {
  const c = load();
  const m6 = m6Static(c);
  assert.equal(m6.trialsAnalyzed, 2);
  const byRule = Object.fromEntries(m6.rules.map((r) => [r.rule, r]));
  // Tax y Money son final; Gateway es interfaz (no se marca).
  assert.equal(byRule['R-FINAL'].count, 2);
  assert.ok(byRule['R-FINAL'].evidence.every((e) => e.snippet.length <= 80 && typeof e.line === 'number'));
  // assertSame(new Money(10), ...) y assertSame($when, ...) con DateTimeImmutable.
  assert.equal(byRule['R-SAME'].count, 2);
  // Acme\Inventado\Widget no esta en el contexto; Pricer, Tax, Gateway, Money, TestCase y DateTimeImmutable si.
  assert.equal(byRule['R-NS'].count, 1);
  assert.match(byRule['R-NS'].evidence[0].snippet, /Inventado\\Widget/);
});

test('M6: no marca casos validos (assertEquals, doble de interfaz, use presente)', () => {
  const c = load();
  const clean = { ...c, trials: [c.trials[1]] };
  const m6 = m6Static(clean);
  assert.equal(m6.trialsAnalyzed, 1);
  assert.deepEqual(m6.rules.map((r) => r.count), [0, 0, 0, 0, 0, 0]);
});

test('M6 sin trials.json devuelve null', () => {
  const c = { ...load(), trials: null };
  assert.equal(m6Static(c), null);
});

test('isFinalPhpDeclaration: final, abstract, readonly, atributos y comentarios', () => {
  assert.equal(isFinalPhpDeclaration('final class A {}', 'CLASS'), true);
  assert.equal(isFinalPhpDeclaration('final readonly class A {}', 'CLASS'), true);
  assert.equal(isFinalPhpDeclaration('readonly final class A {}', 'CLASS'), true);
  assert.equal(isFinalPhpDeclaration('#[Attr("x]")]\nfinal class A {}', 'CLASS'), true);
  assert.equal(isFinalPhpDeclaration('/** final */\nfinal class A {}', 'CLASS'), true);
  assert.equal(isFinalPhpDeclaration('abstract class A {}', 'CLASS'), false);
  assert.equal(isFinalPhpDeclaration('readonly class A {}', 'CLASS'), false);
  assert.equal(isFinalPhpDeclaration('class A {}', 'CLASS'), false);
  assert.equal(isFinalPhpDeclaration('interface A {}', 'INTERFACE'), false);
  assert.equal(isFinalPhpDeclaration('/* final */ class A {}', 'CLASS'), false);
  assert.equal(isFinalPhpDeclaration('enum E { case X; }', 'ENUM'), true);
  assert.equal(isFinalPhpDeclaration(null, 'CLASS'), false);
});

test('extractor: aborta si --out esta dentro del repo, antes de conectar, sin imprimir credenciales', () => {
  const script = join(HERE, 'extract-experiments.sh');
  const inside = join(HERE, 'tmp-no-usar');
  const r = spawnSync('bash', [script, '--out', inside, 'abcdef12'], { encoding: 'utf8', timeout: 20000 });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /dentro del repositorio/);
  assert.equal(existsSync(inside), false);
  assert.equal(`${r.stdout}${r.stderr}`.includes('DATABASE_URL='), false);
  assert.equal(/postgres(ql)?:\/\//.test(`${r.stdout}${r.stderr}`), false);
});

test('extractor: sin argumentos devuelve uso (64) sin tocar nada', () => {
  const r = spawnSync('bash', [join(HERE, 'extract-experiments.sh')], { encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 64);
});

test('extractor: el script no contiene la asignacion de credenciales literal ni secretos', () => {
  const src = readFileSync(join(HERE, 'extract-experiments.sh'), 'utf8');
  // Se prohíbe la asignación literal de la URL (`DATABASE_URL=valor`); el grep de lectura `^DATABASE_URL=` es válido.
  assert.equal(/^\s*(export\s+)?DATABASE_URL\s*=\s*\S/m.test(src), false);
  assert.equal(/postgres(ql)?:\/\/[^\s'"$]+@/.test(src), false);
  assert.ok(src.includes('default_transaction_read_only=on'));
  assert.ok(src.includes('statement_timeout=60000'));
});

test('fixtures: no contienen codigo de terceros (solo espacio Acme)', () => {
  for (const f of readdirSync(FIX)) {
    const txt = readFileSync(join(FIX, f), 'utf8');
    assert.equal(/App\\(Services|Domain)\\/.test(txt), false, f);
  }
  assert.ok(existsSync(join(FIX, 'SYN-1.trials.json')));
});

// ---- M6 R-SAME: identidad solo marcable con variables de uso local (WI-CORE-063 corte B) ----
const PLAN_CHUNK = {
  id: 'c-plan', filePath: 'src/Billing/Plan.php', symbolKind: 'CLASS', symbolName: 'Acme\\Billing\\Plan',
  parentSymbolName: null, importsUsed: [], content: 'final readonly class Plan { public function __construct(public int $price) {} }', tokenCount: 12,
};
const testFile = (uses, body) => `<?php\nnamespace Acme\\Tests\\Billing;\n${uses.map((u) => `use ${u};`).join('\n')}\n`
  + `class BillingTest extends TestCase {\n  public function testIt(): void {\n${body}\n  }\n}`;
const withTrials = (c, trials, extraChunks = []) => ({ ...c, chunks: [...c.chunks, ...extraChunks], trials });
const trial = (testContent, extra = {}) => ({ strategy: 'RAG', repetition: 1, valid: true, failureType: 'NONE', errorSummary: null, testContent, ...extra });

test('M6 R-SAME: variable DateTimeImmutable asignada y solo usada en assertSame -> marcada', () => {
  const c = withTrials(load(), [trial(testFile(['DateTimeImmutable', 'PHPUnit\\Framework\\TestCase'],
    "    $expected = new DateTimeImmutable('2024-01-01');\n    $this->assertSame($expected, $subject->date());"))]);
  const r = m6Static(c).rules.find((x) => x.rule === 'R-SAME');
  assert.equal(r.count, 1);
  assert.equal(r.evidence[0].line, 8);
});

test('M6 R-SAME: variable VO pasada a un constructor antes del assertSame -> NO marcada', () => {
  const uses = ['Acme\\Billing\\Plan', 'Acme\\Billing\\Sub', 'PHPUnit\\Framework\\TestCase'];
  const body = '    $plan = new Plan(10);\n    $s = new Sub($plan);\n    $this->assertSame($plan, $s->plan);';
  const c = withTrials(load(), [trial(testFile(uses, body))], [PLAN_CHUNK]);
  assert.equal(m6Static(c).rules.find((x) => x.rule === 'R-SAME').count, 0);
  // Control: la misma variable VO sin otro uso si se marca.
  const control = withTrials(load(), [trial(testFile(uses, '    $plan = new Plan(10);\n    $this->assertSame($plan, $this->make());'))], [PLAN_CHUNK]);
  assert.equal(m6Static(control).rules.find((x) => x.rule === 'R-SAME').count, 1);
});

test('M6 R-SAME: uso en otro assertSame del mismo metodo impide marcar; otro metodo no cuenta', () => {
  const uses = ['DateTimeImmutable', 'PHPUnit\\Framework\\TestCase'];
  const twoAsserts = "    $d = new DateTimeImmutable('2024-01-01');\n    $this->assertSame($d, $a());\n    $this->assertSame($d, $b());";
  const c = withTrials(load(), [trial(testFile(uses, twoAsserts))]);
  assert.equal(m6Static(c).rules.find((x) => x.rule === 'R-SAME').count, 0);
  const otherMethod = `<?php\nnamespace Acme\\Tests\\Billing;\nuse DateTimeImmutable;\nuse PHPUnit\\Framework\\TestCase;\nclass BillingTest extends TestCase {\n`
    + `  public function testA(): void {\n    $d = new DateTimeImmutable('2024-01-01');\n    $this->assertSame($d, $a());\n  }\n`
    + `  public function testB(): void {\n    $this->assertSame($d, $b());\n  }\n}`;
  const c2 = withTrials(load(), [trial(otherMethod)]);
  assert.equal(m6Static(c2).rules.find((x) => x.rule === 'R-SAME').count, 1);
});

test('M6 R-SAME: inline new de clase no VO ni DateTime no se marca; inline VO final readonly si', () => {
  const uses = ['Acme\\Billing\\Plan', 'Acme\\Billing\\Other', 'PHPUnit\\Framework\\TestCase'];
  const c = withTrials(load(), [trial(testFile(uses, '    $this->assertSame(new Other(), $x);\n    $this->assertSame(new Plan(1), $y);'))], [PLAN_CHUNK]);
  assert.equal(m6Static(c).rules.find((x) => x.rule === 'R-SAME').count, 1);
});

test('M6 R-FINAL: Mockery::mock solo sobre tipos final del caso', () => {
  const c = withTrials(load(), [trial(testFile(['Acme\\Tax\\Tax', 'Acme\\Orders\\Gateway', 'PHPUnit\\Framework\\TestCase'],
    '    $t = Mockery::mock(Tax::class);\n    $g = Mockery::mock(Gateway::class);\n    $u = $this->createMock(Unknown::class);'))]);
  const r = m6Static(c).rules.find((x) => x.rule === 'R-FINAL');
  assert.equal(r.count, 1);
  assert.match(r.evidence[0].snippet, /Mockery::mock\(Tax::class\)/);
});

test('M6 precision: contadores por regla con trials sinteticos y ratios n/a', () => {
  const body = (s) => testFile(['DateTimeImmutable', 'PHPUnit\\Framework\\TestCase'], s);
  const hit = "    $this->assertSame(new DateTimeImmutable('x'), $y);";
  const ok = "    $this->assertEquals(1, 1);";
  const same = 'Failed asserting that two variables reference the same object.';
  const trials = [
    trial(body(hit), { valid: false, failureType: 'TEST_ASSERTION', errorSummary: same }),
    trial(body(hit), { valid: true }),
    trial(body(ok), { valid: false, failureType: 'TEST_ASSERTION', errorSummary: same }),
    trial(body(hit), { valid: false, failureType: 'TEST_RUNTIME', errorSummary: 'TypeError: boom' }),
  ];
  const m6 = m6Static(withTrials(load(), trials));
  const s = m6.precision['R-SAME'];
  assert.equal(s.hitTrials, 3);
  assert.equal(s.hitValid, 1);
  assert.equal(s.hitFailed, 2);
  assert.equal(s.hitFailedWithEvidence, 1);
  assert.equal(s.failedWithEvidence, 2);
  assert.equal(s.precision, round(1 / 3));
  assert.equal(s.sensitivity, round(1 / 2));
  assert.equal(m6.precision['R-NS'].precision, 'n/a');
  assert.equal(m6.precision['R-NS'].sensitivity, 'n/a');
  assert.equal(precisionOf({ hitTrials: 0, hitValid: 0, hitFailed: 0, hitFailedWithEvidence: 0, failedWithEvidence: 0 }).precision, 'n/a');
});

test('M6 precision: agregacion suma contadores crudos entre casos', () => {
  const body = testFile(['DateTimeImmutable', 'PHPUnit\\Framework\\TestCase'], "    $this->assertSame(new DateTimeImmutable('x'), $y);");
  const a = m6Static(withTrials(load(), [trial(body, { valid: false, errorSummary: 'reference the same object' })]));
  const b = m6Static(withTrials(load(), [trial(body, { valid: true })]));
  const agg = aggregateM6Precision([a, b, null]);
  assert.equal(agg['R-SAME'].hitTrials, 2);
  assert.equal(agg['R-SAME'].hitFailedWithEvidence, 1);
  assert.equal(agg['R-SAME'].failedWithEvidence, 1);
  assert.equal(agg['R-SAME'].precision, 0.5);
  assert.equal(aggregateM6Precision([null]), null);
});

// ---- M6 WI-CORE-065: R-ANON-FINAL, R-STATIC-THIS, R-SIG (fixtures sinteticos, clases inventadas) ----
const typeChunk = (fq, content, kind = 'CLASS') => ({
  id: `c-${fq.split('\\').pop()}`, filePath: `src/${fq.split('\\').pop()}.php`, symbolKind: kind, symbolName: fq,
  parentSymbolName: null, importsUsed: [], content, tokenCount: 5,
});
const BASE_CHUNK = typeChunk('Acme\\Billing\\Base', 'class Base {}');
const CONTRACT_CHUNK = typeChunk('Acme\\Billing\\Contract', 'interface Contract {}', 'INTERFACE');
const CTOR_SIG = {
  id: 'c-plan-ctor', filePath: 'src/Billing/Plan.php', symbolKind: 'CONSTRUCTOR', symbolName: '__construct',
  parentSymbolName: 'Acme\\Billing\\Plan', importsUsed: [],
  content: 'public function __construct(public string $code, public float $monthlyPrice) {}', tokenCount: 9,
};
const ruleOf = (m6, name) => m6.rules.find((x) => x.rule === name);
const oneTrial = (uses, body, extra = []) => withTrials(load(), [trial(testFile(uses, body))], extra);

test('M6 R-ANON-FINAL: clase anonima que extiende final (use, FQCN, con argumentos) -> marcada', () => {
  const uses = ['Acme\\Billing\\Plan', 'Acme\\Billing\\Base', 'PHPUnit\\Framework\\TestCase'];
  const body = '    $a = new class extends Plan {};\n    $b = new class(1) extends \\Acme\\Billing\\Plan {};';
  const r = ruleOf(m6Static(oneTrial(uses, body, [PLAN_CHUNK])), 'R-ANON-FINAL');
  assert.equal(r.count, 2);
  assert.equal(r.evidence[0].type, 'Acme\\Billing\\Plan');
});

test('M6 R-ANON-FINAL: clase anonima que extiende no final, implementa interfaz o tipo desconocido -> NO marcada', () => {
  const uses = ['Acme\\Billing\\Base', 'Acme\\Billing\\Contract', 'PHPUnit\\Framework\\TestCase'];
  const body = '    $a = new class extends Base {};\n    $b = new class implements Contract {};\n    $c = new class extends Unknown {};';
  const m6 = m6Static(oneTrial(uses, body, [BASE_CHUNK, CONTRACT_CHUNK, PLAN_CHUNK]));
  assert.equal(ruleOf(m6, 'R-ANON-FINAL').count, 0);
});

test('M6 R-STATIC-THIS: static function con $this-> marcada; static fn con $this-> marcada', () => {
  const body = "    $f = static function () { $this->assertTrue(true); };\n    $g = static fn() => $this->make();";
  const r = ruleOf(m6Static(oneTrial(['PHPUnit\\Framework\\TestCase'], body)), 'R-STATIC-THIS');
  assert.equal(r.count, 2);
  assert.equal(r.evidence[0].line, 6);
  assert.equal(r.evidence[1].line, 7);
});

test('M6 R-STATIC-THIS: closure no static con $this, static sin $this, static fn sin $this y metodo static -> NO marcada', () => {
  const body = "    $a = function () { $this->assertTrue(true); };\n"
    + "    $b = static function () { return 1; };\n"
    + "    $c = static fn($x) => $x + 1;\n"
    + "    $d = static function () { return fn() => 2; };";
  const m6 = m6Static(oneTrial(['PHPUnit\\Framework\\TestCase'], body));
  assert.equal(ruleOf(m6, 'R-STATIC-THIS').count, 0);
  const helper = `<?php\nnamespace Acme\\Tests\\Billing;\nuse PHPUnit\\Framework\\TestCase;\nclass BillingTest extends TestCase {\n`
    + '  public static function helper(): void {\n    $this->assertTrue(true);\n  }\n}';
  assert.equal(ruleOf(m6Static(withTrials(load(), [trial(helper), trial(testFile(['PHPUnit\\Framework\\TestCase'], body))])), 'R-STATIC-THIS').count, 0);
});

test('M6 R-SIG: firma de 2 parametros: new Plan(p, 10.0) no marca; new Plan(monthlyPrice: 10.0) marca', () => {
  const uses = ['Acme\\Billing\\Plan', 'PHPUnit\\Framework\\TestCase'];
  const ok = oneTrial(uses, "    $p = new Plan('p', 10.0);\n    $q = new Plan(code: 'p', monthlyPrice: 10.0);", [CTOR_SIG]);
  assert.equal(ruleOf(m6Static(ok), 'R-SIG').count, 0);
  const bad = oneTrial(uses, '    $p = new Plan(monthlyPrice: 10.0);', [CTOR_SIG]);
  const r = ruleOf(m6Static(bad), 'R-SIG');
  assert.equal(r.count, 1);
  assert.equal(r.evidence[0].line, 7);
  assert.equal(r.evidence[0].reason, 'missing-required');
});

test('M6 R-SIG: parametro con valor por defecto no marca; posicional corto y nombre desconocido si marcan; splat no', () => {
  const uses = ['Acme\\Billing\\Plan', 'PHPUnit\\Framework\\TestCase'];
  const withDefault = { ...CTOR_SIG, content: 'public function __construct(public string $code, public float $monthlyPrice = 0.0) {}' };
  const defaults = oneTrial(uses, "    $a = new Plan(code: 'p');\n    $b = new Plan('p');", [withDefault]);
  assert.equal(ruleOf(m6Static(defaults), 'R-SIG').count, 0);
  const short = oneTrial(uses, "    $a = new Plan('p');\n    $b = new Plan('p', price: 1.0);", [CTOR_SIG]);
  assert.equal(ruleOf(m6Static(short), 'R-SIG').count, 2);
  const unknown = oneTrial(uses, "    $a = new Plan(code: 'p', price: 1.0);", [CTOR_SIG]);
  const ru = ruleOf(m6Static(unknown), 'R-SIG');
  assert.equal(ru.count, 1);
  assert.equal(ru.evidence[0].reason, 'unknown-named');
  const splat = oneTrial(uses, '    $a = new Plan(...$args);', [CTOR_SIG]);
  assert.equal(ruleOf(m6Static(splat), 'R-SIG').count, 0);
});

test('M6 R-SIG: deps.json signatures tiene prioridad; sin firma conocida no marca', () => {
  const uses = ['Acme\\Billing\\Plan', 'PHPUnit\\Framework\\TestCase'];
  const base = oneTrial(uses, '    $p = new Plan(monthlyPrice: 10.0);', []);
  const withDeps = { ...base, deps: { ...base.deps, signatures: [{ fqcn: 'Acme\\Billing\\Plan', signature: '(string $code, float $monthlyPrice)' }] } };
  assert.equal(ruleOf(m6Static(withDeps), 'R-SIG').count, 1);
  const sinFirma = { ...base, deps: { ...base.deps, signatures: [] } };
  assert.equal(ruleOf(m6Static(sinFirma), 'R-SIG').count, 0);
});

test('resolve sanity: REPO_ROOT apunta al repositorio', () => {
  assert.ok(existsSync(resolve(REPO_ROOT, 'AGENTS.md')));
});
