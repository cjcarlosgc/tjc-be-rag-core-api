// WI-CORE-094: verificación de hashes persistidos frente a los recalculados (coincide, no coincide, no verificable).
import { describe, expect, it } from 'vitest';
import {
  VERDICT,
  artifactHashCheck,
  canonicalJsonHashCheck,
  countVerdicts,
  promptHashCheck,
  storageHashCheck,
  testContentHashCheck,
} from './hashes.mjs';
import { canonicalJson, sha256Hex } from './util.mjs';

const SHA_OF = (text: string) => sha256Hex(Buffer.from(text, 'utf8'));

describe('testContentHashCheck', () => {
  it('coincide cuando el texto persistido reproduce el hash (sin truncado)', () => {
    const text = 'class MoneyTest {}\n';
    const check = testContentHashCheck({ testContent: text, testContentSha256: SHA_OF(text), testContentTruncated: false });
    expect(check.verdict).toBe(VERDICT.MATCH);
    expect(check.recalculated).toBe(SHA_OF(text));
  });

  it('no coincide cuando el texto persistido fue alterado', () => {
    const check = testContentHashCheck({ testContent: 'x', testContentSha256: SHA_OF('y'), testContentTruncated: false });
    expect(check.verdict).toBe(VERDICT.MISMATCH);
  });

  it('es no verificable cuando el contenido está truncado: el hash cubre el texto completo', () => {
    const check = testContentHashCheck({ testContent: 'prefijo', testContentSha256: SHA_OF('prefijo y más'), testContentTruncated: true });
    expect(check.verdict).toBe(VERDICT.UNVERIFIABLE);
    expect(check.reason).toMatch(/truncado/);
  });

  it('es no verificable sin contenido o sin hash persistido', () => {
    expect(testContentHashCheck({ testContent: null, testContentSha256: null, testContentTruncated: false }).verdict).toBe(VERDICT.UNVERIFIABLE);
    expect(testContentHashCheck({ testContent: 'a', testContentSha256: null, testContentTruncated: false }).verdict).toBe(VERDICT.UNVERIFIABLE);
  });

  it('el texto con NUL persistido ya viene sin NUL y su hash se verifica sobre los bytes de la base', () => {
    const cleaned = 'ab';
    const check = testContentHashCheck({ testContent: cleaned, testContentSha256: SHA_OF(cleaned), testContentTruncated: false });
    expect(check.verdict).toBe(VERDICT.MATCH);
  });
});

describe('artifactHashCheck', () => {
  it('compara con el contenido enviado al Sandbox y explica la diferencia por NUL', () => {
    const withNul = 'a\u0000b';
    const check = artifactHashCheck(
      { artifactHash: SHA_OF(withNul) },
      { testContent: 'ab', testContentSha256: SHA_OF('ab'), testContentTruncated: false },
    );
    expect(check.verdict).toBe(VERDICT.MISMATCH);
    expect(check.note).toMatch(/NUL/);
  });

  it('coincide cuando no había NUL', () => {
    const text = 'ok';
    const check = artifactHashCheck({ artifactHash: SHA_OF(text) }, { testContent: text, testContentSha256: SHA_OF(text), testContentTruncated: false });
    expect(check.verdict).toBe(VERDICT.MATCH);
  });

  it('es no verificable sin artefacto o con contenido truncado', () => {
    expect(artifactHashCheck({ artifactHash: null }, null).verdict).toBe(VERDICT.UNVERIFIABLE);
    expect(
      artifactHashCheck({ artifactHash: SHA_OF('x') }, { testContent: 'x', testContentSha256: null, testContentTruncated: true }).verdict,
    ).toBe(VERDICT.UNVERIFIABLE);
  });
});

describe('canonicalJsonHashCheck', () => {
  it('recalcula el hash del JSON canónico, sin depender del orden de las claves', () => {
    const value = { b: 2, a: { z: 1, y: [1, { q: 'x', p: null }] } };
    const persisted = SHA_OF(canonicalJson({ a: { y: [1, { p: null, q: 'x' }], z: 1 }, b: 2 }));
    expect(canonicalJsonHashCheck('runnerReportSha256', persisted, value).verdict).toBe(VERDICT.MATCH);
  });

  it('no coincide si el valor cambió', () => {
    const persisted = SHA_OF(canonicalJson({ a: 1 }));
    expect(canonicalJsonHashCheck('sandboxEvidenceSha256', persisted, { a: 2 }).verdict).toBe(VERDICT.MISMATCH);
  });

  it('es no verificable sin valor', () => {
    expect(canonicalJsonHashCheck('runnerReportSha256', SHA_OF('x'), null).verdict).toBe(VERDICT.UNVERIFIABLE);
  });
});

describe('storageHashCheck y promptHashCheck', () => {
  it('verifica el contenido descargado y declara el motivo cuando no hay descarga', () => {
    const bytes = Buffer.from('<?php', 'utf8');
    expect(storageHashCheck(SHA_OF('<?php'), { ok: true, bytes }).verdict).toBe(VERDICT.MATCH);
    const missing = storageHashCheck(SHA_OF('<?php'), { ok: false, reason: 'not_found' });
    expect(missing.verdict).toBe(VERDICT.UNVERIFIABLE);
    expect(missing.reason).toMatch(/not_found/);
  });

  it('el prompt nunca se verifica: solo se persiste su hash', () => {
    const check = promptHashCheck(SHA_OF('prompt'));
    expect(check.verdict).toBe(VERDICT.UNVERIFIABLE);
    expect(check.reason).toMatch(/no se persiste/);
  });
});

describe('countVerdicts', () => {
  it('agrega los veredictos', () => {
    const counts = countVerdicts([
      { verdict: VERDICT.MATCH },
      { verdict: VERDICT.MATCH },
      { verdict: VERDICT.MISMATCH },
      { verdict: VERDICT.UNVERIFIABLE },
    ]);
    expect(counts).toEqual({ coincide: 2, 'no coincide': 1, 'no verificable': 1 });
  });
});
