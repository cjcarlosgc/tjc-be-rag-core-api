# WI-CORE-065 — cierre
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

- Estado: W-DONE por revisión independiente delegada (Modo fuera de casa), ciclo 1 de 2, APPROVED sin bloqueantes (`harness/reports/wi-core-065-independent-review.md`, rango c7d9436..ef3e24f).
- Entregado: firma del constructor en la sección de dependencias (solo RAG, con tope y truncado), convenciones PHPUnit 4 y 5 en ambos brazos, prompt `php-prompt-2026-10-14.4`, reglas R-ANON-FINAL/R-STATIC-THIS/R-SIG en `harness/calibration`, spec 004. M5 idéntico; M4 +6,6 % a +11,1 %.
- Menores L1–L4 registrados como IDEA-037 en `spec/ideas.md` (no bloqueantes).
- Decisión pendiente de Jean (no aplicada): ampliar la firma a tipos transitivos (p. ej. `Plan` en SUB-1, que no es dependencia directa de `RenewalService`); evidencia en el informe de replay y en L4.
- Las migraciones 20261013100000 y 20261013110000 ya están aplicadas a la base real (según el coordinador); sin migraciones en este WI.
- Sin push, PR ni despliegue. DEC-RAG-001 sigue PENDING; #4 (constructores) no se tocó.
