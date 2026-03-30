import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageEnvelopeSchema, type ContextAttachment } from '@riv/contracts';

const { openAIStreamMock } = vi.hoisted(() => ({
  openAIStreamMock: vi.fn()
}));

vi.mock('openai', () => {
  class OpenAI {
    responses = {
      stream: openAIStreamMock
    };

    constructor() {}
  }

  return {
    default: OpenAI
  };
});

import {
  MockModelGateway,
  OpenAIModelGateway,
  createAgentRuntime,
  createSequenceIdGenerator
} from './index';
import type { ModelGatewayTurnInput } from './types';

const NOW = '2026-03-29T15:00:00.000Z';

const pageAttachment: ContextAttachment = {
  kind: 'page',
  snapshot: {
    tabId: 12,
    url: 'https://example.com/docs/riv',
    title: 'Riv docs',
    pageType: 'documentation',
    capturedAt: NOW,
    metadata: {
      section: 'api'
    },
    contentBlocks: [
      {
        id: 'intro',
        kind: 'paragraph',
        text: 'Backend notes'
      }
    ]
  }
};

const youtubeAttachment: ContextAttachment = {
  kind: 'page',
  snapshot: {
    tabId: 18,
    url: 'https://www.youtube.com/watch?v=abc123',
    title: 'How Riv Understands Video',
    pageType: 'social',
    capturedAt: NOW,
    metadata: {
      site: 'youtube'
    },
    contentBlocks: [
      {
        id: 'summary',
        kind: 'paragraph',
        text: 'Video overview'
      }
    ],
    media: {
      kind: 'youtube-video',
      videoId: 'abc123',
      channelName: 'Riv Labs',
      description: 'A short explanation of transcript-grounded answers.',
      chapters: [
        {
          title: 'Main idea',
          timestampLabel: '0:32',
          startSeconds: 32
        }
      ],
      transcriptStatus: 'available',
      transcript: [
        {
          timestampLabel: '0:32',
          startSeconds: 32,
          text: 'The speaker says small tools beat sprawling suites.'
        },
        {
          timestampLabel: '1:18',
          startSeconds: 78,
          text: 'They recommend using transcript evidence before the description.'
        }
      ]
    }
  }
};

const youtubeTranscriptFailedAttachment: ContextAttachment = {
  kind: 'page',
  snapshot: {
    tabId: 19,
    url: 'https://www.youtube.com/watch?v=xyz789',
    title: 'Transcript Failure Case',
    pageType: 'social',
    capturedAt: NOW,
    metadata: {
      site: 'youtube'
    },
    contentBlocks: [],
    media: {
      kind: 'youtube-video',
      videoId: 'xyz789',
      channelName: 'Riv Labs',
      description: 'Transcript could not be loaded.',
      chapters: [],
      transcriptStatus: 'failed',
      transcript: [],
      transcriptFailureReason: 'panel-timeout'
    }
  }
};

function createOpenAITextStream(...deltas: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const delta of deltas) {
        yield {
          type: 'response.output_text.delta',
          delta
        };
      }
    }
  };
}

beforeEach(() => {
  openAIStreamMock.mockReset();
});

