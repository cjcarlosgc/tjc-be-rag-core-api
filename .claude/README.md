# Adaptador Claude

Claude debe consumir `AGENTS.md`, `harness/WORKFLOW.md`, `harness/roles/` y `harness/agent-profiles.yaml`. No duplicar reglas funcionales aquí.

`.claude/agents/` materializa los roles canónicos del Harness como perfiles de subagente: `leader`, `sdd-analyst`, `implementer`, `implementer-high` y `contract-reviewer`. El Human Reviewer es el usuario y no tiene perfil de agente. Los `model` usan los identificadores de `agent-profiles.yaml`; ante una sustitución, actualizar ambos archivos a la vez.
