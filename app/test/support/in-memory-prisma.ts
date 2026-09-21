import { randomUUID } from 'node:crypto';

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

interface Relation {
  model: string;
  many: boolean;
  local: string;
  foreign: string;
}

/**
 * Relaciones de los modelos que las pruebas consultan por filtro anidado
 * (`accessibleProject` filtra por `access` y `repositoryBinding`).
 */
const RELATIONS: Record<string, Record<string, Relation>> = {
  project: {
    access: { model: 'projectAccess', many: true, local: 'id', foreign: 'projectId' },
    repositoryBinding: { model: 'repositoryBinding', many: false, local: 'id', foreign: 'projectId' },
  },
  projectAccess: { project: { model: 'project', many: false, local: 'projectId', foreign: 'id' } },
  repositoryBinding: { project: { model: 'project', many: false, local: 'projectId', foreign: 'id' } },
  analysisRun: { project: { model: 'project', many: false, local: 'projectId', foreign: 'id' } },
  functionalQuestion: {
    project: { model: 'project', many: false, local: 'projectId', foreign: 'id' },
    analysisRun: { model: 'analysisRun', many: false, local: 'analysisRunId', foreign: 'id' },
  },
  projectVersion: { project: { model: 'project', many: false, local: 'projectId', foreign: 'id' } },
  experimentRun: { project: { model: 'project', many: false, local: 'projectId', foreign: 'id' } },
  testPublication: { analysisRun: { model: 'analysisRun', many: false, local: 'analysisRunId', foreign: 'id' } },
  testTarget: { projectVersion: { model: 'projectVersion', many: false, local: 'projectVersionId', foreign: 'id' } },
};

const MODELS = [
  'project',
  'projectAccess',
  'repositoryBinding',
  'analysisRun',
  'functionalQuestion',
  'functionalKnowledge',
  'projectVersion',
  'testPublication',
  'experimentRun',
  'testTarget',
  'generatedTestProposal',
  'analysisSymbol',
  'userGithubIdentity',
] as const;

/** Claves compuestas (`@@id`) que Prisma expone como `<a>_<b>`. */
const COMPOSITE_KEYS: Record<string, string[]> = { projectAccess: ['projectId', 'userId'] };

/**
 * Sustituto en memoria de `PrismaService` para las pruebas: evalúa el subconjunto del
 * lenguaje `where` de Prisma que usan `accessibleProject` y los repositorios (AND/OR/NOT,
 * `not`, `in`, `some`/`none`/`every`, `is`/`isNot`, filtro directo de relación 1-1) sobre
 * tablas en memoria, y emula el advisory lock transaccional (`pg_advisory_xact_lock`) con
 * un mutex por clave liberado al terminar la transacción. No es un motor SQL: solo lo que
 * el código bajo prueba pide.
 */
export class InMemoryPrisma {
  readonly tables: Record<string, Row[]> = {};
  /** Claves de advisory lock adquiridas, en orden (para aseverar que se tomó UN lock por par). */
  readonly lockLog: string[] = [];
  /** Punto de sincronización opcional de pruebas: se ejecuta tras adquirir un lock. */
  onLockAcquired?: (key: string) => Promise<void> | void;

  private readonly locks = new Map<string, Promise<void>>();

  [model: string]: unknown;

  constructor() {
    for (const model of MODELS) {
      this.tables[model] = [];
      this[model] = this.delegate(model);
    }
  }

  reset(): void {
    for (const model of MODELS) {
      this.tables[model].length = 0;
    }
    this.lockLog.length = 0;
    this.locks.clear();
    this.onLockAcquired = undefined;
  }