describe('agent runtime', () => {
  it('streams assistant text incrementally and stores the combined response', async () => {
    const runtime = createAgentRuntime({
      now: () => NOW,
      idGenerator: createSequenceIdGenerator([
        'thread_stream',
        'message_user_stream',
        'message_assistant_stream'
      ]),
      modelGateway: {
        async *streamTurn() {
          yield {
            type: 'message_delta',
            delta: '## Summary\n\n'
          };
          yield {
            type: 'message_delta',
            delta: '- First point\n- Second point'
          };
        }
      } as never
    });

    const thread = await runtime.createThread({
      title: 'Streaming',
      userId: 'user_dev'
    });

    const envelopes = [];
    for await (const envelope of runtime.runAssistantTurn({
      threadId: thread.id,
      userId: 'user_dev',
      content: 'Summarize this page.',
      attachments: [pageAttachment]
    })) {
      envelopes.push(MessageEnvelopeSchema.parse(envelope));
    }

    expect(
      envelopes
        .filter((envelope) => envelope.payload.type === 'message_delta')
        .map((envelope) =>
          envelope.payload.type === 'message_delta'
            ? envelope.payload.delta
            : null
        )
    ).toEqual(['## Summary\n\n', '- First point\n- Second point']);

    const detail = await runtime.getThreadDetail({
      threadId: thread.id,
      userId: 'user_dev'
    });

    expect(detail.messages[1]?.content).toBe(
      '## Summary\n\n- First point\n- Second point'
    );
  });

  it('runs a turn with transient page context and stores the durable conversation state', async () => {
    const runtime = createAgentRuntime({
      now: () => NOW,
      idGenerator: createSequenceIdGenerator([
        'thread_1',
        'message_user_1',
        'message_assistant_1',
        'proposal_1'
      ]),
      modelGateway: new MockModelGateway({
        assistantMessage: 'I can group those Riv tabs for you.',
        proposals: [
          {
            kind: 'groupTabs',
            reason:
              'The documentation tabs are all part of the same research task.',
            preview: {
              title: 'Group Riv research tabs',
              summary: 'Create one tab group for the Riv API docs.',
              items: ['https://example.com/docs/riv']
            },
            riskLevel: 'low',
            payload: {
              tabIds: [12],
              title: 'Riv research'
            }
          }
        ]
      })
    });

    const thread = await runtime.createThread({
      title: 'Riv research',
      userId: 'user_dev'
    });

    const envelopes = [];
    for await (const envelope of runtime.runAssistantTurn({
      threadId: thread.id,
      userId: 'user_dev',
      content: 'Please organize these docs tabs.',
      attachments: [pageAttachment]
    })) {
      envelopes.push(MessageEnvelopeSchema.parse(envelope));
    }

    expect(envelopes.map((envelope) => envelope.payload.type)).toEqual([
      'message_delta',
      'proposal_created'
    ]);

    const detail = await runtime.getThreadDetail({
      threadId: thread.id,
      userId: 'user_dev'
    });

    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[0]?.content).toBe(
      'Please organize these docs tabs.'
    );
    expect(detail.messages[0]?.attachments).toEqual([]);
    expect(detail.messages[1]?.role).toBe('assistant');
    expect(detail.messages[1]?.content).toBe(
      'I can group those Riv tabs for you.'
    );
    expect(detail.actionProposals).toHaveLength(1);
    expect(detail.actionProposals[0]?.status).toBe('pending');
    expect(await runtime.listMemories({ userId: 'user_dev' })).toEqual([]);
  });

  it('runs a stateless turn from extension-supplied context without persisting thread state', async () => {
    let capturedInput: ModelGatewayTurnInput | undefined;

    const threadRepository = {
      create: vi.fn(),
      findById: vi.fn()
    };
    const messageRepository = {
      append: vi.fn(),
      listByThreadId: vi.fn()
    };
    const proposalRepository = {
      create: vi.fn(),
      findById: vi.fn(),
      listByThreadId: vi.fn(),
      update: vi.fn()
    };
    const memoryRepository = {
      create: vi.fn(),
      listByUserId: vi.fn(async () => [
        {
          id: 'memory_existing',
          userId: 'user_dev',
          title: 'Working style',
          content: 'Keep backend changes minimal.',
          createdAt: NOW,
          updatedAt: NOW
        }
      ])
    };

    const runtime = createAgentRuntime({
      now: () => NOW,
      idGenerator: createSequenceIdGenerator([
        'message_user_stateless',
        'proposal_stateless'
      ]),
      modelGateway: new MockModelGateway((input) => {
        capturedInput = input;

        return {
          assistantMessage: 'I can answer from the provided local context.',
          proposals: [
            {
              kind: 'groupTabs',
              reason: 'The provided tabs all relate to the same task.',
              preview: {
                title: 'Group local Riv tabs',
                summary: 'Create one group for the current Riv work.',
                items: ['https://example.com/docs/riv']
              },
              riskLevel: 'low',
              payload: {
                tabIds: [12],
                title: 'Local Riv work'
              }
            }
          ]
        };
      }),
      repositories: {
        threads: threadRepository,
        messages: messageRepository,
        proposals: proposalRepository,
        memories: memoryRepository
      }
    });

    const localThread = {
      id: 'thread_local_1',
      userId: 'user_dev',
      title: 'Local Riv thread',
      createdAt: NOW,
      updatedAt: NOW
    } as const;
    const priorMessages = [
      {
        id: 'message_user_previous',
        threadId: 'thread_local_1',
        role: 'user',
        content: 'Earlier local question.',
        attachments: [],
        toolInvocations: [],
        createdAt: NOW
      },
      {
        id: 'message_assistant_previous',
        threadId: 'thread_local_1',
        role: 'assistant',
        content: 'Earlier local answer.',
        attachments: [],
        toolInvocations: [],
        createdAt: NOW
      }
    ] as const;

    const envelopes = [];
    for await (const envelope of runtime.runStatelessAssistantTurn({
      userId: 'user_dev',
      thread: localThread,
      messages: [...priorMessages],
      content: 'Answer from this local history.',
      attachments: [pageAttachment]
    })) {
      envelopes.push(MessageEnvelopeSchema.parse(envelope));
    }

    expect(envelopes.map((envelope) => envelope.payload.type)).toEqual([
      'message_delta',
      'proposal_created'
    ]);
    expect(
      envelopes[1]?.payload.type === 'proposal_created'
        ? envelopes[1].payload.proposal
        : null
    ).toEqual(
      expect.objectContaining({
        id: 'proposal_stateless',
        threadId: 'thread_local_1'
      })
    );

    expect(capturedInput?.thread).toEqual(localThread);
    expect(capturedInput?.messages).toEqual([
      ...priorMessages,
      expect.objectContaining({
        id: 'message_user_stateless',
        threadId: 'thread_local_1',
        role: 'user',
        content: 'Answer from this local history.',
        attachments: []
      })
    ]);
    expect(capturedInput?.memories).toEqual([
      expect.objectContaining({
        id: 'memory_existing',
        userId: 'user_dev'
      })
    ]);

    expect(threadRepository.findById).not.toHaveBeenCalled();
    expect(messageRepository.append).not.toHaveBeenCalled();
    expect(proposalRepository.create).not.toHaveBeenCalled();
    expect(memoryRepository.listByUserId).toHaveBeenCalledWith('user_dev');
  });

  it('passes YouTube media context to the model and stores transcript-grounded answers with timestamps', async () => {
    let capturedInput: ModelGatewayTurnInput | undefined;

    const runtime = createAgentRuntime({
      now: () => NOW,
      idGenerator: createSequenceIdGenerator([
        'thread_youtube',
        'message_user_youtube',
        'message_assistant_youtube'
      ]),
      modelGateway: new MockModelGateway((input) => {
        capturedInput = input;
        const media =
          input.transientAttachments[0]?.kind === 'page'
            ? input.transientAttachments[0].snapshot.media
            : undefined;
        const firstCue =
          media?.kind === 'youtube-video' ? media.transcript[0] : undefined;

        return {
          assistantMessage: firstCue
            ? `## Thesis\n\n${firstCue.text} (${firstCue.timestampLabel}).`
            : 'Transcript unavailable, so I can only rely on the video metadata.',
          proposals: []
        };
      })
    });

    const thread = await runtime.createThread({
      title: 'YouTube evidence',
      userId: 'user_dev'
    });

    for await (const envelope of runtime.runAssistantTurn({
      threadId: thread.id,
      userId: 'user_dev',
      content: 'What is the main claim of this video?',
      attachments: [youtubeAttachment]
    })) {
      expect(MessageEnvelopeSchema.parse(envelope).payload.type).toBe(
        'message_delta'
      );
    }

    expect(capturedInput?.transientAttachments).toEqual([youtubeAttachment]);

    const detail = await runtime.getThreadDetail({
      threadId: thread.id,
      userId: 'user_dev'
    });

    expect(detail.messages[1]?.content).toContain('0:32');
    expect(detail.messages[1]?.content).toContain(
      'small tools beat sprawling suites'
    );
  });

  it('stores concise fallback wording when a YouTube transcript is unavailable', async () => {
    const runtime = createAgentRuntime({
      now: () => NOW,
      idGenerator: createSequenceIdGenerator([
        'thread_youtube_fallback',
        'message_user_youtube_fallback',
        'message_assistant_youtube_fallback'
      ]),
      modelGateway: new MockModelGateway((input) => {
        const media =
          input.transientAttachments[0]?.kind === 'page'
            ? input.transientAttachments[0].snapshot.media
            : undefined;

        return {
          assistantMessage:
            media?.kind === 'youtube-video' &&
            media.transcriptStatus !== 'available'
              ? 'Transcript unavailable, so I can only rely on the title and description.'
              : 'Transcript evidence is available.',
          proposals: []
        };
      })
    });

    const thread = await runtime.createThread({
      title: 'YouTube fallback',
      userId: 'user_dev'
    });

    for await (const envelope of runtime.runAssistantTurn({
      threadId: thread.id,
      userId: 'user_dev',
      content: 'Can you summarize this video?',
      attachments: [youtubeTranscriptFailedAttachment]
    })) {
      expect(MessageEnvelopeSchema.parse(envelope).payload.type).toBe(
        'message_delta'
      );
    }

    const detail = await runtime.getThreadDetail({
      threadId: thread.id,
      userId: 'user_dev'
    });

    expect(detail.messages[1]?.content).toContain('Transcript unavailable');
    expect(detail.messages[1]?.content).toContain('title and description');
  });

  it('confirms and rejects proposals with deterministic execution results', async () => {
    const runtime = createAgentRuntime({
      now: () => NOW,
      idGenerator: createSequenceIdGenerator([
        'thread_confirm',
        'message_user_confirm',
        'message_assistant_confirm',
        'proposal_confirm',
        'thread_reject',
        'message_user_reject',
        'message_assistant_reject',
        'proposal_reject'
      ]),
      modelGateway: new MockModelGateway({
        assistantMessage: 'I have a proposed tab action.',
        proposals: [
          {
            kind: 'closeTabs',
            reason: 'These look duplicated.',
            preview: {
              title: 'Close duplicate tabs',
              summary: 'Remove the duplicate entries.',
              items: ['https://example.com/duplicate']
            },
            riskLevel: 'medium',
            payload: {
              tabIds: [7, 8]
            }
          }
        ]
      })
    });

    const confirmThread = await runtime.createThread({
      title: 'Confirm flow',
      userId: 'user_dev'
    });

    for await (const envelope of runtime.runAssistantTurn({
      threadId: confirmThread.id,
      userId: 'user_dev',
      content: 'Handle the duplicate tabs.',
      attachments: []
    })) {
      expect(envelope).toBeDefined();
    }

    const confirmation = await runtime.confirmActionProposal({
      actorUserId: 'user_dev',
      proposalId: 'proposal_confirm',
      threadId: confirmThread.id
    });

    expect(confirmation.confirmation.decision).toBe('confirm');
    expect(confirmation.result.status).toBe('executed');
    expect(confirmation.result.affectedTabs.map((tab) => tab.tabId)).toEqual([
      7, 8
    ]);

    const rejectThread = await runtime.createThread({
      title: 'Reject flow',
      userId: 'user_dev'
    });

    for await (const envelope of runtime.runAssistantTurn({
      threadId: rejectThread.id,
      userId: 'user_dev',
      content: 'Maybe close the duplicate tabs.',
      attachments: []
    })) {
      expect(envelope).toBeDefined();
    }

    const rejection = await runtime.rejectActionProposal({
      actorUserId: 'user_dev',
      proposalId: 'proposal_reject',
      threadId: rejectThread.id
    });

    expect(rejection.confirmation.decision).toBe('reject');
    expect(rejection.result.status).toBe('rejected');
  });

  it('persists explicit memories only when requested', async () => {
    const runtime = createAgentRuntime({
      now: () => NOW,
      idGenerator: createSequenceIdGenerator(['memory_1']),
      modelGateway: new MockModelGateway({
        assistantMessage: 'No action needed.',
        proposals: []
      })
    });

    const created = await runtime.createMemory({
      userId: 'user_dev',
      title: 'Working style',
      content: 'Prefers grouping tabs by project.'
    });

    expect(created.title).toBe('Working style');

    const memories = await runtime.listMemories({ userId: 'user_dev' });
    expect(memories).toEqual([
      expect.objectContaining({
        id: 'memory_1',
        userId: 'user_dev',
        title: 'Working style',
        content: 'Prefers grouping tabs by project.'
      })
    ]);
  });
});

