import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../../../../drizzle/schema';

export function createDatabaseClient(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    prepare: false
  });

  const db = drizzle(client, {
    schema
  });

  return {
    client,
    db
  };
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;
export type RivDatabase = DatabaseClient['db'];
