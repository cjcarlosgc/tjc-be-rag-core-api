# Verificación final de contratos — WI-CORE-015

**Fuente canónica:** Core, revisión `c96e9ad3c58a65914e234974f342b83415a50286`.

Los tres contratos se compararon byte a byte entre Core, Console y GitHub Integration:

| Contrato | SHA-256 en los tres repositorios |
| --- | --- |
| `system-contract.md` (SYSTEM-2.5) | `879bce741d4cf5246dd30db62759cd3100804019e608e62a9028bc2e33fa487c` |
| `interoperability-contract.md` (INTEROP-2.6) | `1f5cc04a7fc73388a49d1c1de4f79f873d0e95edec7db6e102b5f828f6a2f852` |
| `github-integration-contract.md` (GH-INTEROP-1.2) | `1092ef36979f4fac7f17d6ee73c5b73723d0aaf1999b24d6098b095af5d62c45` |

Los Contract Sync `CS-CORE-20260927-004`, `005` y `006` están `C-RESOLVED` en los inbox de Console y GitHub Integration. No se cambió semántica ni versionado contractual; deploy y cutover siguen pendientes de autorización.