describe('openai model gateway', () => {
  it('serializes YouTube media context and transcript-first guidance into the model request', async () => {
    openAIStreamMock.mockReturnValue(
      createOpenAITextStream('## Thesis\n\nUse transcript evidence first.')
    );

    const gateway = new OpenAIModelGateway({
      apiKey: 'test-key'
    });

    const input: ModelGatewayTurnInput = {
      thread: {
        id: 'thread_openai',
        userId: 'user_dev',
        title: 'YouTube request',
        createdAt: NOW,
        updatedAt: NOW
      },
      messages: [],
      userMessage: {
        id: 'message_user_openai',
        threadId: 'thread_openai',
        role: 'user',
        content: 'What is this video arguing?',
        attachments: [],
        toolInvocations: [],
        createdAt: NOW
      },
      transientAttachments: [youtubeAttachment],
      memories: []
    };

    const deltas: string[] = [];
    for await (const event of gateway.streamTurn(input)) {
      if (event.type === 'message_delta') {
        deltas.push(event.delta);
      }
    }

    expect(deltas.join('')).toContain('Use transcript evidence first.');
    expect(openAIStreamMock).toHaveBeenCalledTimes(1);

    const request = openAIStreamMock.mock.calls[0]?.[0] as {
      input: Array<{
        content: Array<{
          text: string;
        }>;
      }>;
    };

    const systemText = request.input[0]?.content[0]?.text ?? '';
    const serializedInput = request.input[1]?.content[0]?.text ?? '';

    expect(systemText).toContain(
      'Prefer transcript evidence over description inference for YouTube media.'
    );
    expect(systemText).toContain(
      'Summarize the video thesis first, then support it with concise evidence.'
    );
    expect(systemText).toContain('Include timestamps when available.');
    expect(systemText).toContain(
      'Acknowledge when a transcript is unavailable or failed.'
    );
    expect(serializedInput).toContain('"kind":"youtube-video"');
    expect(serializedInput).toContain('"transcriptStatus":"available"');
    expect(serializedInput).toContain('"timestampLabel":"0:32"');
  });
});
