# Verificación SDD — WI-CORE-014

- WI/ST/HU: WI-CORE-014 / ST-CORE-021 / HU02, HU14.
- Core es el propietario canónico de GH-INTEROP; GH y Console mantienen espejos byte por byte.
- Cambio aprobado: contrato GH-INTEROP-1.2; el webhook PR transmite pullRequest.createdAt como timestamp ISO-8601 original o null. receivedAt conserva la hora de recepción.
- La lectura histórica pull-request-head devuelve createdAt original solo si es verificable; fecha ausente, inválida o ambigua responde UNVERIFIABLE sin valor parcial.
- El comportamiento Core aprobado mantiene ocultos los Runs cuya fecha no se puede verificar mientras realiza recuperación durable; no se comparte payload GitHub crudo.
- El cambio no modifica INTEROP-2.6, rutas públicas, Console UI, Sandbox ni configuración externa.
- Contract Sync start: cero eventos relevantes pendientes. CS-20260920-001 y CS-20260921-003 están clasificados NOT_RELEVANT solo para este WI con digest y reporte.
- DEC-INF-001, DEC-VAL-001 y DEC-EXP-FK-001 no bloquean la publicación de este contrato; ninguna decisión pending alcanza el alcance.
- Resultado: SDD verificado, sin bloqueos; puede implementarse el cambio documental aprobado y solicitar revisión contractual.
