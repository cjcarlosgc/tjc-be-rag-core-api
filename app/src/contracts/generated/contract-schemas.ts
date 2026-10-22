/* AUTO-GENERADO por scripts/generate-contract-types.mjs desde spec/contracts/schemas. No editar a mano. */
export const CONTRACT_SCHEMAS = {
  "common.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tjc.local/contracts/common.schema.json",
    "title": "Tipos comunes (INTEROP §2)",
    "description": "Convenciones universales de INTEROP §2 compartidas por todos los esquemas del contrato.",
    "$defs": {
      "Id": {
        "type": "string",
        "format": "uuid",
        "description": "UUID."
      },
      "IsoDateTime": {
        "type": "string",
        "format": "date-time",
        "description": "ISO 8601 UTC."
      },
      "RelativePath": {
        "type": "string",
        "minLength": 1,
        "pattern": "^(?!/)(?!.*(^|/)\\.\\.(/|$))(?!.*\\\\)[^\\u0000]+$",
        "description": "POSIX, relativo, normalizado y sin traversal (sin barra inicial, sin '..', sin '\\')."
      },
      "Sha256": {
        "type": "string",
        "pattern": "^[a-f0-9]{64}$",
        "description": "64 caracteres hexadecimales minúsculos."
      },
      "NonNegativeInteger": {
        "type": "integer",
        "minimum": 0
      },
      "ExecutionProfile": {
        "type": "string",
        "enum": [
          "NODE_TYPESCRIPT",
          "PHP_LARAVEL_PHPUNIT"
        ]
      },
      "TestRunner": {
        "type": "string",
        "enum": [
          "JEST",
          "VITEST",
          "PHPUNIT"
        ]
      }
    }
  },
  "error-envelope.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tjc.local/contracts/error-envelope.schema.json",
    "title": "ErrorEnvelope",
    "description": "Forma única de todo error HTTP de la solución (INTEROP §4). Los consumidores ignoran campos desconocidos.",
    "type": "object",
    "required": [
      "statusCode",
      "code",
      "message",
      "details",
      "correlationId",
      "timestamp",
      "path"
    ],
    "properties": {
      "statusCode": {
        "type": "integer",
        "minimum": 400,
        "maximum": 599
      },
      "code": {
        "type": "string",
        "minLength": 1,
        "description": "Código estable en UPPER_SNAKE_CASE. Abierto: un código explícito de la aplicación siempre prevalece; los códigos genéricos de INTEROP-2.18 §4 (UNAUTHORIZED, FORBIDDEN, NOT_FOUND, METHOD_NOT_ALLOWED, NOT_ACCEPTABLE, CONFLICT, PAYLOAD_TOO_LARGE, UNSUPPORTED_MEDIA_TYPE, UNPROCESSABLE_ENTITY, TOO_MANY_REQUESTS, SERVICE_UNAVAILABLE, INTERNAL_ERROR, HTTP_ERROR) se emiten solo cuando el error no trae código propio."
      },
      "message": {
        "type": "string",
        "description": "Mensaje neutral; no incluye tokens, secretos, URLs firmadas ni texto crudo de terceros. En los códigos genéricos de INTEROP-2.18 §4 es un mensaje fijo en español que no repite el texto de la excepción."
      },
      "details": {
        "type": [
          "object",
          "array",
          "string",
          "number",
          "boolean",
          "null"
        ],
        "description": "Detalle estructurado (cualquier valor JSON) o null cuando no aplica."
      },
      "correlationId": {
        "type": "string",
        "minLength": 1
      },
      "timestamp": {
        "$ref": "common.schema.json#/$defs/IsoDateTime"
      },
      "path": {
        "type": "string"
      },
      "retryable": {
        "type": "boolean",
        "description": "Opcional. Lo declaran los servicios cuyo contrato distingue reintentos: GitHub Integration (GH-INTEROP) en todos sus errores, y Core solo en los códigos genéricos de INTEROP-2.18 §4 (true en TOO_MANY_REQUESTS y SERVICE_UNAVAILABLE; false en el resto de genéricos). Ausente = el consumidor no debe asumir reintento."
      }
    }
  },
  "realtime-events.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tjc.local/contracts/realtime-events.schema.json",
    "title": "Eventos de tiempo real Core (INTEROP §6.6)",
    "description": "Payloads de suscripción (cliente -> servidor, con acknowledgment SubscribeAck) y de aviso (servidor -> cliente) de INTEROP-2.18 §6.6. Cada aviso lleva exactamente el DTO de su GET (AnalysisRunDetailResponse = GET /analysis-runs/{id}, ExperimentStatusResponse = GET /experiments/{id}). Los requests rechazan campos no declarados; las responses admiten campos aditivos.",
    "$defs": {
      "SubscribeProjectVersionPayload": {
        "type": "object",
        "description": "Body de 'subscribe:project-version' y 'unsubscribe:project-version'.",
        "required": [
          "projectVersionId"
        ],
        "additionalProperties": false,
        "properties": {
          "projectVersionId": {
            "$ref": "common.schema.json#/$defs/Id"
          }
        }
      },
      "SubscribeAnalysisRunPayload": {
        "type": "object",
        "description": "Body de 'subscribe:analysis-run' y 'unsubscribe:analysis-run'.",
        "required": [
          "analysisRunId"
        ],
        "additionalProperties": false,
        "properties": {
          "analysisRunId": {
            "$ref": "common.schema.json#/$defs/Id"
          }
        }
      },
      "SubscribeExperimentPayload": {
        "type": "object",
        "description": "Body de 'subscribe:experiment' y 'unsubscribe:experiment'.",
        "required": [
          "experimentId"
        ],
        "additionalProperties": false,
        "properties": {
          "experimentId": {
            "$ref": "common.schema.json#/$defs/Id"
          }
        }
      },
      "SubscribeAck": {
        "type": "object",
        "description": "Acknowledgment de 'subscribe:*' con exactamente tres resultados: suscrito; verificación no disponible (reintentable); sin visibilidad o id inexistente (sin distinguirlos).",
        "required": [
          "subscribed",
          "code",
          "retryable"
        ],
        "properties": {
          "subscribed": {
            "type": "boolean"
          },
          "code": {
            "enum": [
              "GITHUB_VERIFICATION_UNAVAILABLE",
              null
            ]
          },
          "retryable": {
            "type": "boolean"
          }
        },
        "oneOf": [
          {
            "properties": {
              "subscribed": {
                "const": true
              },
              "code": {
                "const": null
              },
              "retryable": {
                "const": false
              }
            }
          },
          {
            "properties": {
              "subscribed": {
                "const": false
              },
              "code": {
                "const": "GITHUB_VERIFICATION_UNAVAILABLE"
              },
              "retryable": {
                "const": true
              }
            }
          },
          {
            "properties": {
              "subscribed": {
                "const": false
              },
              "code": {
                "const": null
              },
              "retryable": {
                "const": false
              }
            }
          }
        ]
      },
      "PullRequestRefResponse": {
        "type": "object",
        "required": [
          "repositoryId",
          "repositoryName",
          "number",
          "title",
          "baseRef",
          "headRef",
          "baseSha",
          "headSha",
          "draft",
          "state",
          "actorLogin"
        ],
        "properties": {
          "repositoryId": {
            "type": "string"
          },
          "repositoryName": {
            "type": "string"
          },
          "number": {
            "type": "integer",
            "minimum": 1
          },
          "title": {
            "type": "string"
          },
          "baseRef": {
            "type": "string"
          },
          "headRef": {
            "type": "string"
          },
          "baseSha": {
            "type": "string"
          },
          "headSha": {
            "type": "string"
          },
          "draft": {
            "type": "boolean"
          },
          "state": {
            "enum": [
              "OPEN",
              "CLOSED",
              "MERGED"
            ]
          },
          "actorLogin": {
            "type": [
              "string",
              "null"
            ]
          }
        }
      },
      "AnalysisRunStatus": {
        "type": "string",
        "enum": [
          "QUEUED",
          "PROCESSING",
          "ACTION_REQUIRED",
          "SUCCESS",
          "BEHAVIORAL_MISMATCH",
          "TECHNICAL_GENERATION_FAILURE",
          "INFRASTRUCTURE_FAILURE",
          "BASELINE_FAILED",
          "NO_ADDITIONAL_TESTS_REQUIRED",
          "NO_TEST_RELEVANT_CHANGES",
          "OBSOLETE"
        ]
      },
      "AnalysisSymbolResponse": {
        "type": "object",
        "required": [
          "language",
          "kind",
          "qualifiedName",
          "filePath",
          "changeKind"
        ],
        "properties": {
          "language": {
            "enum": [
              "TYPESCRIPT",
              "PHP"
            ]
          },
          "kind": {
            "enum": [
              "CLASS",
              "METHOD",
              "FUNCTION",
              "INTERFACE",
              "TYPE",
              "TRAIT",
              "ENUM"
            ]
          },
          "qualifiedName": {
            "type": "string"
          },
          "filePath": {
            "$ref": "common.schema.json#/$defs/RelativePath"
          },
          "changeKind": {
            "enum": [
              "DIRECTLY_CHANGED",
              "POTENTIALLY_IMPACTED"
            ]
          }
        }
      },
      "AnalysisRunDetailResponse": {
        "type": "object",
        "description": "Payload de 'analysis-run:update'. Mismo DTO que GET /analysis-runs/{id} (INTEROP §6.10).",
        "required": [
          "id",
          "projectId",
          "pullRequest",
          "status",
          "current",
          "actionRequiredCount",
          "generatedTestsCount",
          "createdAt",
          "updatedAt",
          "completedAt",
          "attemptCount",
          "indexMode",
          "changesetBaseSha",
          "changesetHeadSha",
          "indexDeltaBaseSha",
          "symbols",
          "functionalBehaviorValidated",
          "resultSummary",
          "detailsUrl"
        ],
        "properties": {
          "id": {
            "$ref": "common.schema.json#/$defs/Id"
          },
          "projectId": {
            "$ref": "common.schema.json#/$defs/Id"
          },
          "pullRequest": {
            "$ref": "#/$defs/PullRequestRefResponse"
          },
          "status": {
            "$ref": "#/$defs/AnalysisRunStatus"
          },
          "current": {
            "type": "boolean"
          },
          "actionRequiredCount": {
            "$ref": "common.schema.json#/$defs/NonNegativeInteger"
          },
          "generatedTestsCount": {
            "$ref": "common.schema.json#/$defs/NonNegativeInteger"
          },
          "createdAt": {
            "$ref": "common.schema.json#/$defs/IsoDateTime"
          },
          "updatedAt": {
            "$ref": "common.schema.json#/$defs/IsoDateTime"
          },
          "completedAt": {
            "oneOf": [
              {
                "$ref": "common.schema.json#/$defs/IsoDateTime"
              },
              {
                "type": "null"
              }
            ]
          },
          "attemptCount": {
            "$ref": "common.schema.json#/$defs/NonNegativeInteger"
          },
          "indexMode": {
            "enum": [
              "BOOTSTRAP",
              "INCREMENTAL"
            ]
          },
          "changesetBaseSha": {
            "type": "string"
          },
          "changesetHeadSha": {
            "type": "string"
          },
          "indexDeltaBaseSha": {
            "type": [
              "string",
              "null"
            ]
          },
          "symbols": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/AnalysisSymbolResponse"
            }
          },
          "functionalBehaviorValidated": {
            "type": "boolean"
          },
          "resultSummary": {
            "type": [
              "string",
              "null"
            ]
          },
          "detailsUrl": {
            "type": "string"
          }
        }
      },
      "ExperimentModelConfigResponse": {
        "type": "object",
        "required": [
          "provider",
          "model",
          "modelVersion",
          "reasoningEffort",
          "temperature",
          "maxOutputTokens"
        ],
        "properties": {
          "provider": {
            "type": "string"
          },
          "model": {
            "type": "string"
          },
          "modelVersion": {
            "type": [
              "string",
              "null"
            ]
          },
          "reasoningEffort": {
            "type": [
              "string",
              "null"
            ]
          },
          "temperature": {
            "type": [
              "number",
              "null"
            ]
          },
          "maxOutputTokens": {
            "type": [
              "number",
              "null"
            ]
          }
        }
      },
      "ExperimentBudgetResponse": {
        "type": "object",
        "required": [
          "toolCallCap",
          "contextTokenBudget",
          "maxDurationMs"
        ],
        "properties": {
          "toolCallCap": {
            "type": "number"
          },
          "contextTokenBudget": {
            "type": "number"
          },
          "maxDurationMs": {
            "type": "number"
          }
        }
      },
      "ExperimentStatusResponse": {
        "type": "object",
        "description": "Payload de 'experiment:update'. Mismo DTO que GET /experiments/{id} (INTEROP §6.5, presentador único experiment-status.presenter).",
        "required": [
          "id",
          "projectId",
          "projectVersionId",
          "targetId",
          "status",
          "completedRepetitions",
          "totalRepetitions",
          "failureCode",
          "failureMessage",
          "startedAt",
          "completedAt",
          "model",
          "budget",
          "executionProfile",
          "runnerHint",
          "randomizationSeed"
        ],
        "properties": {
          "id": {
            "$ref": "common.schema.json#/$defs/Id"
          },
          "projectId": {
            "$ref": "common.schema.json#/$defs/Id"
          },
          "projectVersionId": {
            "$ref": "common.schema.json#/$defs/Id"
          },
          "targetId": {
            "$ref": "common.schema.json#/$defs/Id"
          },
          "status": {
            "enum": [
              "PENDING",
              "RUNNING",
              "COMPLETED",
              "FAILED"
            ]
          },
          "completedRepetitions": {
            "$ref": "common.schema.json#/$defs/NonNegativeInteger"
          },
          "totalRepetitions": {
            "$ref": "common.schema.json#/$defs/NonNegativeInteger"
          },
          "failureCode": {
            "type": [
              "string",
              "null"
            ]
          },
          "failureMessage": {
            "type": [
              "string",
              "null"
            ]
          },
          "startedAt": {
            "oneOf": [
              {
                "$ref": "common.schema.json#/$defs/IsoDateTime"
              },
              {
                "type": "null"
              }
            ]
          },
          "completedAt": {
            "oneOf": [
              {
                "$ref": "common.schema.json#/$defs/IsoDateTime"
              },
              {
                "type": "null"
              }
            ]
          },
          "model": {
            "oneOf": [
              {
                "$ref": "#/$defs/ExperimentModelConfigResponse"
              },
              {
                "type": "null"
              }
            ]
          },
          "budget": {
            "oneOf": [
              {
                "$ref": "#/$defs/ExperimentBudgetResponse"
              },
              {
                "type": "null"
              }
            ]
          },
          "executionProfile": {
            "type": [
              "string",
              "null"
            ]
          },
          "runnerHint": {
            "type": [
              "string",
              "null"
            ]
          },
          "randomizationSeed": {
            "type": [
              "string",
              "null"
            ]
          }
        }
      }
    }
  },
  "sandbox-execution.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tjc.local/contracts/sandbox-execution.schema.json",
    "title": "Contrato RAG Core ↔ Test Execution Sandbox (INTEROP §7)",
    "description": "Formas de request y response de /executions. El request rechaza campos desconocidos; las responses admiten campos aditivos.",
    "$defs": {
      "SandboxStage": {
        "type": "string",
        "enum": [
          "PREPARING",
          "INSTALLING_DEPENDENCIES",
          "COMPILING",
          "RUNNING_TESTS",
          "FINALIZING"
        ]
      },
      "SandboxExecutionStatus": {
        "type": "string",
        "enum": [
          "PENDING",
          "PREPARING",
          "INSTALLING_DEPENDENCIES",
          "COMPILING",
          "RUNNING_TESTS",
          "FINALIZING",
          "COMPLETED",
          "FAILED",
          "TIMED_OUT"
        ]
      },
      "TerminalStatus": {
        "type": "string",
        "enum": [
          "COMPLETED",
          "FAILED",
          "TIMED_OUT"
        ]
      },
      "ExecutionScope": {
        "type": "string",
        "enum": [
          "TARGET",
          "BATCH"
        ]
      },
      "ExecutionPhase": {
        "type": "string",
        "enum": [
          "BASELINE",
          "GENERATED_TESTS"
        ]
      },
      "ExecutionInputRole": {
        "type": "string",
        "enum": [
          "PROJECT_SNAPSHOT",
          "GENERATED_ARTIFACT"
        ]
      },
      "ArtifactType": {
        "type": "string",
        "enum": [
          "CREATED",
          "MODIFIED"
        ]
      },
      "EphemeralDownloadRef": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "role",
          "url",
          "expiresAt",
          "sha256",
          "sizeBytes"
        ],
        "properties": {
          "role": {
            "$ref": "#/$defs/ExecutionInputRole"
          },
          "url": {
            "type": "string",
            "format": "uri",
            "pattern": "^https://",
            "description": "URL HTTPS firmada; capacidad temporal y sensible."
          },
          "expiresAt": {
            "$ref": "common.schema.json#/$defs/IsoDateTime"
          },
          "sha256": {
            "$ref": "common.schema.json#/$defs/Sha256"
          },
          "sizeBytes": {
            "$ref": "common.schema.json#/$defs/NonNegativeInteger"
          }
        }
      },
      "ExecutionArtifactInput": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "artifactId",
          "relativePath",
          "artifactType",
          "download"
        ],
        "properties": {
          "artifactId": {
            "$ref": "common.schema.json#/$defs/Id"
          },
          "relativePath": {
            "$ref": "common.schema.json#/$defs/RelativePath"
          },
          "artifactType": {
            "$ref": "#/$defs/ArtifactType"
          },
          "download": {
            "$ref": "#/$defs/EphemeralDownloadRef",
            "description": "role GENERATED_ARTIFACT."
          }
        }
      },
      "CreateSandboxExecutionRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "requestId",
          "testRunId",
          "projectVersionId",
          "snapshot",
          "artifacts",
          "scope",
          "targetIds",
          "executionProfile",
          "runnerHint"
        ],
        "properties": {
          "requestId": {
            "$ref": "common.schema.json#/$defs/Id",
            "description": "Igual a Idempotency-Key."
          },
          "testRunId": {
            "$ref": "common.schema.json#/$defs/Id"
          },
          "projectVersionId": {
            "$ref": "common.schema.json#/$defs/Id"
          },
          "snapshot": {
            "$ref": "#/$defs/EphemeralDownloadRef",
            "description": "role PROJECT_SNAPSHOT."
          },
          "projectRoot": {
            "$ref": "common.schema.json#/$defs/RelativePath",
            "description": "INTEROP-2.8; omisión transitoria equivale a '.'."
          },
          "artifacts": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/ExecutionArtifactInput"
            }
          },
          "scope": {
            "$ref": "#/$defs/ExecutionScope"
          },
          "targetIds": {
            "type": "array",
            "items": {
              "$ref": "common.schema.json#/$defs/Id"
            }
          },
          "executionProfile": {
            "$ref": "common.schema.json#/$defs/ExecutionProfile"
          },
          "runnerHint": {
            "$ref": "common.schema.json#/$defs/TestRunner"
          },
          "phase": {
            "$ref": "#/$defs/ExecutionPhase",
            "description": "Tolerancia transitoria (INTEROP-2.17 §7.2): puede omitirse y equivale a GENERATED_TESTS. Core aún no lo envía (brecha documentada en la feature 013, OC09) y un Sandbox anterior rechazaría el campo."
          }
        }
      },
      "SandboxExecutionAcceptedResponse": {
        "type": "object",
        "required": [
          "status",
          "pollAfterMs",
          "executionId",
          "requestId",
          "projectVersionId"
        ],
        "properties": {
          "status": {
            "const": "PENDING"
          },
          "pollAfterMs": {
            "$ref": "common.schema.json#/$defs/NonNegativeInteger"
          },
          "executionId": {
            "$ref": "common.schema.json#/$defs/Id"
          },
          "requestId": {
            "$ref": "common.schema.json#/$defs/Id"
          },
          "projectVersionId": {
            "$ref": "common.schema.json#/$defs/Id"
          }
        }
      },
      "SandboxExecutionStatusResponse": {
        "type": "object",
        "required": [
          "executionId",
          "requestId",
          "projectVersionId",
          "status",
          "stage",
          "failureCode",
          "failureMessage",
          "startedAt",
          "completedAt",
          "createdAt",
          "updatedAt"
        ],
        "properties": {
          "executionId": {
            "$ref": "common.schema.json#/$defs/Id"
          },
          "requestId": {
            "$ref": "common.schema.json#/$defs/Id"
          },
          "projectVersionId": {
            "$ref": "common.schema.json#/$defs/Id"
          },
          "status": {
            "$ref": "#/$defs/SandboxExecutionStatus"
          },
          "stage": {
            "oneOf": [
              {
                "$ref": "#/$defs/SandboxStage"
              },
              {
                "type": "null"
              }
            ]
          },
          "failureCode": {
            "type": [
              "string",
              "null"
            ]
          },
          "failureMessage": {
            "type": [
              "string",
              "null"
            ]
          },
          "startedAt": {
            "oneOf": [
              {
                "$ref": "common.schema.json#/$defs/IsoDateTime"
              },
              {
                "type": "null"
              }
            ]
          },
          "completedAt": {
            "oneOf": [
              {
                "$ref": "common.schema.json#/$defs/IsoDateTime"
              },
              {
                "type": "null"
              }
            ]
          },
          "createdAt": {
            "$ref": "common.schema.json#/$defs/IsoDateTime"
          },
          "updatedAt": {
            "$ref": "common.schema.json#/$defs/IsoDateTime"
          }
        }
      },
      "TestCaseFact": {
        "type": "object",
        "required": [
          "suitePath",
          "name",
          "status",
          "durationMs",
          "errorMessage"
        ],
        "properties": {
          "suitePath": {
            "oneOf": [
              {
                "$ref": "common.schema.json#/$defs/RelativePath"
              },
              {
                "type": "null"
              }
            ]
          },
          "name": {
            "type": "string"
          },
          "status": {
            "type": "string",
            "enum": [
              "PASSED",
              "FAILED",
              "SKIPPED",
              "TODO"
            ]
          },
          "durationMs": {
            "oneOf": [
              {
                "$ref": "common.schema.json#/$defs/NonNegativeInteger"
              },
              {
                "type": "null"
              }
            ]
          },
          "errorMessage": {
            "type": [
              "string",
              "null"
            ]
          },
          "failureKind": {
            "oneOf": [
              {
                "type": "string",
                "enum": [
                  "ASSERTION",
                  "ERROR"
                ]
              },
              {
                "type": "null"
              }
            ],
            "description": "Aditivo 2026-10-09; null si el caso no falló. Un Sandbox anterior puede omitirlo."
          }
        }
      },
      "RunnerFacts": {
        "type": "object",
        "required": [
          "executionProfile",
          "runner",
          "compiled",
          "executed",
          "passed",
          "totalTests",
          "passedTests",
          "failedTests",
          "skippedTests",
          "testCases",
          "testCasesTruncated"
        ],
        "properties": {
          "executionProfile": {
            "$ref": "common.schema.json#/$defs/ExecutionProfile"
          },
          "runner": {
            "$ref": "common.schema.json#/$defs/TestRunner"
          },
          "compiled": {
            "type": "boolean"
          },
          "executed": {
            "type": "boolean"
          },
          "passed": {
            "type": "boolean"
          },
          "totalTests": {
            "$ref": "common.schema.json#/$defs/NonNegativeInteger"
          },
          "passedTests": {
            "$ref": "common.schema.json#/$defs/NonNegativeInteger"
          },
          "failedTests": {
            "$ref": "common.schema.json#/$defs/NonNegativeInteger"
          },
          "skippedTests": {
            "$ref": "common.schema.json#/$defs/NonNegativeInteger"
          },
          "testCases": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/TestCaseFact"
            }
          },
          "testCasesTruncated": {
            "type": "boolean"
          }
        }
      },
      "StageDuration": {
        "type": "object",
        "required": [
          "stage",
          "durationMs"
        ],
        "properties": {
          "stage": {
            "$ref": "#/$defs/SandboxStage"
          },
          "durationMs": {
            "$ref": "common.schema.json#/$defs/NonNegativeInteger"
          },
          "startedAt": {
            "$ref": "common.schema.json#/$defs/IsoDateTime",
            "description": "INTEROP-2.16; ausente en Sandboxes anteriores o en etapas que no lo emiten."
          },
          "completedAt": {
            "$ref": "common.schema.json#/$defs/IsoDateTime",
            "description": "INTEROP-2.16; ausente en Sandboxes anteriores o en etapas que no lo emiten."
          }
        }
      },
      "SandboxFailureFact": {
        "type": "object",
        "required": [
          "stage",
          "category",
          "code",
          "message"
        ],
        "properties": {
          "stage": {
            "$ref": "#/$defs/SandboxStage"
          },
          "category": {
            "type": "string",
            "enum": [
              "COMPILATION",
              "TEST_ASSERTION",
              "TEST_RUNTIME",
              "DEPENDENCY",
              "CONFIGURATION",
              "INFRASTRUCTURE",
              "UNKNOWN"
            ]
          },
          "code": {
            "type": "string",
            "minLength": 1
          },
          "message": {
            "type": "string"
          }
        }
      },
      "ExecutionEvidenceFact": {
        "type": "object",
        "required": [
          "kind",
          "stage",
          "content",
          "truncated",
          "originalBytes"
        ],
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "COMPILER_STDOUT",
              "COMPILER_STDERR",
              "TEST_STDOUT",
              "TEST_STDERR",
              "RUNNER_REPORT"
            ]
          },
          "stage": {
            "$ref": "#/$defs/SandboxStage"
          },
          "content": {
            "type": "string"
          },
          "truncated": {
            "type": "boolean"
          },
          "originalBytes": {
            "oneOf": [
              {
                "$ref": "common.schema.json#/$defs/NonNegativeInteger"
              },
              {
                "type": "null"
              }
            ]
          }
        }
      },
      "SandboxExecutionResultResponse": {
        "type": "object",
        "required": [
          "executionId",
          "requestId",
          "testRunId",
          "projectVersionId",
          "status",
          "facts",
          "failure",
          "stageDurations",
          "appliedArtifactIds",
          "evidence",
          "startedAt",
          "completedAt"
        ],
        "properties": {
          "executionId": {
            "$ref": "common.schema.json#/$defs/Id"
          },
          "requestId": {
            "$ref": "common.schema.json#/$defs/Id"
          },
          "testRunId": {
            "$ref": "common.schema.json#/$defs/Id"
          },
          "projectVersionId": {
            "$ref": "common.schema.json#/$defs/Id"
          },
          "status": {
            "$ref": "#/$defs/TerminalStatus"
          },
          "facts": {
            "oneOf": [
              {
                "$ref": "#/$defs/RunnerFacts"
              },
              {
                "type": "null"
              }
            ]
          },
          "failure": {
            "oneOf": [
              {
                "$ref": "#/$defs/SandboxFailureFact"
              },
              {
                "type": "null"
              }
            ]
          },
          "stageDurations": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/StageDuration"
            }
          },
          "appliedArtifactIds": {
            "type": "array",
            "items": {
              "$ref": "common.schema.json#/$defs/Id"
            }
          },
          "evidence": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/ExecutionEvidenceFact"
            }
          },
          "startedAt": {
            "$ref": "common.schema.json#/$defs/IsoDateTime"
          },
          "completedAt": {
            "$ref": "common.schema.json#/$defs/IsoDateTime"
          }
        }
      }
    }
  }
} as const;
