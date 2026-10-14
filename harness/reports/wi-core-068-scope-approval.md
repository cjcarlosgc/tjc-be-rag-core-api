# WI-CORE-068 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-14 · **Autoriza:** Jean, directamente en el chat de Core vía el coordinador (mensaje directo): «un WI de Core que corrija la marca de la sección de dependencias (php-dependency-context.ts) para que los enums digan "usa un caso (Enum::Caso), nunca new" y no contradigan la convención común; solo texto de esa sección del brazo RAG, sin tocar recuperación, ranking, pesos, R-PHP ni targets; prueba rojo→verde con SubscriptionStatus; sin push ni despliegue sin mi orden».

## Evidencia de origen
Verificación nano `.6` (`9ae9980a`, SUB-3 RAG2/RAG3): `new SubscriptionStatus(SubscriptionStatus::CANCELLED)` → «Cannot instantiate enum». La marca genérica de la sección («— final: no se puede mockear; usa una instancia real (new, o un caso si es un enum)») contradice la convención 2 del prompt (no hacer `new` de un enum; usar `Enum::Caso`). La traza marca hoy los enums como `final: true` (`isFinalPhpDeclaration` devuelve true para ENUM).

## Alcance estricto
- SOLO el texto renderizado de la sección para tipos ENUM: «— enum: no se puede mockear ni instanciar con new; usa un caso (Enum::Caso)». Las `final class` conservan su texto, sin mención a enums.
- Distinguir ENUM con el `symbolKind` del chunk de declaración que ya consulta `findPhpTypeDeclarations` (campo interno); la traza sigue exponiendo `final: true` como hoy; sin campo nuevo en traza/DTO/contrato.
- Versión del prompt `php-prompt-2026-10-14.7`; informar tokens extra por caso (≈ 0). No listar los casos del enum.
- Sin cambios en recuperación, ranking, pesos, R-PHP, targets (#4), convenciones (redacción .6), agente ni sección de firmas.
- Pruebas rojo→verde: enum (`SubscriptionStatus`), `final class` con el texto actual, enum + clase en la misma sección, tope de 300 tokens, traza/DTO sin cambios. Medición: M5 idéntico (V1 + verificaciones), M4 por caso, sin regresión de reglas (R-NEW-ENUM). Revisión independiente. Sin push/deploy/DB real.