  insert(model: string, row: Row): Row {
    const stored = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...row };
    this.tables[model].push(stored);
    return stored;
  }

  async $transaction<T>(work: ((tx: unknown) => Promise<T>) | Promise<unknown>[]): Promise<T | unknown[]> {
    if (Array.isArray(work)) {
      return Promise.all(work);
    }

    const held: Array<() => void> = [];
    const tx = Object.create(this) as InMemoryPrisma;
    tx.$executeRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join('?').includes('pg_advisory_xact_lock')) {
        const key = String(values[0]);
        held.push(await this.acquire(key));
        this.lockLog.push(key);
        await this.onLockAcquired?.(key);
      }
      return 0;
    };

    try {
      return await work(tx);
    } finally {
      held.forEach((release) => release());
    }
  }

  $executeRaw(_strings: TemplateStringsArray, ..._values: unknown[]): Promise<number> {
    return Promise.resolve(0);
  }

  /** `SELECT "id" FROM "projects" WHERE "id" = ... FOR SHARE` del alta de binding. */
  $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<Array<{ id: string }>> {
    if (strings.join('?').includes('FROM "projects"')) {
      const alive = this.tables.project.find((row) => row.id === values[0] && row.deletedAt == null);
      return Promise.resolve(alive ? [{ id: alive.id as string }] : []);
    }
    return Promise.resolve([]);
  }

  private async acquire(key: string): Promise<() => void> {
    while (this.locks.has(key)) {
      await this.locks.get(key);
    }
    let release!: () => void;
    this.locks.set(
      key,
      new Promise<void>((resolve) => {
        release = () => {
          this.locks.delete(key);
          resolve();
        };
      }),
    );
    return release;
  }

  private delegate(model: string) {
    const rows = () => this.tables[model];
    const matching = (where: Where | undefined) => rows().filter((row) => this.matches(model, row, where ?? {}));
    const uniqueWhere = (where: Where): Where => {
      const composite = COMPOSITE_KEYS[model]?.join('_');
      return composite && where[composite] ? (where[composite] as Where) : where;
    };

    return {
      findFirst: async (args: { where?: Where; include?: Where; select?: Where; orderBy?: unknown } = {}) => {
        const found = matching(args.where)[0];
        return found ? this.hydrate(model, found, args) : null;
      },
      findUnique: async (args: { where: Where; include?: Where }) => {
        const found = matching(uniqueWhere(args.where))[0];
        return found ? this.hydrate(model, found, args) : null;
      },
      findMany: async (
        args: { where?: Where; include?: Where; select?: Where; take?: number; cursor?: { id: string }; skip?: number } = {},
      ) => {
        const sorted = [...matching(args.where)].sort(byNewest);
        let start = 0;

        if (args.cursor) {
          const index = sorted.findIndex((row) => row.id === args.cursor?.id);
          start = index === -1 ? sorted.length : index + (args.skip ?? 0);
        }

        const page = args.take === undefined ? sorted.slice(start) : sorted.slice(start, start + args.take);
        return page.map((row) => this.hydrate(model, row, args));
      },
      count: async (args: { where?: Where } = {}) => matching(args.where).length,
      create: async ({ data }: { data: Row }) => {
        this.assertUnique(model, data);
        return this.insert(model, { ...defaultsFor(model), ...data });
      },
      update: async ({ where, data }: { where: Where; data: Row }) => {
        const row = matching(uniqueWhere(where))[0];
        if (!row) {
          throw new Error(`${model}: registro no encontrado`);
        }
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
      updateMany: async ({ where, data }: { where?: Where; data: Row }) => {
        const targets = matching(where);
        targets.forEach((row) => Object.assign(row, data, { updatedAt: new Date() }));
        return { count: targets.length };
      },
      upsert: async ({ where, create, update }: { where: Where; create: Row; update: Row }) => {
        const row = matching(uniqueWhere(where))[0];
        if (row) {
          return Object.assign(row, update);
        }
        return this.insert(model, { ...defaultsFor(model), ...create });
      },
      deleteMany: async ({ where }: { where?: Where } = {}) => {
        const targets = new Set(matching(where));
        this.tables[model] = rows().filter((row) => !targets.has(row));
        return { count: targets.size };
      },
    };
  }

  private assertUnique(model: string, data: Row): void {
    const keys = COMPOSITE_KEYS[model];

    if (keys && rowsOf(this.tables[model], keys, data)) {
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    }
  }

  private hydrate(model: string, row: Row, args: { include?: Where; select?: Where }): Row {
    const result: Row = { ...row };

    for (const [name, spec] of Object.entries(args.include ?? {})) {
      const relation = RELATIONS[model]?.[name];
      if (!relation || spec === false) {
        continue;
      }
      const related = this.tables[relation.model].filter(
        (candidate) =>
          candidate[relation.foreign] === row[relation.local] &&
          this.matches(relation.model, candidate, (spec as { where?: Where }).where ?? {}),
      );
      result[name] = relation.many ? related : (related[0] ?? null);
    }

    for (const [name, spec] of Object.entries(args.select ?? {})) {
      const relation = RELATIONS[model]?.[name];
      if (relation && typeof spec === 'object' && spec !== null) {
        const related = this.tables[relation.model].filter(
          (candidate) =>
            candidate[relation.foreign] === row[relation.local] &&
            this.matches(relation.model, candidate, (spec as { where?: Where }).where ?? {}),
        );
        result[name] = relation.many ? related : (related[0] ?? null);
      }
    }

    return result;
  }

  private matches(model: string, row: Row, where: Where): boolean {
    return Object.entries(where).every(([key, condition]) => {
      if (key === 'AND') {
        return asList(condition).every((part) => this.matches(model, row, part as Where));
      }
      if (key === 'OR') {
        return asList(condition).some((part) => this.matches(model, row, part as Where));
      }
      if (key === 'NOT') {
        return !asList(condition).some((part) => this.matches(model, row, part as Where));
      }

      const relation = RELATIONS[model]?.[key];
      if (relation) {
        return this.matchesRelation(row, relation, condition as Where);
      }

      return matchesField(row[key], condition);
    });
  }

  private matchesRelation(row: Row, relation: Relation, condition: Where): boolean {
    const related = this.tables[relation.model].filter((candidate) => candidate[relation.foreign] === row[relation.local]);
    const hit = (candidate: Row, filter: Where) => this.matches(relation.model, candidate, filter);

    if (relation.many) {
      return Object.entries(condition).every(([operator, filter]) => {
        switch (operator) {
          case 'some':
            return related.some((candidate) => hit(candidate, filter as Where));
          case 'none':
            return !related.some((candidate) => hit(candidate, filter as Where));
          case 'every':
            return related.every((candidate) => hit(candidate, filter as Where));
          default:
            throw new Error(`Operador de relación no soportado: ${operator}`);
        }
      });
    }

    if ('is' in condition || 'isNot' in condition) {
      const is = condition.is as Where | null | undefined;
      const isNot = condition.isNot as Where | null | undefined;
      const one = related[0];
      return (
        (is === undefined || (is === null ? one === undefined : one !== undefined && hit(one, is))) &&
        (isNot === undefined || (isNot === null ? one !== undefined : one === undefined || !hit(one, isNot)))
      );
    }

    // Filtro directo de relación 1-1 (`project: { ... }`): equivale a `is`.
    return related[0] !== undefined && hit(related[0], condition);
  }
}

