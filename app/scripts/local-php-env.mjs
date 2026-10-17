#!/usr/bin/env node
// Genera los `.env` locales de los cuatro servicios de RAG Test Studio para probar PHP en local.
//
// Uso (desde tjc-be-rag-core-api/app):
//   node scripts/local-php-env.mjs [--root <carpeta con los 4 repos>] [--podman] [--force]
//
// - Parte de cada `app/.env.example` y alinea los tokens que comparten los servicios
//   (Core↔Sandbox, Core↔GitHub Integration) y las URLs locales.
// - Deja en blanco los secretos externos (Supabase, OpenAI, GitHub App): esos los completa
//   cada desarrollador.
// - Nunca sobrescribe un `.env` existente salvo con `--force`; si ya existe, escribe
//   `.env.local-php` al lado para comparar.
// - `--podman` agrega la configuración de Podman rootless (socket, usuario root, workspace
//   con etiqueta SELinux) al Sandbox.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(option('root', join(scriptDir, '..', '..', '..')));
const podman = flag('podman');
const force = flag('force');

const PORTS = { core: 3000, sandbox: 3001, githubIntegration: 3002, console: 5173 };
const token = () => randomBytes(32).toString('hex');

const shared = {
  sandboxServiceToken: token(),
  coreToGithubIntegrationToken: token(),
  githubIntegrationToCoreToken: token(),
  githubBindingEvidenceSecret: token(),
  githubWebhookSecret: token(),
};

const repos = {
  core: join(root, 'tjc-be-rag-core-api', 'app'),
  sandbox: join(root, 'tjc-be-test-execution-sandbox', 'app'),
  githubIntegration: join(root, 'tjc-be-github-integration-api', 'app'),
  console: join(root, 'tjc-fe-rag-developer-console', 'app'),
};

function readExample(dir) {
  const path = join(dir, '.env.example');
  if (!existsSync(path)) {
    throw new Error(`No existe ${path}. ¿--root apunta a la carpeta con los cuatro repos?`);
  }
  return readFileSync(path, 'utf8');
}

/** Reemplaza `KEY=...` conservando comentarios y orden; agrega al final las claves que falten. */
function applyValues(example, values) {
  const pending = new Map(Object.entries(values));
  const lines = example.split('\n').map((line) => {
    const match = /^([A-Z0-9_]+)=/.exec(line);
    if (!match || !pending.has(match[1])) {
      return line;
    }
    const value = pending.get(match[1]);
    pending.delete(match[1]);
    return `${match[1]}=${value}`;
  });
  if (pending.size > 0) {
    lines.push('', '# Agregado por scripts/local-php-env.mjs');
    for (const [key, value] of pending) {
      lines.push(`${key}=${value}`);
    }
  }
  return lines.join('\n');
}

function supabaseHost(coreExample) {
  const match = /^SUPABASE_URL="?https:\/\/([^"/\s]+)/m.exec(coreExample);
  return match ? match[1] : '';
}

const coreExample = readExample(repos.core);
const storageHost = supabaseHost(coreExample);
const supabaseUrl = storageHost ? `https://${storageHost}` : '';

const values = {
  core: {
    PORT: PORTS.core,
    SANDBOX_URL: `"http://localhost:${PORTS.sandbox}"`,
    SANDBOX_SERVICE_TOKEN: `"${shared.sandboxServiceToken}"`,
    GITHUB_INTEGRATION_API_BASE_URL: `"http://localhost:${PORTS.githubIntegration}"`,
    CORE_TO_GITHUB_INTEGRATION_TOKEN: `"${shared.coreToGithubIntegrationToken}"`,
    GITHUB_INTEGRATION_TO_CORE_TOKEN: `"${shared.githubIntegrationToCoreToken}"`,
    GITHUB_BINDING_EVIDENCE_SECRET: `"${shared.githubBindingEvidenceSecret}"`,
    CONSOLE_BASE_URL: `"http://localhost:${PORTS.console}"`,
  },
  sandbox: {
    PORT: PORTS.sandbox,
    SANDBOX_SERVICE_TOKEN: shared.sandboxServiceToken,
    SANDBOX_ALLOWED_DOWNLOAD_HOSTS: storageHost,
    ...(podman
      ? {
          SANDBOX_DOCKER_SOCKET_PATH: `/run/user/${userInfo().uid}/podman/podman.sock`,
          SANDBOX_CONTAINER_USER: 'root',
          SANDBOX_WORKSPACE_ROOT: join(homedir(), '.cache', 'tjc-sandbox-workspaces'),
        }
      : {}),
  },
  githubIntegration: {
    PORT: PORTS.githubIntegration,
    CONSOLE_CORS_ORIGINS: `http://localhost:${PORTS.console}`,
    CORE_API_BASE_URL: `http://localhost:${PORTS.core}`,
    CORE_TO_GITHUB_INTEGRATION_TOKEN: shared.coreToGithubIntegrationToken,
    GITHUB_INTEGRATION_TO_CORE_TOKEN: shared.githubIntegrationToCoreToken,
    GITHUB_WEBHOOK_SECRET: shared.githubWebhookSecret,
  },
  console: {
    VITE_CORE_API_URL: `http://localhost:${PORTS.core}`,
    VITE_GITHUB_INTEGRATION_API_URL: `http://localhost:${PORTS.githubIntegration}`,
    VITE_DATA_SOURCE: 'live',
    VITE_AUTH_MODE: 'supabase',
    VITE_SUPABASE_URL: supabaseUrl,
  },
};

const written = [];
for (const [name, dir] of Object.entries(repos)) {
  const content = applyValues(name === 'core' ? coreExample : readExample(dir), values[name]);
  const envPath = join(dir, '.env');
  const target = existsSync(envPath) && !force ? join(dir, '.env.local-php') : envPath;
  writeFileSync(target, content, { encoding: 'utf8', mode: 0o600 });
  written.push(target);
}

console.log('Archivos generados:');
for (const path of written) {
  console.log(`  ${path}`);
}
console.log(`
Completa a mano los secretos externos (no se generan):
  Core:               DATABASE_URL (contraseña), SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, OPENAI_API_KEY
  GitHub Integration: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_BASE64
  Console:            VITE_SUPABASE_ANON_KEY

Configura en la GitHub App:
  Webhook URL:    https://<tu-túnel>/integrations/github/webhooks
  Webhook secret: ${shared.githubWebhookSecret}
  (el mismo valor quedó en GITHUB_WEBHOOK_SECRET de GitHub Integration)
`);
if (written.some((path) => path.endsWith('.env.local-php'))) {
  console.log('Algún .env ya existía: se escribió .env.local-php al lado. Revísalo y renómbralo (o usa --force).');
}
if (podman) {
  console.log(`Podman: crea y etiqueta la raíz de workspaces del Sandbox:
  mkdir -p ${values.sandbox.SANDBOX_WORKSPACE_ROOT} && chcon -t container_file_t ${values.sandbox.SANDBOX_WORKSPACE_ROOT}`);
}
