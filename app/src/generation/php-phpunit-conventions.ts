/**
 * Convenciones PHPUnit compartidas por el brazo RAG (`PromptBuilder.buildPhp`) y por las
 * instrucciones PHP del agente generalista (`ExperimentJobHandler`). Una sola fuente para
 * que ambos brazos reciban la misma redacción (WI-CORE-064, Fase 3 A).
 */

/** Versión declarada de la plantilla del prompt PHP con estas convenciones. */
export const PHP_PROMPT_CONVENTIONS_VERSION = 'php-prompt-2026-10-14.7';

/** Líneas de convención; cada una es una sección propia del prompt. */
export const PHP_PHPUNIT_CONVENTION_LINES: readonly string[] = [
  'PHPUnit: compara objetos de valor (p. ej. `DateTimeImmutable`) con `assertEquals`; usa `assertSame` solo para escalares o identidad del mismo objeto.',
  'No uses `createMock`/`createStub`/`getMockBuilder` con clases `final` ni enums, ni hagas `new` de un enum: instancia las clases `final` con `new` y usa un caso del enum (`Enum::Caso`); crea dobles solo de interfaces o clases no `final`.',
  'En los `use` pon solo FQCN presentes en el código y el contexto disponibles (si hay una sección de dependencias, también los de ella); no inventes namespaces.',
  'No uses una clase `final` en `extends` ni en `implements`, tampoco en clases anónimas (`new class extends|implements X`): usa una instancia real con `new` (o una implementación de su interfaz si X es interfaz).',
  'No declares `static` los closures que usan `$this->assert…` o `$this->callback(...)`: sin `$this` fallan en tiempo de ejecución.',
];
