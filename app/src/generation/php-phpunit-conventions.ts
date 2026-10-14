/**
 * Convenciones PHPUnit compartidas por el brazo RAG (`PromptBuilder.buildPhp`) y por las
 * instrucciones PHP del agente generalista (`ExperimentJobHandler`). Una sola fuente para
 * que ambos brazos reciban la misma redacción (WI-CORE-064, Fase 3 A).
 */

/** Versión declarada de la plantilla del prompt PHP con estas convenciones. */
export const PHP_PROMPT_CONVENTIONS_VERSION = 'php-prompt-2026-10-14.2';

/** Líneas de convención; cada una es una sección propia del prompt. */
export const PHP_PHPUNIT_CONVENTION_LINES: readonly string[] = [
  'PHPUnit: compara objetos de valor (p. ej. `DateTimeImmutable`) con `assertEquals`; usa `assertSame` solo para escalares o identidad del mismo objeto.',
  'No uses `createMock`/`createStub`/`getMockBuilder` con clases `final` ni enums: instáncialas con `new`; crea dobles solo de interfaces o clases no `final`.',
  'En los `use` pon solo FQCN presentes en el código y el contexto disponibles (incl. «Dependencias del código objetivo»); no inventes namespaces.',
];
