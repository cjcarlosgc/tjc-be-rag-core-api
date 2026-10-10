#!/usr/bin/env node
// PreToolUse(Agent): si la descripcion del subagente menciona un WI, debe seguir
// `[<perfil>::<modelo>] · <WI> · <corte en espanol>` (harness/roles/leader.md).
let raw = ''
process.stdin.on('data', (chunk) => { raw += chunk })
process.stdin.on('end', () => {
  let description = ''
  try {
    description = String(JSON.parse(raw)?.tool_input?.description ?? '')
  } catch {
    process.exit(0)
  }
  if (!/WI-[A-Z]+-\d{3}/.test(description)) process.exit(0)
  if (/^\[[a-z][a-z-]*::[^\]]+\] · WI-[A-Z]+-\d{3} · \S.*$/.test(description)) process.exit(0)
  process.stderr.write(
    `Titulo de subagente invalido: "${description}".\n` +
    'Usa `[<perfil>::<modelo>] · <WI> · <corte en español>`, p. ej. ' +
    '`[implementer::Haiku 5.5] · WI-CORE-019 · Corte A rol Writer` ' +
    '(perfil y modelAlias de harness/agent-profiles.yaml; ver harness/roles/leader.md). Reintenta con ese `description`.\n'
  )
  process.exit(2)
})
