import {
  MockModelGateway,
  OpenAIModelGateway,
  createAgentRuntime
} from '@riv/agent';
import { serve } from '@hono/node-server';

import { createApp } from './app';
import { createPersistenceLayer } from './db/persistence';

function createDefaultModelGateway() {
  if (process.env.OPENAI_API_KEY) {
    return new OpenAIModelGateway({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  return new MockModelGateway({
    assistantMessage:
      'Riv backend is running with the deterministic mock gateway.',
    proposals: []
  });
}

const persistence = createPersistenceLayer({
  databaseUrl: process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL
});

const runtime = createAgentRuntime({
  modelGateway: createDefaultModelGateway(),
  repositories: persistence.repositories
});

const { app } = createApp({
  runtime
});

serve(
  {
    fetch: app.fetch,
    port: Number(process.env.PORT ?? 3000)
  },
  (info) => {
    console.log(
      `Riv API listening on http://localhost:${info.port} using ${persistence.kind} persistence.`
    );
  }
);
