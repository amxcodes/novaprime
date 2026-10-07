import { AsyncLocalStorage } from "node:async_hooks";
import { Client, Pool, type PoolClient } from "pg";
import {
  instrumentDatabaseClient,
  instrumentDatabasePool,
  measureDatabasePoolAcquisition,
} from "./database-diagnostics.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DatabaseRequestContext = Readonly<{
  userId: string;
  organisationId: string;
}>;

type DatabaseTransaction = PoolClient;

let connection: Pool | undefined;
const requestDatabase = new AsyncLocalStorage<Pool>();

function poolSize(): number {
  const configured = Number(process.env.NOVA_DB_POOL_MAX ?? 10);
  return Number.isInteger(configured) && configured >= 1 && configured <= 50
    ? configured
    : 10;
}

export function observeIdleDatabaseErrors(pool: {
  on(event: "error", listener: (error: Error) => void): unknown;
}): void {
  pool.on("error", (error) => {
    const code = "code" in error && typeof error.code === "string" ? error.code : "UNKNOWN";
    console.error("NOVA_DATABASE_IDLE_CONNECTION_ERROR", code);
  });
}

export function databaseRequestContext(
  userId: string,
  organisationId: string,
): DatabaseRequestContext {
  if (!uuidPattern.test(userId) || !uuidPattern.test(organisationId)) {
    throw new Error("DATABASE_REQUEST_CONTEXT_INVALID");
  }

  return Object.freeze({ userId, organisationId });
}

export function database(): Pool {
  return databaseProxy;
}

function defaultDatabase(): Pool {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL_REQUIRED");
  }

  if (!connection) {
    connection = instrumentDatabasePool(new Pool({ connectionString: databaseUrl, max: poolSize() }), "nova");
    observeIdleDatabaseErrors(connection);
  }
  return connection;
}

const databaseProxy = new Proxy({} as Pool, {
  get(_target, property) {
    const selected = requestDatabase.getStore() ?? defaultDatabase();
    const value = Reflect.get(selected, property, selected) as unknown;
    return typeof value === "function" ? value.bind(selected) : value;
  },
});

/**
 * Cloudflare Hyperdrive owns its long-lived PostgreSQL pool. A Worker request
 * gets a short-lived node-postgres client (not an isolate-global Pool), while
 * the existing NOVA domain and Better Auth code keep using the same Pool API.
 */
class RequestScopedDatabasePool {
  private queryClient: Client | undefined;
  private queryClientPromise: Promise<Client> | undefined;
  private readonly clients = new Set<Client>();
  private readonly closing = new Set<Promise<void>>();

  constructor(private readonly connectionString: string) {}

  private async openClient(): Promise<Client> {
    const client = new Client({ connectionString: this.connectionString });
    client.on("error", (error) => {
      const code = "code" in error && typeof error.code === "string" ? error.code : "UNKNOWN";
      console.error("NOVA_DATABASE_REQUEST_CONNECTION_ERROR", code);
    });
    try {
      await measureDatabasePoolAcquisition("nova", () => client.connect());
      this.clients.add(client);
      return instrumentDatabaseClient(client as unknown as PoolClient, "nova") as unknown as Client;
    } catch (error) {
      await client.end().catch(() => undefined);
      throw error;
    }
  }

  private async queryConnection(): Promise<Client> {
    if (!this.queryClientPromise) {
      this.queryClientPromise = this.openClient().then((client) => {
        this.queryClient = client;
        return client;
      });
    }
    return this.queryClientPromise;
  }

  query(...args: Parameters<Pool["query"]>): ReturnType<Pool["query"]> {
    return this.queryConnection().then((client) =>
      client.query(...args as Parameters<Client["query"]>),
    ) as unknown as ReturnType<Pool["query"]>;
  }

  async connect(): Promise<PoolClient> {
    const client = await this.openClient();
    let released = false;
    Object.defineProperty(client, "release", {
      configurable: false,
      value: () => {
        if (released) return;
        released = true;
        void this.closeClient(client);
      },
    });
    return client as PoolClient;
  }

  on(event: "error", listener: (error: Error) => void): this {
    for (const client of this.clients) client.on(event, listener);
    return this;
  }

  private closeClient(client: Client): Promise<void> {
    this.clients.delete(client);
    if (this.queryClient === client) this.queryClient = undefined;
    const closing = client.end().catch(() => undefined).finally(() => this.closing.delete(closing));
    this.closing.add(closing);
    return closing;
  }

  async end(): Promise<void> {
    await Promise.all([...this.clients].map((client) => this.closeClient(client)));
    await Promise.all([...this.closing]);
  }
}

export async function withRequestScopedDatabase<T>(
  connectionString: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!connectionString) throw new Error("DATABASE_URL_REQUIRED");
  const scoped = new RequestScopedDatabasePool(connectionString);
  try {
    return await requestDatabase.run(scoped as unknown as Pool, operation);
  } finally {
    await scoped.end();
  }
}

export async function withDatabaseRequest<T>(
  context: DatabaseRequestContext,
  operation: (transaction: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  const transaction = await database().connect();

  try {
    await transaction.query("BEGIN");
    await transaction.query(
      `SELECT
        set_config('nova.user_id', $1, true),
        set_config('nova.organisation_id', $2, true)`,
      [context.userId, context.organisationId],
    );

    const result = await operation(transaction);
    await transaction.query("COMMIT");
    return result;
  } catch (error) {
    await transaction.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    transaction.release();
  }
}
