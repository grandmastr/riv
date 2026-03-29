import type { AgentRuntimeOptions } from '@riv/agent';

import { createDatabaseClient } from './client';
import {
  DrizzleActionProposalRepository,
  DrizzleMemoryRepository,
  DrizzleMessageRepository,
  DrizzleThreadRepository
} from './repositories';

type RuntimeRepositories = NonNullable<AgentRuntimeOptions['repositories']>;

type SupabasePersistenceLayer = {
  kind: 'supabase';
  repositories: RuntimeRepositories;
  dispose: () => Promise<void>;
};

type MemoryPersistenceLayer = {
  kind: 'memory';
  repositories?: undefined;
};

export type PersistenceLayer =
  | SupabasePersistenceLayer
  | MemoryPersistenceLayer;

export function createPersistenceLayer(options: {
  databaseUrl?: string | null;
}): PersistenceLayer {
  const databaseUrl = options.databaseUrl?.trim();

  if (!databaseUrl) {
    return {
      kind: 'memory'
    };
  }

  const { client, db } = createDatabaseClient(databaseUrl);

  return {
    kind: 'supabase',
    repositories: {
      threads: new DrizzleThreadRepository(db),
      messages: new DrizzleMessageRepository(db),
      proposals: new DrizzleActionProposalRepository(db),
      memories: new DrizzleMemoryRepository(db)
    },
    dispose: async () => {
      await client.end();
    }
  };
}
