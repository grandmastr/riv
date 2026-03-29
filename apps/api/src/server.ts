import { MockModelGateway, OpenAIModelGateway, createAgentRuntime } from '@riv/agent';
import { serve } from '@hono/node-server';

import { createApp } from './app';

function createDefaultModelGateway() {
  if (process.env.OPENAI_API_KEY) {
    return new OpenAIModelGateway({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  return new MockModelGateway({
    assistantMessage: 'Riv backend is running with the deterministic mock gateway.',
    proposals: []
  });
}

const runtime = createAgentRuntime({
  modelGateway: createDefaultModelGateway()
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
    console.log(`Riv API listening on http://localhost:${info.port}`);
  }
);