function defaultsFor(model: string): Row {
  if (model === 'project') {
    return { deletedAt: null, currentVersionId: null, githubOrgId: null, githubOrgLogin: null };
  }
  return model === 'projectAccess' || model === 'userGithubIdentity' ? {} : { deletedAt: null };
}

function rowsOf(rows: Row[], keys: string[], data: Row): boolean {
  return rows.some((row) => keys.every((key) => row[key] === data[key]));
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function byNewest(a: Row, b: Row): number {
  const left = (a.createdAt as Date | undefined)?.getTime() ?? 0;
  const right = (b.createdAt as Date | undefined)?.getTime() ?? 0;
  return left === right ? String(b.id).localeCompare(String(a.id)) : right - left;
}

function matchesField(value: unknown, condition: unknown): boolean {
  if (condition === null) {
    return value === null || value === undefined;
  }
  if (typeof condition === 'object' && !(condition instanceof Date)) {
    return Object.entries(condition as Where).every(([operator, expected]) => {
      switch (operator) {
        case 'not':
          return expected === null ? value !== null && value !== undefined : value !== expected;
        case 'in':
          return (expected as unknown[]).includes(value);
        case 'notIn':
          return !(expected as unknown[]).includes(value);
        case 'equals':
          return value === expected;
        default:
          throw new Error(`Operador de campo no soportado: ${operator}`);
      }
    });
  }
  return value === condition;
}
