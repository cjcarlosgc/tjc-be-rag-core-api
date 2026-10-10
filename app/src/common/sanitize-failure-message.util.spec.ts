import { describe, expect, it } from 'vitest';
import {
  FAILURE_MESSAGE_MAX_LENGTH,
  FAILURE_MESSAGE_SCAN_MAX_LENGTH,
  sanitizeFailureMessage,
} from './sanitize-failure-message.util.js';

/** Parte final de la clave de ejemplo pública de Stripe; el prefijo se concatena para no disparar escáneres de secretos. */
const STRIPE_SAMPLE = '4eC39HqLyjWDarjtT1zdp7dc';

describe('sanitizeFailureMessage (WI-CORE-007)', () => {
  it('devuelve idéntico un mensaje sin secretos, sin control y dentro del límite', () => {
    const message = 'Expected 2 to be 3 in src/sum.spec.ts';
    expect(sanitizeFailureMessage(message)).toBe(message);
  });

  it('redacta el valor de Authorization conservando la clave, también con esquema', () => {
    expect(sanitizeFailureMessage('Authorization: Bearer abc.def-123')).toBe(
      'Authorization: [REDACTED]',
    );
    expect(sanitizeFailureMessage('authorization=Basic dXNlcjpwYXNz')).toBe(
      'authorization=[REDACTED]',
    );
  });

  it('redacta Bearer suelto', () => {
    expect(sanitizeFailureMessage('request rejected, Bearer abc123def456')).toBe(
      'request rejected, Bearer [REDACTED]',
    );
  });

  it('redacta JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl';
    expect(sanitizeFailureMessage(`token ${jwt} rejected`)).toBe(
      'token [REDACTED] rejected',
    );
  });

  it('redacta claves tipo sk- (OpenAI)', () => {
    expect(sanitizeFailureMessage('invalid key sk-proj-AbC123_xyz9')).toBe(
      'invalid key [REDACTED]',
    );
  });

  it('redacta tokens de GitHub (ghp_, gho_, ghs_, github_pat_)', () => {
    expect(sanitizeFailureMessage('ghp_0123456789abcdefABCDEF')).toBe('[REDACTED]');
    expect(sanitizeFailureMessage('gho_0123456789abcdefABCDEF')).toBe('[REDACTED]');
    expect(sanitizeFailureMessage('ghs_0123456789abcdefABCDEF')).toBe('[REDACTED]');
    expect(sanitizeFailureMessage('github_pat_11ABCDEFG_0123456789abcdef')).toBe(
      '[REDACTED]',
    );
  });

  it('redacta claves de acceso de AWS (AKIA)', () => {
    expect(sanitizeFailureMessage('key AKIAIOSFODNN7EXAMPLE used')).toBe(
      'key [REDACTED] used',
    );
  });

  it('redacta bloques de clave privada PEM completos', () => {
    const message =
      'load failed -----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY----- end';
    const sanitized = sanitizeFailureMessage(message);
    expect(sanitized).toBe('load failed [REDACTED] end');
    expect(sanitized).not.toContain('MIIEpAIBAAKCAQEA');
  });

  it('redacta valores de variables sensibles (PASSWORD, SECRET, TOKEN, KEY)', () => {
    expect(
      sanitizeFailureMessage('DATABASE_PASSWORD=hunter2 SECRET_TOKEN: xyz API_KEY=abc123'),
    ).toBe('DATABASE_PASSWORD=[REDACTED] SECRET_TOKEN: [REDACTED] API_KEY=[REDACTED]');
  });

  it('redacta el valor de una clave JSON sensible', () => {
    expect(sanitizeFailureMessage('{"password":"abc def","user":"ana"}')).toBe(
      '{"password":[REDACTED],"user":"ana"}',
    );
  });

  it('quita las credenciales user:pass@ de una URL', () => {
    expect(sanitizeFailureMessage('clone https://user:pass@example.com/repo.git failed')).toBe(
      'clone https://[REDACTED]@example.com/repo.git failed',
    );
  });

  it('quita query y fragmento de una URL firmada', () => {
    expect(
      sanitizeFailureMessage(
        'GET https://bucket.example.com/obj.zip?X-Amz-Signature=abc&X-Amz-Credential=def#frag failed',
      ),
    ).toBe('GET https://bucket.example.com/obj.zip failed');
  });

  it('quita el token que viaja en la query de una URL', () => {
    expect(sanitizeFailureMessage('https://api.example.com/v1/run?token=zzz')).toBe(
      'https://api.example.com/v1/run',
    );
  });

  it('elimina caracteres de control y convierte saltos en espacio', () => {
    expect(sanitizeFailureMessage('line one\nline two\u0007\tend')).toBe(
      'line one line two end',
    );
  });

  it('trunca a 500 caracteres cuando no hay secretos', () => {
    const sanitized = sanitizeFailureMessage('a'.repeat(900));
    expect(sanitized).toHaveLength(FAILURE_MESSAGE_MAX_LENGTH);
    expect(sanitized).toBe('a'.repeat(FAILURE_MESSAGE_MAX_LENGTH));
  });

  it('redacta antes de truncar: un secreto que cruza el límite no deja fragmento', () => {
    // El token empieza en la posición 495; si se truncara primero quedaría "sk-B…" sin redactar.
    const sanitized = sanitizeFailureMessage(`${'x'.repeat(495)} sk-${'B'.repeat(30)}`);
    expect(sanitized.length).toBeLessThanOrEqual(FAILURE_MESSAGE_MAX_LENGTH);
    expect(sanitized).not.toContain('sk-');
    expect(sanitized).not.toContain('BBBB');
  });

  it('es idempotente, incluso cuando el truncado corta un marcador', () => {
    const samples = [
      'Authorization: Bearer abc.def-123 and ghp_0123456789abcdefABCDEF',
      // El límite cae justo tras "password=[": el marcador queda cortado y no debe re-redactarse.
      `${'x'.repeat(489)} password=hunter2`,
      `${'y'.repeat(494)} https://u:p@h.example/a?sig=1`,
      'a'.repeat(900),
    ];
    for (const sample of samples) {
      const once = sanitizeFailureMessage(sample);
      expect(sanitizeFailureMessage(once)).toBe(once);
    }
    expect(sanitizeFailureMessage(`${'x'.repeat(489)} password=hunter2`)).toMatch(
      /password=\[$/,
    );
  });
});

