# RAG Core API — servicio

Servicio NestJS + TypeScript (pnpm, Prisma, PostgreSQL + pgvector). La fuente de verdad funcional vive en `../spec/` y el estado del trabajo en `../harness/`; este archivo solo explica cómo correr el código, incluido el entorno local completo para probar proyectos PHP.

## Comandos del servicio

```bash
pnpm install          # también corre prisma generate
pnpm run start:dev    # desarrollo con watch (puerto PORT, por defecto 3000)
pnpm run build && pnpm run start:prod
pnpm run lint         # oxlint
pnpm run test         # unit tests (vitest)
pnpm run test:e2e     # e2e
pnpm run prisma:deploy  # aplica las migraciones a DATABASE_URL
```

## Entorno local completo para probar PHP

Un PR en un repositorio PHP vinculado recorre los cuatro servicios:

```text
GitHub ──webhook──▶ túnel HTTPS ──▶ GitHub Integration (3002) ──▶ RAG Core (3000) ──▶ Sandbox (3001)
                                                                       ▲
                                                Developer Console (5173)
```

### 1. Ramas

| Repositorio | Rama |
|---|---|
| `tjc-be-rag-core-api` | `feature/php-core` (incluye todo `feature/jean`) |
| `tjc-be-test-execution-sandbox` | `feature/php-profile` |
| `tjc-be-github-integration-api` | `feature/jean` |
| `tjc-fe-rag-developer-console` | `feature/jean` |

Clona los cuatro en la misma carpeta (los scripts asumen que son hermanos).

### 2. Requisitos

- Node 22 con corepack (`corepack enable`) y pnpm.
- Docker Desktop (macOS) o Docker Engine; en Linux sirve Podman rootless con el socket activo (`systemctl --user enable --now podman.socket`).
- Un túnel HTTPS para recibir webhooks, por ejemplo `cloudflared tunnel --url http://localhost:3002` o `ngrok http 3002`.
- Credenciales: Supabase (contraseña de la base, publishable key, secret key, anon key), una API key de OpenAI y una GitHub App con su clave privada.

### 3. Generar los `.env`

Desde `tjc-be-rag-core-api/app`:

```bash
node scripts/local-php-env.mjs            # Docker Desktop
node scripts/local-php-env.mjs --podman   # Podman rootless en Linux
```

El script parte de cada `app/.env.example`, genera los tokens que comparten los servicios (Core↔Sandbox y Core↔GitHub Integration) y fija las URLs y los puertos locales. No sobrescribe un `.env` existente: en ese caso deja `.env.local-php` al lado (`--force` para sobrescribir). Al terminar imprime qué secretos externos faltan y el webhook secret que debes configurar en la GitHub App.

### 4. Base de datos propia (importante si dos personas prueban a la vez)

Core procesa sus trabajos con una cola en PostgreSQL. Si dos instancias de Core apuntan a la misma base, cada una puede tomar trabajos de la otra. Para probar en paralelo, cada persona usa su propio Postgres local; Storage y Auth siguen en Supabase.

```bash
docker compose up -d        # pgvector en localhost:5433 (usuario/clave/base: rag_core)
# en app/.env:
# DATABASE_URL="postgresql://rag_core:rag_core@localhost:5433/rag_core?schema=public"
pnpm run prisma:deploy
```

Con la base compartida de Supabase solo debe haber una instancia de Core corriendo a la vez.

### 5. GitHub App

Cada persona necesita una App propia o turnarse con la misma, porque una App tiene una sola URL de webhook.

- Webhook URL: `https://<tu-túnel>/integrations/github/webhooks`.
- Webhook secret: el que imprimió el script (queda en `GITHUB_WEBHOOK_SECRET` de GitHub Integration).
- Permisos: metadata, contents y pull requests en lectura; checks en escritura; contents y pull requests en escritura solo para publicar tests.
- Eventos: `Pull request`, `Installation` e `Installation repositories`.
- En GitHub Integration: `GITHUB_APP_ID` y `GITHUB_APP_PRIVATE_KEY_BASE64` (`base64 -w0 private-key.pem`).
- Instala la App en los repositorios que vas a probar.

### 6. Arrancar

En este orden, cada uno en su terminal:

```bash
# Sandbox
cd tjc-be-test-execution-sandbox/app && pnpm install && pnpm run start:dev
# Core
cd tjc-be-rag-core-api/app && pnpm install && pnpm run start:dev
# GitHub Integration
cd tjc-be-github-integration-api/app && pnpm install --frozen-lockfile && pnpm run start:dev
# Console
cd tjc-fe-rag-developer-console/app && pnpm install && pnpm run dev
# Túnel
cloudflared tunnel --url http://localhost:3002
```

Comprobaciones: `curl localhost:3001/health/ready` (Sandbox: Docker, workspace y descargas) y `curl localhost:3002/health` (GitHub Integration configurado).

La primera ejecución PHP del Sandbox construye la imagen `tjc-sandbox-php:8.3` (PHP 8.3 + Composer); tarda unos minutos una sola vez.

### 7. Probar con los repositorios piloto PHP

Los repositorios `jcmc-pe/tjc-pilot-sales-discounts`, `tjc-pilot-reservations` y `tjc-pilot-subscriptions` (Laravel 12, PHPUnit 11) tienen la base en `develop` y los cambios a analizar en una rama `feature/*`:

1. En la Console, crea un Project y vincula el repositorio con `integrationBranch = develop`.
2. Abre un PR de la rama `feature/*` hacia `develop` (`feature/order-pricing`, `feature/booking-rules` o `feature/renewals`).
3. Core crea un AnalysisRun para el HEAD del PR. Si un método cambiado tiene condiciones, `throw` o escrituras de estado sin regla funcional vigente, el Run queda en `ACTION_REQUIRED` y la pregunta aparece en la Console; respóndela con un usuario Maintainer o Admin.
4. Con el contexto completo, Core genera el test PHPUnit en `tests/Unit/...Test.php`, lo ejecuta en el Sandbox y publica el Check en el PR.

Los oráculos del piloto no viven en los repositorios: ningún brazo del experimento debe poder leerlos.

### Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| Sandbox: `EACCES` sobre `/app` o falla `pnpm install` en Linux | Podman rootless con usuario no root: `SANDBOX_CONTAINER_USER=root`. |
| Sandbox: `Permission denied` al montar el workspace | SELinux: `chcon -t container_file_t <SANDBOX_WORKSPACE_ROOT>`. |
| Sandbox: `INPUT_DOWNLOAD_FAILED ... host not allowed` | `SANDBOX_ALLOWED_DOWNLOAD_HOSTS` debe contener el host de Supabase Storage. |
| `IMAGE_UNAVAILABLE` en la primera ejecución PHP | Sin red o sin espacio en disco para construir la imagen; reintenta. |
| El PR no crea ningún Run | El webhook no llega: revisa la URL del túnel, el secret, que la App esté instalada en el repo y que la base del PR sea la `integrationBranch`. |
| Un Run tuyo lo procesó otra instancia | Dos Cores sobre la misma base: usa tu Postgres local (paso 4). |
