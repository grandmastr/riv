import { describe, expect, it } from 'vitest';

import { MessageEnvelopeSchema, type ContextAttachment } from '@riv/contracts';
import {
  MockModelGateway,
  createAgentRuntime,
  createSequenceIdGenerator
} from '@riv/agent';

import { createApp } from './app';

const NOW = '2026-03-29T15:00:00.000Z';

const pageAttachment: ContextAttachment = {
  kind: 'page',
  snapshot: {
    tabId: 4,
    url: 'https://example.com/search?q=riv',
    title: 'Riv search',
    pageType: 'search',
    capturedAt: NOW,
    metadata: {
      query: 'riv'
    },
    contentBlocks: [
      {
        id: 'search-result',
        kind: 'paragraph',
        text: 'Useful Riv result'
      }
    ]
  }
};

async function createTestApp() {
  const runtime = createAgentRuntime({
    now: () => NOW,
    idGenerator: createSequenceIdGenerator([
      'thread_1',
      'message_user_1',
      'message_assistant_1',
      'proposal_1',
      'memory_1',
      'thread_2',
      'message_user_2',
      'message_assistant_2',
      'proposal_2'
    ]),
    modelGateway: new MockModelGateway({
      assistantMessage: 'I can help organize that browsing context.',
      proposals: [
        {
          kind: 'groupTabs',
          reason: 'The open pages all relate to Riv backend work.',
          preview: {
            title: 'Group Riv work tabs',
            summary: 'Collect the Riv tabs into one group.',
            items: ['https://example.com/search?q=riv']
          },
          riskLevel: 'low',
          payload: {
            tabIds: [4],
            title: 'Riv backend'
          }
        }
      ]
    })
  });

  return createApp({ runtime, now: () => NOW });
}

async function createThread(app: ReturnType<typeof createApp>['app']) {
  const response = await app.request('/threads', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      title: 'Riv thread'
    })
  });

  const payload = (await response.json()) as { thread: { id: string } };
  return payload.thread.id;
}

async function readStream(response: Response) {
  const text = await response.text();
  return text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice(6)))
    .map((envelope) => MessageEnvelopeSchema.parse(envelope));
}

describe('api app', () => {
  it('creates and fetches threads for the deterministic dev viewer', async () => {
    const { app } = await createTestApp();

    const createResponse = await app.request('/threads', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        title: 'Riv planning'
      })
    });

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      thread: { id: string; userId: string; title: string };
    };
    expect(created.thread.userId).toBe('user_dev');
    expect(created.thread.title).toBe('Riv planning');

    const getResponse = await app.request(`/threads/${created.thread.id}`);
    expect(getResponse.status).toBe(200);

    const detail = (await getResponse.json()) as {
      thread: { id: string };
      messages: unknown[];
      actionProposals: unknown[];
    };

    expect(detail.thread.id).toBe(created.thread.id);
    expect(detail.messages).toEqual([]);
    expect(detail.actionProposals).toEqual([]);
  });

  it('streams assistant events and keeps raw page context transient', async () => {
    const { app } = await createTestApp();
    const threadId = await createThread(app);

    const response = await app.request(`/threads/${threadId}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        content: 'Please organize what I am looking at.',
        attachments: [pageAttachment]
      })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const envelopes = await readStream(response);
    expect(envelopes.map((envelope) => envelope.payload.type)).toEqual([
      'message_delta',
      'proposal_created'
    ]);

    const detailResponse = await app.request(`/threads/${threadId}`);
    const detail = (await detailResponse.json()) as {
      messages: Array<{ content: string; attachments: unknown[] }>;
      actionProposals: Array<{ id: string; status: string }>;
    };

    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[0]?.content).toBe('Please organize what I am looking at.');
    expect(detail.messages[0]?.attachments).toEqual([]);
    expect(detail.actionProposals[0]?.id).toBe('proposal_1');
    expect(detail.actionProposals[0]?.status).toBe('pending');
  });

  it('confirms and rejects action proposals', async () => {
    const { app } = await createTestApp();
    const threadId = await createThread(app);

    await app.request(`/threads/${threadId}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        content: 'Organize these tabs.',
        attachments: []
      })
    });

    const confirmResponse = await app.request(
      `/threads/${threadId}/action-proposals/proposal_1/confirm`,
      {
        method: 'POST'
      }
    );

    expect(confirmResponse.status).toBe(200);
    const confirmed = (await confirmResponse.json()) as {
      result: { status: string };
      confirmation: { decision: string };
    };
    expect(confirmed.confirmation.decision).toBe('confirm');
    expect(confirmed.result.status).toBe('executed');

    const secondThreadId = await createThread(app);
    await app.request(`/threads/${secondThreadId}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        content: 'Organize these tabs too.',
        attachments: []
      })
    });

    const rejectResponse = await app.request(
      `/threads/${secondThreadId}/action-proposals/proposal_2/reject`,
      {
        method: 'POST'
      }
    );

    expect(rejectResponse.status).toBe(200);
    const rejected = (await rejectResponse.json()) as {
      result: { status: string };
      confirmation: { decision: string };
    };
    expect(rejected.confirmation.decision).toBe('reject');
    expect(rejected.result.status).toBe('rejected');
  });

  it('creates and lists explicit memories', async () => {
    const { app } = await createTestApp();

    const beforeResponse = await app.request('/me/memories');
    expect(beforeResponse.status).toBe(200);
    const before = (await beforeResponse.json()) as { memories: unknown[] };
    expect(before.memories).toEqual([]);

    const createResponse = await app.request('/me/memories', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        title: 'Tab preference',
        content: 'Keep Riv work grouped together.'
      })
    });

    expect(createResponse.status).toBe(201);

    const afterResponse = await app.request('/me/memories');
    const after = (await afterResponse.json()) as {
      memories: Array<{ id: string; title: string; content: string }>;
    };

    expect(after.memories).toEqual([
      {
        id: 'memory_1',
        title: 'Tab preference',
        content: 'Keep Riv work grouped together.',
        userId: 'user_dev',
        createdAt: NOW,
        updatedAt: NOW
      }
    ]);
  });
});