/**
 * Regresiones de la revisión independiente de WI-CORE-007 (ciclo 1). Cada caso del informe tiene su prueba;
 * las coberturas que ya funcionaban se fijan también para no regresar.
 */
describe('sanitizeFailureMessage regresiones del ciclo 1 de revisión (WI-CORE-007)', () => {
  const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function timedSanitize(input: string): { output: string; elapsedMs: number } {
    const started = performance.now();
    const output = sanitizeFailureMessage(input);
    return { output, elapsedMs: performance.now() - started };
  }

  describe('1. rendimiento: el coste queda acotado con entradas largas', () => {
    it('sanea 100 000 caracteres de guiones en menos de 250 ms', () => {
      const { output, elapsedMs } = timedSanitize('a-'.repeat(50000));
      expect(elapsedMs).toBeLessThan(250);
      expect(output).toHaveLength(FAILURE_MESSAGE_MAX_LENGTH);
    });

    it('sanea un blob base64url de 200 000 caracteres en menos de 250 ms', () => {
      const blob = Array.from({ length: 200000 }, (_, i) => B64URL[(i * 7919) % 64]).join('');
      const { output, elapsedMs } = timedSanitize(blob);
      expect(elapsedMs).toBeLessThan(250);
      expect(output).toHaveLength(FAILURE_MESSAGE_MAX_LENGTH);
    });

    it('sanea repeticiones de pares sensibles y de comillas sin degradarse', () => {
      const { elapsedMs: keys } = timedSanitize('token: '.repeat(3000));
      const { elapsedMs: quotes } = timedSanitize('password="'.repeat(3000));
      expect(keys).toBeLessThan(250);
      expect(quotes).toBeLessThan(250);
    });

    it('acota la entrada: un secreto más allá del tope no aparece en la salida', () => {
      const message = `${'x'.repeat(FAILURE_MESSAGE_SCAN_MAX_LENGTH + 4000)} password=hunter2`;
      const sanitized = sanitizeFailureMessage(message);
      expect(sanitized).toBe('x'.repeat(FAILURE_MESSAGE_MAX_LENGTH));
      expect(sanitized).not.toContain('hunter');
    });

    it('el tope no deja un fragmento de token cortado a mitad (regresión del ciclo 1)', () => {
      // El tope cae tras "ghp_01": sin descartar el último token quedaría "ghp_01" visible.
      const message = `Bearer ${'A'.repeat(16370)} ghp_0123456789abcdefABCDEF`;
      const sanitized = sanitizeFailureMessage(message);
      expect(sanitized).toBe('Bearer [REDACTED]');
      expect(sanitized).not.toContain('ghp_');
    });
  });

  describe('2a. valores entre corchetes y listas JSON sensibles', () => {
    it.each([
      ['password=[hunter2]', 'password=[REDACTED]'],
      ['token=[abc123def456]', 'token=[REDACTED]'],
      ['{"password":["hunter2","other"]}', '{"password":[REDACTED]}'],
      ['{"token":["a]b","c"]}', '{"token":[REDACTED]}'],
    ])('redacta %s', (input, expected) => {
      const sanitized = sanitizeFailureMessage(input);
      expect(sanitized).toBe(expected);
      expect(sanitized).not.toMatch(/hunter2|abc123|other|"c"/);
      expect(sanitizeFailureMessage(sanitized)).toBe(sanitized);
    });

    it('deja intacto el marcador literal [REDACTED] (idempotencia)', () => {
      expect(sanitizeFailureMessage('password=[REDACTED]')).toBe('password=[REDACTED]');
    });
  });

  describe('2b. credenciales de URL con @ o / dentro de la clave', () => {
    it('no deja fragmento de una clave que contiene @', () => {
      const sanitized = sanitizeFailureMessage('git clone https://user:p@ssw0rd@github.com/o/r');
      expect(sanitized).toBe('git clone https://[REDACTED]@github.com/o/r');
      expect(sanitized).not.toContain('ssw0rd');
    });

    it('no deja la clave cuando contiene /', () => {
      const sanitized = sanitizeFailureMessage('https://user:pa/ss1234@host/x');
      expect(sanitized).toBe('https://[REDACTED]@host/x');
      expect(sanitized).not.toContain('ss1234');
      expect(sanitized).not.toContain('user');
    });

    it('oculta el usuario cuando el valor de un par contiene una URL con credenciales', () => {
      const sanitized = sanitizeFailureMessage('token=https://u:a=b@h.example/p');
      expect(sanitized).not.toContain('u:a');
      expect(sanitized).toBe('token=[REDACTED]');
    });

    it('sigue quitando usuario y clave simples y la query de una URL firmada', () => {
      expect(sanitizeFailureMessage('https://user:pass@example.com/repo.git')).toBe(
        'https://[REDACTED]@example.com/repo.git',
      );
      expect(sanitizeFailureMessage('https://h.example/o.zip?X-Amz-Signature=abc#frag')).toBe(
        'https://h.example/o.zip',
      );
    });
  });

  describe('2c. comillas escapadas y valores entre comillas sin cierre', () => {
    it('redacta el valor completo cuando contiene una comilla escapada', () => {
      const sanitized = sanitizeFailureMessage('password="ab\\"cd efgh"');
      expect(sanitized).toBe('password=[REDACTED]');
      expect(sanitized).not.toContain('cd efgh');
    });

    it('redacta un valor entre comillas simples con espacios', () => {
      expect(sanitizeFailureMessage("password='abc def' fin")).toBe('password=[REDACTED] fin');
    });

    it('redacta un valor entre comillas sin cierre hasta el final', () => {
      const sanitized = sanitizeFailureMessage('password="abc def');
      expect(sanitized).toBe('password=[REDACTED]');
      expect(sanitized).not.toContain('abc');
    });
  });

  describe('3. bloques PEM sin distinguir mayúsculas y bloques PGP', () => {
    it('redacta un bloque PEM en minúsculas', () => {
      const sanitized = sanitizeFailureMessage(
        'x -----begin private key-----\nMIIEabc\n-----end private key----- y',
      );
      expect(sanitized).toBe('x [REDACTED] y');
    });

    it('redacta un bloque PGP PRIVATE KEY BLOCK', () => {
      const sanitized = sanitizeFailureMessage(
        '-----BEGIN PGP PRIVATE KEY BLOCK-----\nlQOYBGabc\n-----END PGP PRIVATE KEY BLOCK-----',
      );
      expect(sanitized).toBe('[REDACTED]');
      expect(sanitized).not.toContain('lQOYBG');
    });
  });

  describe('cobertura previa que no debe regresar', () => {
    it.each([
      ['Bearer en mayúsculas', 'AUTH BEARER abc.def-123', 'AUTH Bearer [REDACTED]'],
      ['bearer en minúsculas', 'auth bearer abc.def-123', 'auth Bearer [REDACTED]'],
      ['ASIA', 'key ASIAIOSFODNN7EXAMPLE used', 'key [REDACTED] used'],
      ['OPENSSH PEM', 'a -----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbn\n-----END OPENSSH PRIVATE KEY----- b', 'a [REDACTED] b'],
      ['ENCRYPTED PEM', 'a -----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIFH\n-----END ENCRYPTED PRIVATE KEY----- b', 'a [REDACTED] b'],
      ['PEM sin cierre', 'key -----BEGIN RSA PRIVATE KEY-----\nMIIEabc', 'key [REDACTED]'],
      ['password=', 'password=a1', 'password=[REDACTED]'],
      ['token:', 'token: a1', 'token: [REDACTED]'],
      ['secret=', 'secret=a1', 'secret=[REDACTED]'],
      ['apikey=', 'apikey=a1', 'apikey=[REDACTED]'],
      ['api_key=', 'api_key=a1', 'api_key=[REDACTED]'],
      ['api-key=', 'api-key=a1', 'api-key=[REDACTED]'],
      ['x-api-key:', 'x-api-key: a1', 'x-api-key: [REDACTED]'],
      ['api_key JSON', '{"api_key":"a1"}', '{"api_key":[REDACTED]}'],
      ['OPENAI_API_KEY=', 'OPENAI_API_KEY=a1', 'OPENAI_API_KEY=[REDACTED]'],
      ['sk- suelto', 'key sk-abcdefgh1234 fin', 'key [REDACTED] fin'],
      ['URL con userinfo', 'https://user:pass@h.example/p', 'https://[REDACTED]@h.example/p'],
      ['query y fragmento firmados', 'https://h.example/o?sig=1#f', 'https://h.example/o'],
      ['saltos \\n, \\r\\n y tabulador', 'token=a1\r\nsecret=b2\tfin', 'token=[REDACTED]  secret=[REDACTED] fin'],
      ['Unicode junto a un par', 'пароль123 password=hunter2', 'пароль123 password=[REDACTED]'],
      ['NUL embebido', 'pass\u0000word=hunter2', 'password=[REDACTED]'],
    ])('%s', (_name, input, expected) => {
      const sanitized = sanitizeFailureMessage(input);
      expect(sanitized).toBe(expected);
      expect(sanitizeFailureMessage(sanitized)).toBe(sanitized);
    });
  });

  describe('redacción antes de truncar en todas las posiciones de corte', () => {
    // Cada familia se coloca en cada posición 0..499 para que el límite de 500 caiga en cualquier punto
    // del secreto. La prueba exige: sin fragmento del valor, longitud <= 500 e idempotencia.
    const FAMILIES: ReadonlyArray<{ name: string; secret: string; forbidden: string[] }> = [
      { name: 'Authorization Bearer', secret: 'Authorization: Bearer Zq9Wx7Vb2Mn4', forbidden: ['Zq9W'] },
      { name: 'JWT', secret: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.Zq9Wc2lnbmF0dXJl', forbidden: ['Zq9W', 'eyJzdWIi'] },
      { name: 'sk-', secret: 'sk-proj-Zq9Wx7Vb2Mn4', forbidden: ['Zq9W'] },
      { name: 'ghp_', secret: 'ghp_Zq9Wx7Vb2Mn4Pr8Lk', forbidden: ['Zq9W'] },
      { name: 'AKIA', secret: 'AKIAZQ9WX7VB2MN4PR8L', forbidden: ['ZQ9W'] },
      { name: 'password=', secret: 'password=Zq9Wx7Vb2', forbidden: ['Zq9W'] },
      { name: 'URL con userinfo', secret: 'https://user:Zq9Wx7@host.example/path', forbidden: ['Zq9W', 'user:'] },
      { name: 'PEM', secret: '-----BEGIN PRIVATE KEY----- MIIZq9Wx7 -----END PRIVATE KEY-----', forbidden: ['Zq9W'] },
      { name: 'query firmada', secret: 'https://h.example/o?X-Amz-Signature=Zq9Wx7', forbidden: ['Zq9W'] },
      { name: 'JSON con espacio', secret: '{"password":"Zq9Wx7 Vb2"}', forbidden: ['Zq9W', 'Vb2'] },
      { name: 'comilla escapada', secret: 'password="ab\\"Zq9W cd"', forbidden: ['Zq9W', ' cd'] },
      { name: 'lista JSON', secret: '{"token":["Zq9Wx7","Vb2"]}', forbidden: ['Zq9W', 'Vb2'] },
    ];

    it('no deja fragmento, respeta el límite e es idempotente en cada posición', () => {
      const failures: string[] = [];
      for (const family of FAMILIES) {
        for (let start = 0; start < FAILURE_MESSAGE_MAX_LENGTH; start += 1) {
          const input = `${'x'.repeat(start)} ${family.secret} ${'tail '.repeat(120)}`;
          const output = sanitizeFailureMessage(input);
          const leaked = family.forbidden.filter((fragment) => output.includes(fragment));
          if (leaked.length > 0) failures.push(`${family.name}@${start}: fuga ${leaked.join(',')}`);
          if (output.length > FAILURE_MESSAGE_MAX_LENGTH) failures.push(`${family.name}@${start}: longitud`);
          if (sanitizeFailureMessage(output) !== output) failures.push(`${family.name}@${start}: no idempotente`);
        }
      }
      expect(failures).toEqual([]);
    });
  });
});

/**
 * WI-CORE-027 (DEC-EVID-004, IDEA-016): familias nuevas del saneado. Cada familia tiene su caso positivo, sus
 * casos negativos (el criterio es cerrado y no debe sobre-redactar), una prueba de idempotencia, otra de
 * redacción antes de truncar en cada posición y peores casos de rendimiento a 200 000 caracteres.
 */
describe('sanitizeFailureMessage familias de WI-CORE-027 (DEC-EVID-004)', () => {
  const N = 200_000;
  const TOKEN = 'Zq9Wx7Vb2Mn4Pr8Lk';

  function timedSanitize(input: string): { output: string; elapsedMs: number } {
    const started = performance.now();
    const output = sanitizeFailureMessage(input);
    return { output, elapsedMs: performance.now() - started };
  }

  describe('positivos por familia', () => {
    it.each([
      ['Slack xoxb-', 'Slack xoxb-123456789012-abcdefABCDEF fallo', 'Slack [REDACTED] fallo'],
      ['Slack xoxp-', 'token xoxp-1-2-3abcdefgh fin', 'token [REDACTED] fin'],
      ['Stripe sk_live_', `key ${'sk_' + 'live_'}${STRIPE_SAMPLE} end`, 'key [REDACTED] end'],
      ['Stripe sk_test_', `${'sk_' + 'test_'}${STRIPE_SAMPLE}`, '[REDACTED]'],
      ['Stripe rk_live_', `${'rk_' + 'live_'}${STRIPE_SAMPLE}`, '[REDACTED]'],
      ['Google AIza', `AIza${'Sy'}${'a1'.repeat(15)} fin`, '[REDACTED] fin'],
      ['npm_', `npm_${'a1'.repeat(15)}`, '[REDACTED]'],
      ['Cookie:', 'Cookie: sid=abc123; theme=dark', 'Cookie: [REDACTED]'],
      ['Set-Cookie:', 'Set-Cookie: sid=abc123; Path=/', 'Set-Cookie: [REDACTED]'],
      ['Cookie en mitad de prosa', 'request failed Cookie: sid=1 tail', 'request failed Cookie: [REDACTED]'],
      ['credential=', 'credential=abc123 ok', 'credential=[REDACTED] ok'],
      ['auth=', 'auth=abc123 ok', 'auth=[REDACTED] ok'],
      ['signature=', 'signature=abc123', 'signature=[REDACTED]'],
      ['sig=', 'sig=abc123', 'sig=[REDACTED]'],
      ['password sin separador', 'password hunter2', 'password [REDACTED]'],
      ['token sin separador', 'token ab12cd tail', 'token [REDACTED] tail'],
      [
        'webhook de Slack en la ruta',
        'https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXXXXXXXXXX',
        'https://hooks.slack.com/services/[REDACTED]',
      ],
      [
        'segmento largo tras /token/',
        'https://x.io/token/abcdefghijklmnopqrstuv/path',
        'https://x.io/token/[REDACTED]/path',
      ],
      ['segmento largo tras /key/', 'https://x.io/key/abcdefghijklmnopqrstuv', 'https://x.io/key/[REDACTED]'],
    ])('redacta %s', (_name, input, expected) => {
      const sanitized = sanitizeFailureMessage(input);
      expect(sanitized).toBe(expected);
      expect(sanitizeFailureMessage(sanitized)).toBe(sanitized);
    });
  });

  describe('negativos: el criterio cerrado no sobre-redacta', () => {
    it.each([
      ['author= no es auth=', 'author=Ana'],
      ['design= no es sig=', 'design=dark'],
      ['palabra sensible seguida de prosa', 'token expired after retries'],
      ['password seguido de palabra sin dígito', 'password format rules'],
      ['task_live_ no es sk_live_', 'task_live_4eC39HqLyjWDarjtT1zdp7dc'],
      ['ruta corta con /key/', 'https://example.com/docs/key/short'],
      ['ruta normal', 'https://example.com/api/v1/items/abc'],
      ['SHA de commit en ruta', 'https://github.com/o/r/commit/0123456789abcdef0123456789abcdef01234567'],
    ])('no toca %s', (_name, input) => {
      expect(sanitizeFailureMessage(input)).toBe(input);
    });
  });

  it('es idempotente sobre una mezcla de todas las familias nuevas', () => {
    const mixed =
      'xoxb-123456789012-abcdefABCDEF ' + 'sk_' + 'live_' + STRIPE_SAMPLE + ' AIzaSy' +
      'a1'.repeat(15) +
      ` npm_${'a1'.repeat(15)} Cookie: sid=1; x=2 password hunter2 credential=abc ` +
      'https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXXXXXXXXXX https://x.io/token/abcdefghijklmnopqrstuv';
    const once = sanitizeFailureMessage(mixed);
    expect(sanitizeFailureMessage(once)).toBe(once);
    expect(once).not.toMatch(/xoxb-|sk_live_|AIza|npm_a|sid=1|hunter2|credential=abc|XXXXXXXX|abcdefghijklmnop/);
  });

  it('redacta antes de truncar en cada posición de corte para las familias nuevas', () => {
    const FAMILIES: ReadonlyArray<{ name: string; secret: string }> = [
      { name: 'Slack', secret: `xoxb-${TOKEN}` },
      { name: 'Stripe', secret: `sk_live_${TOKEN}` },
      { name: 'npm', secret: `npm_${TOKEN}Pr8Lk` },
      { name: 'Cookie', secret: `Cookie: sid=${TOKEN}` },
      { name: 'webhook Slack', secret: `https://hooks.slack.com/services/T0A1B2C/B3D4E5F/${TOKEN}` },
      { name: 'segmento /token/', secret: `https://x.io/token/${TOKEN}Pr8Lk` },
      { name: 'password sin separador', secret: `password ${TOKEN}` },
      { name: 'credential=', secret: `credential=${TOKEN}` },
    ];
    const failures: string[] = [];
    for (const family of FAMILIES) {
      for (let start = 0; start < FAILURE_MESSAGE_MAX_LENGTH; start += 1) {
        const output = sanitizeFailureMessage(`${'x'.repeat(start)} ${family.secret} ${'tail '.repeat(120)}`);
        if (output.includes('Zq9W')) failures.push(`${family.name}@${start}: fuga`);
        if (output.length > FAILURE_MESSAGE_MAX_LENGTH) failures.push(`${family.name}@${start}: longitud`);
        if (sanitizeFailureMessage(output) !== output) failures.push(`${family.name}@${start}: no idempotente`);
      }
    }
    expect(failures).toEqual([]);
  });

  describe('rendimiento: peores casos de las familias nuevas a 200 000 caracteres', () => {
    it.each([
      ['xoxb- largo', `xoxb-${'a'.repeat(N)}`],
      ['sk_live_ largo', `sk_live_${'a'.repeat(N)}`],
      ['AIza largo', `AIza${'a'.repeat(N)}`],
      ['npm_ repetido', 'npm_'.repeat(N / 4)],
      ['Cookie: sin valor seguido de espacios', `Cookie:${' '.repeat(N)}x`],
      ['Cookie: con muchos ;', `Cookie: ${'a;'.repeat(N / 2)}`],
      ['Set-Cookie: repetido', 'Set-Cookie: '.repeat(N / 12)],
      ['palabra sensible sin dígito', `password ${'a'.repeat(N)}`],
      ['palabra sensible con dígito al final', `password ${'a'.repeat(N)}1`],
      ['token seguido de espacios repetidos', `token${' '.repeat(N)}x`],
      ['token repetido', 'token '.repeat(N / 6)],
      ['credential= repetido', 'credential='.repeat(N / 11)],
      ['sig= repetido', 'sig='.repeat(N / 4)],
      ['webhook Slack con T repetida', `https://h.example/services/${'T'.repeat(N)}`],
      ['segmento /token/ largo', `https://h.example/token/${'a'.repeat(N)}`],
      ['segmentos /key/ repetidos', `https://h.example${'/key/'.repeat(N / 5)}`],
      ['esquemas repetidos', 'https://'.repeat(N / 8)],
    ])('%s sanea en menos de 250 ms y acota la salida', (_name, input) => {
      const { output, elapsedMs } = timedSanitize(input);
      expect(elapsedMs).toBeLessThan(250);
      expect(output.length).toBeLessThanOrEqual(FAILURE_MESSAGE_MAX_LENGTH);
    });
  });
});
