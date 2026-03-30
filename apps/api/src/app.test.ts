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
  it('starts the SSE response before the full assistant turn finishes', async () => {
    let releaseSecondDelta: (() => void) | undefined;
    const secondDeltaGate = new Promise<void>((resolve) => {
      releaseSecondDelta = resolve;
    });

    const { app } = createApp({
      runtime: {
        async *runAssistantTurn() {
          yield {
            version: '2026-03-29',
            type: 'assistant_stream',
            emittedAt: NOW,
            payload: {
              type: 'message_delta',
              delta: '## Summary\n\n'
            }
          };

          await secondDeltaGate;

          yield {
            version: '2026-03-29',
            type: 'assistant_stream',
            emittedAt: NOW,
            payload: {
              type: 'message_delta',
              delta: '- First point\n- Second point'
            }
          };
        }
      } as never
    });

    const responsePromise = app.request('/threads/thread_1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        content: 'Summarize this page.',
        attachments: []
      })
    });

    const outcome = await Promise.race([
      responsePromise.then(() => 'response'),
      new Promise<'timeout'>((resolve) => {
        setTimeout(() => resolve('timeout'), 40);
      })
    ]);

    expect(outcome).toBe('response');

    const response = await responsePromise;
    const reader = response.body?.getReader();

    expect(reader).toBeDefined();

    const firstChunk = await reader?.read();
    const decoded = new TextDecoder().decode(firstChunk?.value);
    expect(decoded).toContain('"type":"message_delta"');
    expect(decoded).toContain('## Summary');

    releaseSecondDelta?.();
  });

  it('returns a structured error when thread creation fails unexpectedly', async () => {
    const { app } = createApp({
      runtime: {
        async createThread() {
          throw new Error('password authentication failed for user "postgres"');
        }
      } as never
    });

    const response = await app.request('/threads', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        title: 'Riv planning'
      })
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'password authentication failed for user "postgres"'
    });
  });

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
    expect(detail.messages[0]?.content).toBe(
      'Please organize what I am looking at.'
    );
    expect(detail.messages[0]?.attachments).toEqual([]);
    expect(detail.actionProposals[0]?.id).toBe('proposal_1');
    expect(detail.actionProposals[0]?.status).toBe('pending');
  });

  it('streams a stateless turn from extension-supplied context without requiring a server thread', async () => {
    const runStatelessAssistantTurn = async function* (input: {
      userId: string;
      thread: { id: string; title: string };
      messages: Array<{ id: string; threadId: string; content: string }>;
      content: string;
      attachments: ContextAttachment[];
    }) {
      expect(input).toMatchObject({
        userId: 'user_dev',
        thread: {
          id: 'thread_local_1',
          title: 'Local Riv thread'
        },
        messages: [
          {
            id: 'message_user_previous',
            threadId: 'thread_local_1',
            content: 'Earlier local question.'
          }
        ],
        content: 'Use my local history only.',
        attachments: [pageAttachment]
      });

      yield {
        version: '2026-03-29',
        type: 'assistant_stream',
        emittedAt: NOW,
        payload: {
          type: 'message_delta',
          delta: 'Using the provided local context.'
        }
      };

      yield {
        version: '2026-03-29',
        type: 'assistant_stream',
        emittedAt: NOW,
        payload: {
          type: 'proposal_created',
          proposal: {
            id: 'proposal_local_1',
            threadId: 'thread_local_1',
            kind: 'groupTabs',
            reason: 'The provided local tabs belong together.',
            preview: {
              title: 'Group local tabs',
              summary: 'Create one group for the local Riv work.',
              items: []
            },
            riskLevel: 'low',
            requiresConfirmation: true,
            payload: {
              tabIds: [4]
            },
            createdAt: NOW
          }
        }
      };
    };

    const { app } = createApp({
      runtime: {
        runStatelessAssistantTurn
      } as never
    });

    const response = await app.request('/turns/stateless', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        thread: {
          id: 'thread_local_1',
          userId: 'user_dev',
          title: 'Local Riv thread',
          createdAt: NOW,
          updatedAt: NOW
        },
        messages: [
          {
            id: 'message_user_previous',
            threadId: 'thread_local_1',
            role: 'user',
            content: 'Earlier local question.',
            attachments: [],
            toolInvocations: [],
            createdAt: NOW
          }
        ],
        content: 'Use my local history only.',
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
    expect(
      envelopes[1]?.payload.type === 'proposal_created'
        ? envelopes[1].payload.proposal.id
        : null
    ).toBe('proposal_local_1');
  });

  it('confirms and rejects action proposals', async () => {
    const { app } = await createTestApp();
    const threadId = await createThread(app);

    const firstTurnResponse = await app.request(
      `/threads/${threadId}/messages`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          content: 'Organize these tabs.',
          attachments: []
        })
      }
    );
    await readStream(firstTurnResponse);

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
    const secondTurnResponse = await app.request(
      `/threads/${secondThreadId}/messages`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          content: 'Organize these tabs too.',
          attachments: []
        })
      }
    );
    await readStream(secondTurnResponse);

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

  it('connects and disconnects Google integrations for dashboard automations', async () => {
    const { app } = await createTestApp();

    const beforeResponse = await app.request('/me/integrations/google');
    expect(beforeResponse.status).toBe(200);
    await expect(beforeResponse.json()).resolves.toMatchObject({
      integration: {
        provider: 'google',
        status: 'disconnected',
        calendarConnected: false,
        gmailConnected: false
      }
    });

    const connectResponse = await app.request('/me/integrations/google/connect', {
      method: 'POST'
    });
    expect(connectResponse.status).toBe(200);
    await expect(connectResponse.json()).resolves.toMatchObject({
      integration: {
        provider: 'google',
        status: 'connected',
        calendarConnected: true,
        gmailConnected: true
      }
    });

    const disconnectResponse = await app.request(
      '/me/integrations/google/disconnect',
      {
        method: 'POST'
      }
    );
    expect(disconnectResponse.status).toBe(200);
    await expect(disconnectResponse.json()).resolves.toMatchObject({
      integration: {
        provider: 'google',
        status: 'disconnected',
        calendarConnected: false,
        gmailConnected: false
      }
    });
  });

  it('returns proactive dashboard overview and automation details', async () => {
    const { app } = await createTestApp();
    await app.request('/me/integrations/google/connect', {
      method: 'POST'
    });

    const overviewResponse = await app.request('/me/dashboard/overview');
    expect(overviewResponse.status).toBe(200);
    const overview = (await overviewResponse.json()) as {
      meetings: Array<{ id: string }>;
      reminders: Array<{ id: string; status: string }>;
      gmailSuggestions: Array<{ id: string; status: string }>;
    };
    expect(overview.meetings.length).toBeGreaterThan(0);
    expect(overview.reminders.length).toBeGreaterThan(0);
    expect(overview.gmailSuggestions.length).toBeGreaterThan(0);
    expect(overview.gmailSuggestions[0]?.status).toBe('new');

    const automationsResponse = await app.request('/me/dashboard/automations');
    expect(automationsResponse.status).toBe(200);
    const automations = (await automationsResponse.json()) as {
      automations: Array<{ key: string; enabled: boolean }>;
      runLogs: Array<{ id: string; automationKey: string }>;
      settings: { meetingReminderOffsetsMinutes: number[] };
    };
    expect(automations.automations.map((item) => item.key)).toContain(
      'meeting-reminders'
    );
    expect(automations.runLogs.length).toBeGreaterThan(0);
    expect(automations.settings.meetingReminderOffsetsMinutes).toEqual([
      1440,
      30
    ]);

    const updateResponse = await app.request('/me/dashboard/automation-settings', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        meetingReminderOffsetsMinutes: [60, 15]
      })
    });
    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({
      settings: {
        meetingReminderOffsetsMinutes: [60, 15]
      }
    });

    const suggestionId = overview.gmailSuggestions[0]?.id;
    expect(suggestionId).toBeDefined();

    const dismissResponse = await app.request(
      `/me/dashboard/suggestions/${suggestionId}/dismiss`,
      {
        method: 'POST'
      }
    );
    expect(dismissResponse.status).toBe(200);
    await expect(dismissResponse.json()).resolves.toMatchObject({
      suggestion: {
        id: suggestionId,
        status: 'dismissed'
      }
    });
  });
});
