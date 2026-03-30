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
import type { ModelGatewayStreamEvent, ModelGatewayTurnInput } from './types';

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

function createOpenAIEventStream(events: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
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

  it('forwards tool lifecycle stream events with invocation metadata', async () => {
    const runtime = createAgentRuntime({
      now: () => NOW,
      idGenerator: createSequenceIdGenerator([
        'thread_tool_stream',
        'message_user_tool_stream',
        'message_assistant_tool_stream'
      ]),
      modelGateway: {
        async *streamTurn() {
          yield {
            type: 'tool_started',
            invocation: {
              id: 'tool_web_search_1',
              tool: 'searchWeb',
              kind: 'read',
              args: {
                query: 'CH alternatives'
              }
            }
          };
          yield {
            type: 'tool_finished',
            invocation: {
              id: 'tool_web_search_1',
              tool: 'searchWeb',
              kind: 'read',
              args: {
                query: 'CH alternatives'
              },
              result: {
                status: 'completed'
              }
            }
          };
          yield {
            type: 'message_delta',
            delta: 'Done searching.'
          };
        }
      } as never
    });

    const thread = await runtime.createThread({
      title: 'Tool stream',
      userId: 'user_dev'
    });

    const envelopes = [];
    for await (const envelope of runtime.runAssistantTurn({
      threadId: thread.id,
      userId: 'user_dev',
      content: 'Search the web.',
      attachments: []
    })) {
      envelopes.push(MessageEnvelopeSchema.parse(envelope));
    }

    expect(envelopes.map((envelope) => envelope.payload.type)).toEqual([
      'tool_started',
      'tool_finished',
      'message_delta'
    ]);
    expect(
      envelopes[0]?.payload.type === 'tool_started'
        ? envelopes[0].payload.invocation.state
        : null
    ).toBe('started');
    expect(
      envelopes[1]?.payload.type === 'tool_finished'
        ? envelopes[1].payload.invocation.state
        : null
    ).toBe('completed');
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
      tools?: Array<Record<string, unknown>>;
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
      'If the user asks about video or page content, summarize the main point first and support it with concise evidence.'
    );
    expect(systemText).toContain(
      'If the user asks for a browser action or operational task, fulfill that request directly and do not preface the reply with a page or video summary unless they asked for one.'
    );
    expect(systemText).toContain(
      'When the user requests a supported tab-management action and the provided context includes enough tab or tab-group information, call create_action_proposal with the exact action you recommend.'
    );
    expect(systemText).toContain(
      'For YouTube/video summaries, do not call out transcript availability, transcript failures, or extraction internals unless the user explicitly asks.'
    );
    expect(systemText).not.toContain(
      'When the user explicitly asks for transcript details, include timestamps when available.'
    );
    const actionTool = request.tools?.find(
      (tool) => tool.name === 'create_action_proposal'
    ) as
      | {
          strict?: boolean;
          parameters?: {
            properties?: {
              payload?: {
                additionalProperties?: boolean;
              };
            };
          };
        }
      | undefined;
    const webSearchEnabled = request.tools?.some(
      (tool) => tool.type === 'web_search_preview'
    );

    expect(actionTool).toBeDefined();
    expect(actionTool?.strict).toBe(false);
    expect(
      actionTool?.parameters?.properties?.payload?.additionalProperties
    ).toBe(true);
    expect(webSearchEnabled).toBe(false);
    expect(serializedInput).toContain('"kind":"youtube-video"');
    expect(serializedInput).toContain('"transcriptStatus":"available"');
    expect(serializedInput).toContain('"timestampLabel":"0:32"');
  });

  it('adds transcript-meta instructions only when the user explicitly asks for transcript details', async () => {
    openAIStreamMock.mockReturnValue(
      createOpenAITextStream('Here are the key transcript timestamps.')
    );

    const gateway = new OpenAIModelGateway({
      apiKey: 'test-key'
    });

    const input: ModelGatewayTurnInput = {
      thread: {
        id: 'thread_openai_transcript_request',
        userId: 'user_dev',
        title: 'Transcript request',
        createdAt: NOW,
        updatedAt: NOW
      },
      messages: [],
      userMessage: {
        id: 'message_user_openai_transcript_request',
        threadId: 'thread_openai_transcript_request',
        role: 'user',
        content: 'Give me transcript timestamps and exact quotes from this video.',
        attachments: [],
        toolInvocations: [],
        createdAt: NOW
      },
      transientAttachments: [youtubeAttachment],
      memories: []
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _event of gateway.streamTurn(input)) {
      // Exhaust the stream so the request is captured.
    }

    const request = openAIStreamMock.mock.calls[0]?.[0] as {
      input: Array<{
        content: Array<{
          text: string;
        }>;
      }>;
    };

    const systemText = request.input[0]?.content[0]?.text ?? '';

    expect(systemText).toContain(
      'When the user explicitly asks for transcript details, include timestamps when available.'
    );
    expect(systemText).toContain(
      'If transcript data is missing for a transcript-specific request, state that clearly and then continue with the best available evidence.'
    );
  });

  it('prioritizes explicit browser actions over page or video summaries', async () => {
    openAIStreamMock.mockReturnValue(
      createOpenAITextStream('I can help group the tabs.')
    );

    const gateway = new OpenAIModelGateway({
      apiKey: 'test-key'
    });

    const input: ModelGatewayTurnInput = {
      thread: {
        id: 'thread_action',
        userId: 'user_dev',
        title: 'Browser action',
        createdAt: NOW,
        updatedAt: NOW
      },
      messages: [],
      userMessage: {
        id: 'message_user_action',
        threadId: 'thread_action',
        role: 'user',
        content: 'Group the browser tabs.',
        attachments: [],
        toolInvocations: [],
        createdAt: NOW
      },
      transientAttachments: [youtubeAttachment],
      memories: []
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _event of gateway.streamTurn(input)) {
      // Exhaust the stream so the request is captured.
    }

    expect(openAIStreamMock).toHaveBeenCalledTimes(1);

    const request = openAIStreamMock.mock.calls[0]?.[0] as {
      input: Array<{
        content: Array<{
          text: string;
        }>;
      }>;
    };

    const systemText = request.input[0]?.content[0]?.text ?? '';

    expect(systemText).toContain(
      'If the user asks for a browser action or operational task, fulfill that request directly and do not preface the reply with a page or video summary unless they asked for one.'
    );
    expect(systemText).not.toContain(
      'Summarize the video thesis first, then support it with concise evidence.'
    );
  });

  it('enables web-search tooling for explicit web lookup requests', async () => {
    openAIStreamMock.mockReturnValue(
      createOpenAITextStream('Searching the web for current options.')
    );

    const gateway = new OpenAIModelGateway({
      apiKey: 'test-key'
    });

    const input: ModelGatewayTurnInput = {
      thread: {
        id: 'thread_web_lookup_tools',
        userId: 'user_dev',
        title: 'Web lookup',
        createdAt: NOW,
        updatedAt: NOW
      },
      messages: [],
      userMessage: {
        id: 'message_user_web_lookup_tools',
        threadId: 'thread_web_lookup_tools',
        role: 'user',
        content: 'Search the web for current CH alternatives and prices.',
        attachments: [],
        toolInvocations: [],
        createdAt: NOW
      },
      transientAttachments: [pageAttachment],
      memories: []
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _event of gateway.streamTurn(input)) {
      // Exhaust the stream so the request is captured.
    }

    const request = openAIStreamMock.mock.calls[0]?.[0] as {
      tools?: Array<Record<string, unknown>>;
    };

    const webSearchEnabled = request.tools?.some(
      (tool) => tool.type === 'web_search_preview'
    );
    const webSearchTool = request.tools?.find(
      (tool) => tool.type === 'web_search_preview'
    ) as { search_context_size?: string } | undefined;

    expect(webSearchEnabled).toBe(true);
    expect(webSearchTool?.search_context_size).toBe('medium');
  });

  it('enables web-search tooling for first-hint discovery requests', async () => {
    openAIStreamMock.mockReturnValue(
      createOpenAITextStream('I will rank the top videos with links.')
    );

    const gateway = new OpenAIModelGateway({
      apiKey: 'test-key'
    });

    const input: ModelGatewayTurnInput = {
      thread: {
        id: 'thread_discovery_first_hint',
        userId: 'user_dev',
        title: 'Discovery first hint',
        createdAt: NOW,
        updatedAt: NOW
      },
      messages: [],
      userMessage: {
        id: 'message_user_discovery_first_hint',
        threadId: 'thread_discovery_first_hint',
        role: 'user',
        content:
          'Top 3 Vinh Giang videos about communication ranked by relevance with links.',
        attachments: [],
        toolInvocations: [],
        createdAt: NOW
      },
      transientAttachments: [],
      memories: []
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _event of gateway.streamTurn(input)) {
      // Exhaust the stream so the request is captured.
    }

    const request = openAIStreamMock.mock.calls[0]?.[0] as {
      tools?: Array<Record<string, unknown>>;
    };

    const webSearchEnabled = request.tools?.some(
      (tool) => tool.type === 'web_search_preview'
    );

    expect(webSearchEnabled).toBe(true);
  });

  it('adds direct YouTube link policy instructions for YouTube link requests', async () => {
    openAIStreamMock.mockReturnValue(
      createOpenAITextStream('Retrying YouTube search with direct links.')
    );

    const gateway = new OpenAIModelGateway({
      apiKey: 'test-key'
    });

    const input: ModelGatewayTurnInput = {
      thread: {
        id: 'thread_youtube_links_policy',
        userId: 'user_dev',
        title: 'YouTube links',
        createdAt: NOW,
        updatedAt: NOW
      },
      messages: [
        {
          id: 'message_user_youtube_prior',
          threadId: 'thread_youtube_links_policy',
          role: 'user',
          content:
            'Search YouTube for Vinh Giang communication videos and return top 3.',
          attachments: [],
          toolInvocations: [],
          createdAt: NOW
        }
      ],
      userMessage: {
        id: 'message_user_youtube_retry',
        threadId: 'thread_youtube_links_policy',
        role: 'user',
        content: 'Retry the yt search and give direct YouTube links only.',
        attachments: [],
        toolInvocations: [],
        createdAt: NOW
      },
      transientAttachments: [],
      memories: []
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _event of gateway.streamTurn(input)) {
      // Exhaust the stream so the request is captured.
    }

    const request = openAIStreamMock.mock.calls[0]?.[0] as {
      input: Array<{
        content: Array<{
          text: string;
        }>;
      }>;
    };

    const systemText = request.input[0]?.content[0]?.text ?? '';

    expect(systemText).toContain(
      'For YouTube requests, only present direct YouTube video links'
    );
    expect(systemText).toContain(
      'Do not present transcript mirrors or summary sites as the primary video links.'
    );
    expect(systemText).toContain(
      'If direct YouTube URLs are not available in search results, explicitly say that and ask to retry; do not claim success.'
    );
  });

  it('does not add direct YouTube link policy instructions for general web lookups', async () => {
    openAIStreamMock.mockReturnValue(
      createOpenAITextStream('Searching the web for current options.')
    );

    const gateway = new OpenAIModelGateway({
      apiKey: 'test-key'
    });

    const input: ModelGatewayTurnInput = {
      thread: {
        id: 'thread_general_web_lookup_policy',
        userId: 'user_dev',
        title: 'General web lookup',
        createdAt: NOW,
        updatedAt: NOW
      },
      messages: [],
      userMessage: {
        id: 'message_user_general_web_lookup_policy',
        threadId: 'thread_general_web_lookup_policy',
        role: 'user',
        content: 'Search the web for current CH alternatives and prices.',
        attachments: [],
        toolInvocations: [],
        createdAt: NOW
      },
      transientAttachments: [],
      memories: []
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _event of gateway.streamTurn(input)) {
      // Exhaust the stream so the request is captured.
    }

    const request = openAIStreamMock.mock.calls[0]?.[0] as {
      input: Array<{
        content: Array<{
          text: string;
        }>;
      }>;
    };

    const systemText = request.input[0]?.content[0]?.text ?? '';

    expect(systemText).not.toContain(
      'For YouTube requests, only present direct YouTube video links'
    );
  });

  it('keeps web-search tooling enabled for follow-up confirmations after a search request', async () => {
    openAIStreamMock.mockReturnValue(
      createOpenAITextStream('I will run the web search now.')
    );

    const gateway = new OpenAIModelGateway({
      apiKey: 'test-key'
    });

    const input: ModelGatewayTurnInput = {
      thread: {
        id: 'thread_web_lookup_followup',
        userId: 'user_dev',
        title: 'Web lookup follow-up',
        createdAt: NOW,
        updatedAt: NOW
      },
      messages: [
        {
          id: 'message_user_web_lookup_prior',
          threadId: 'thread_web_lookup_followup',
          role: 'user',
          content:
            'Search YouTube for Vinh Giang videos about communication and give me the top 3 by relevance.',
          attachments: [],
          toolInvocations: [],
          createdAt: NOW
        },
        {
          id: 'message_assistant_web_lookup_prior',
          threadId: 'thread_web_lookup_followup',
          role: 'assistant',
          content:
            'Ready — I can search YouTube and return the top 3 with links and timestamps.',
          attachments: [],
          toolInvocations: [],
          createdAt: NOW
        }
      ],
      userMessage: {
        id: 'message_user_web_lookup_followup',
        threadId: 'thread_web_lookup_followup',
        role: 'user',
        content: 'Go ahread',
        attachments: [],
        toolInvocations: [],
        createdAt: NOW
      },
      transientAttachments: [],
      memories: []
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _event of gateway.streamTurn(input)) {
      // Exhaust the stream so the request is captured.
    }

    const request = openAIStreamMock.mock.calls[0]?.[0] as {
      tools?: Array<Record<string, unknown>>;
    };

    const webSearchEnabled = request.tools?.some(
      (tool) => tool.type === 'web_search_preview'
    );

    expect(webSearchEnabled).toBe(true);
  });

  it('forces action proposal tool choice for tab actions with tab context', async () => {
    openAIStreamMock.mockReturnValue(
      createOpenAITextStream('Preparing tab grouping proposal.')
    );

    const gateway = new OpenAIModelGateway({
      apiKey: 'test-key'
    });

    const input: ModelGatewayTurnInput = {
      thread: {
        id: 'thread_force_action_tool',
        userId: 'user_dev',
        title: 'Force tab action',
        createdAt: NOW,
        updatedAt: NOW
      },
      messages: [],
      userMessage: {
        id: 'message_user_force_action_tool',
        threadId: 'thread_force_action_tool',
        role: 'user',
        content: 'Group these tabs for me.',
        attachments: [],
        toolInvocations: [],
        createdAt: NOW
      },
      transientAttachments: [
        {
          kind: 'tabs',
          tabs: [
            {
              tabId: 1,
              windowId: 1,
              index: 0,
              url: 'https://docs.riv.dev',
              title: 'Riv docs',
              active: true,
              pinned: false,
              groupId: -1
            },
            {
              tabId: 2,
              windowId: 1,
              index: 1,
              url: 'https://github.com/riv/extension',
              title: 'Riv GitHub',
              active: false,
              pinned: false,
              groupId: -1
            }
          ]
        }
      ],
      memories: []
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _event of gateway.streamTurn(input)) {
      // Exhaust the stream so the request is captured.
    }

    const request = openAIStreamMock.mock.calls[0]?.[0] as {
      tool_choice?: {
        type?: string;
        name?: string;
      };
      tools?: Array<Record<string, unknown>>;
    };

    expect(request.tool_choice).toEqual({
      type: 'function',
      name: 'create_action_proposal'
    });
    expect(
      request.tools?.some((tool) => tool.type === 'web_search_preview')
    ).toBe(false);
  });

  it('forces tab-action handling for continuation phrasing with tab context', async () => {
    openAIStreamMock.mockReturnValue(createOpenAIEventStream([]));

    const gateway = new OpenAIModelGateway({
      apiKey: 'test-key'
    });

    const input: ModelGatewayTurnInput = {
      thread: {
        id: 'thread_force_action_followup',
        userId: 'user_dev',
        title: 'Follow-up grouping',
        createdAt: NOW,
        updatedAt: NOW
      },
      messages: [],
      userMessage: {
        id: 'message_user_force_action_followup',
        threadId: 'thread_force_action_followup',
        role: 'user',
        content: 'Looks good, group them',
        attachments: [],
        toolInvocations: [],
        createdAt: NOW
      },
      transientAttachments: [
        {
          kind: 'tabs',
          tabs: [
            {
              tabId: 1,
              windowId: 1,
              index: 0,
              url: 'https://docs.riv.dev',
              title: 'Riv docs',
              active: true,
              pinned: false,
              groupId: -1
            },
            {
              tabId: 2,
              windowId: 1,
              index: 1,
              url: 'https://github.com/riv/extension',
              title: 'Riv GitHub',
              active: false,
              pinned: false,
              groupId: -1
            }
          ]
        }
      ],
      memories: []
    };

    const events: ModelGatewayStreamEvent[] = [];
    for await (const event of gateway.streamTurn(input)) {
      events.push(event);
    }

    const request = openAIStreamMock.mock.calls[0]?.[0] as {
      tool_choice?: {
        type?: string;
        name?: string;
      };
    };

    expect(request.tool_choice).toEqual({
      type: 'function',
      name: 'create_action_proposal'
    });
    expect(events[0]?.type).toBe('proposal');
  });

  it('falls back to deterministic tab grouping when model output is unusable', async () => {
    openAIStreamMock.mockReturnValue(
      createOpenAIEventStream([
        {
          type: 'response.output_item.done',
          item: {
            type: 'function_call',
            name: 'create_action_proposal',
            arguments: '{"kind":"groupTabs"}'
          }
        }
      ])
    );

    const gateway = new OpenAIModelGateway({
      apiKey: 'test-key'
    });

    const input: ModelGatewayTurnInput = {
      thread: {
        id: 'thread_grouping_fallback',
        userId: 'user_dev',
        title: 'Grouping fallback',
        createdAt: NOW,
        updatedAt: NOW
      },
      messages: [],
      userMessage: {
        id: 'message_user_grouping_fallback',
        threadId: 'thread_grouping_fallback',
        role: 'user',
        content: 'Group tabs',
        attachments: [],
        toolInvocations: [],
        createdAt: NOW
      },
      transientAttachments: [
        {
          kind: 'tabs',
          tabs: [
            {
              tabId: 1,
              windowId: 1,
              index: 0,
              url: 'https://www.youtube.com/watch?v=alpha',
              title: 'Video A',
              active: true,
              pinned: false,
              groupId: -1
            },
            {
              tabId: 2,
              windowId: 1,
              index: 1,
              url: 'https://www.youtube.com/watch?v=beta',
              title: 'Video B',
              active: false,
              pinned: false,
              groupId: -1
            },
            {
              tabId: 3,
              windowId: 1,
              index: 2,
              url: 'https://github.com/riv/extension/issues',
              title: 'GitHub Issues',
              active: false,
              pinned: false,
              groupId: -1
            },
            {
              tabId: 4,
              windowId: 1,
              index: 3,
              url: 'https://docs.riv.dev/guide',
              title: 'Riv docs',
              active: false,
              pinned: false,
              groupId: -1
            }
          ]
        }
      ],
      memories: []
    };

    const events: ModelGatewayStreamEvent[] = [];
    for await (const event of gateway.streamTurn(input)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('proposal');

    if (events[0]?.type !== 'proposal') {
      return;
    }

    const payload = events[0].proposal.payload as {
      groups?: Array<{ title?: string; tabIds?: number[] }>;
      tabIds?: number[];
    };
    const groups = payload.groups ?? [];

    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(new Set(payload.tabIds ?? [])).toEqual(new Set([1, 2, 3, 4]));
  });

  it('emits validated action proposals from OpenAI function calls', async () => {
    openAIStreamMock.mockReturnValue(
      createOpenAIEventStream([
        {
          type: 'response.function_call_arguments.done',
          name: 'create_action_proposal',
          arguments: JSON.stringify({
            kind: 'groupTabs',
            reason: 'The tabs all belong to the same Riv research task.',
            preview: {
              title: 'Group Riv research tabs',
              summary: 'Create one group for the current Riv work tabs.',
              items: ['docs.riv.dev', 'github.com/riv']
            },
            riskLevel: 'low',
            payload: {
              tabIds: [7, 8],
              title: 'Riv research'
            }
          })
        }
      ])
    );

    const gateway = new OpenAIModelGateway({
      apiKey: 'test-key'
    });

    const input: ModelGatewayTurnInput = {
      thread: {
        id: 'thread_proposal',
        userId: 'user_dev',
        title: 'Tab organization',
        createdAt: NOW,
        updatedAt: NOW
      },
      messages: [],
      userMessage: {
        id: 'message_user_proposal',
        threadId: 'thread_proposal',
        role: 'user',
        content: 'Group the browser tabs.',
        attachments: [],
        toolInvocations: [],
        createdAt: NOW
      },
      transientAttachments: [
        {
          kind: 'tabs',
          tabs: [
            {
              tabId: 7,
              windowId: 1,
              index: 0,
              url: 'https://docs.riv.dev',
              title: 'Riv docs',
              active: true,
              pinned: false,
              groupId: -1
            },
            {
              tabId: 8,
              windowId: 1,
              index: 1,
              url: 'https://github.com/riv',
              title: 'Riv repo',
              active: false,
              pinned: false,
              groupId: -1
            }
          ]
        }
      ],
      memories: []
    };

    const events: ModelGatewayStreamEvent[] = [];
    for await (const event of gateway.streamTurn(input)) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: 'proposal',
        proposal: {
          kind: 'groupTabs',
          reason: 'The tabs all belong to the same Riv research task.',
          preview: {
            title: 'Group Riv research tabs',
            summary: 'Create one group for the current Riv work tabs.',
            items: ['docs.riv.dev', 'github.com/riv']
          },
          riskLevel: 'low',
          payload: {
            tabIds: [7, 8],
            title: 'Riv research'
          }
        }
      }
    ]);
  });

  it('uses an explicit retry fallback when the model returns no text or proposal', async () => {
    openAIStreamMock.mockReturnValue(createOpenAIEventStream([]));

    const gateway = new OpenAIModelGateway({
      apiKey: 'test-key'
    });

    const input: ModelGatewayTurnInput = {
      thread: {
        id: 'thread_empty',
        userId: 'user_dev',
        title: 'Empty turn',
        createdAt: NOW,
        updatedAt: NOW
      },
      messages: [],
      userMessage: {
        id: 'message_user_empty',
        threadId: 'thread_empty',
        role: 'user',
        content: 'Yo',
        attachments: [],
        toolInvocations: [],
        createdAt: NOW
      },
      transientAttachments: [],
      memories: []
    };

    const events: ModelGatewayStreamEvent[] = [];
    for await (const event of gateway.streamTurn(input)) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: 'message_delta',
        delta: "I didn't get a usable response from the model. Send that again."
      }
    ]);
  });

  it('emits tool lifecycle events for web search calls', async () => {
    openAIStreamMock.mockReturnValue(
      createOpenAIEventStream([
        {
          type: 'response.web_search_call.in_progress',
          item_id: 'ws_1',
          output_index: 0,
          sequence_number: 0
        },
        {
          type: 'response.web_search_call.completed',
          item_id: 'ws_1',
          output_index: 0,
          sequence_number: 0
        }
      ])
    );

    const gateway = new OpenAIModelGateway({
      apiKey: 'test-key'
    });

    const input: ModelGatewayTurnInput = {
      thread: {
        id: 'thread_web_search',
        userId: 'user_dev',
        title: 'Web search',
        createdAt: NOW,
        updatedAt: NOW
      },
      messages: [],
      userMessage: {
        id: 'message_user_web_search',
        threadId: 'thread_web_search',
        role: 'user',
        content: 'Search CH alternatives',
        attachments: [],
        toolInvocations: [],
        createdAt: NOW
      },
      transientAttachments: [],
      memories: []
    };

    const events: ModelGatewayStreamEvent[] = [];
    for await (const event of gateway.streamTurn(input)) {
      events.push(event);
    }

    expect(events[0]).toEqual({
      type: 'tool_started',
      invocation: {
        id: 'ws_1',
        tool: 'searchWeb',
        kind: 'read',
        args: {}
      }
    });
    expect(events[1]).toEqual({
      type: 'tool_finished',
      invocation: {
        id: 'ws_1',
        tool: 'searchWeb',
        kind: 'read',
        args: {},
        result: {
          status: 'completed'
        }
      }
    });
    expect(events[2]).toEqual({
      type: 'message_delta',
      delta: "I didn't get a usable response from the model. Send that again."
    });
  });

  it('repairs group-tabs tool calls that omit payload when tab context is available', async () => {
    openAIStreamMock.mockReturnValue(
      createOpenAIEventStream([
        {
          type: 'response.function_call_arguments.done',
          name: 'create_action_proposal',
          arguments: JSON.stringify({
            kind: 'groupTabs',
            reason:
              "User requested 'Create groups' and I can group the open tabs.",
            preview: {
              title: "Create group: 'Watch'",
              summary:
                "Make a new tab group named 'Watch' to hold your currently open YouTube tab.",
              items: [
                'Coulda Been Love 2 Episode 2: Mile High Club — https://www.youtube.com/watch?v=demo'
              ]
            },
            riskLevel: 'low'
          })
        }
      ])
    );

    const gateway = new OpenAIModelGateway({
      apiKey: 'test-key'
    });

    const input: ModelGatewayTurnInput = {
      thread: {
        id: 'thread_repair',
        userId: 'user_dev',
        title: 'Create groups',
        createdAt: NOW,
        updatedAt: NOW
      },
      messages: [],
      userMessage: {
        id: 'message_user_repair',
        threadId: 'thread_repair',
        role: 'user',
        content: 'Create groups',
        attachments: [],
        toolInvocations: [],
        createdAt: NOW
      },
      transientAttachments: [
        {
          kind: 'tabs',
          tabs: [
            {
              tabId: 1,
              windowId: 1,
              index: 0,
              url: 'https://www.youtube.com/watch?v=demo',
              title: 'Coulda Been Love 2 Episode 2: Mile High Club',
              active: true,
              pinned: false,
              groupId: -1
            }
          ]
        }
      ],
      memories: []
    };

    const events: ModelGatewayStreamEvent[] = [];
    for await (const event of gateway.streamTurn(input)) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: 'proposal',
        proposal: {
          kind: 'groupTabs',
          reason: "User requested 'Create groups' and I can group the open tabs.",
          preview: {
            title: "Create group: 'Watch'",
            summary:
              "Make a new tab group named 'Watch' to hold your currently open YouTube tab.",
            items: [
              'Coulda Been Love 2 Episode 2: Mile High Club — https://www.youtube.com/watch?v=demo'
            ]
          },
          riskLevel: 'low',
          payload: {
            tabIds: [1],
            title: 'Watch'
          }
        }
      }
    ]);
  });

  it('repairs the live create-groups tool call when the model omits payload', async () => {
    openAIStreamMock.mockReturnValue(
      createOpenAIEventStream([
        {
          type: 'response.function_call_arguments.done',
          name: 'create_action_proposal',
          arguments: JSON.stringify({
            kind: 'groupTabs',
            reason:
              "User asked to 'Create groups' and I can group the single open YouTube tab into a named group for organization.",
            preview: {
              title: "Proposed tab group: 'Entertainment'",
              summary: 'Create 1 tab group to organize your open YouTube tab.',
              items: [
                'Entertainment — 1 tab: Coulda Been Love 2 Episode 2: Mile High Club (https://www.youtube.com/watch?v=demo)'
              ]
            },
            riskLevel: 'low'
          })
        }
      ])
    );

    const gateway = new OpenAIModelGateway({
      apiKey: 'test-key'
    });

    const input: ModelGatewayTurnInput = {
      thread: {
        id: 'thread_live_repair',
        userId: 'user_dev',
        title: 'Create groups',
        createdAt: NOW,
        updatedAt: NOW
      },
      messages: [],
      userMessage: {
        id: 'message_user_live_repair',
        threadId: 'thread_live_repair',
        role: 'user',
        content: 'Create groups',
        attachments: [],
        toolInvocations: [],
        createdAt: NOW
      },
      transientAttachments: [
        {
          kind: 'tabs',
          tabs: [
            {
              tabId: 1,
              windowId: 1,
              index: 0,
              url: 'https://www.youtube.com/watch?v=demo',
              title: 'Coulda Been Love 2 Episode 2: Mile High Club',
              active: true,
              pinned: false,
              groupId: -1
            }
          ]
        },
        {
          kind: 'tabGroups',
          tabGroups: []
        }
      ],
      memories: []
    };

    const events: ModelGatewayStreamEvent[] = [];
    for await (const event of gateway.streamTurn(input)) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: 'proposal',
        proposal: {
          kind: 'groupTabs',
          reason:
            "User asked to 'Create groups' and I can group the single open YouTube tab into a named group for organization.",
          preview: {
            title: "Proposed tab group: 'Entertainment'",
            summary: 'Create 1 tab group to organize your open YouTube tab.',
            items: [
              'Entertainment — 1 tab: Coulda Been Love 2 Episode 2: Mile High Club (https://www.youtube.com/watch?v=demo)'
            ]
          },
          riskLevel: 'low',
          payload: {
            tabIds: [1],
            title: 'Entertainment'
          }
        }
      }
    ]);
  });

  it('parses the OpenAI SDK function-call stream when the done event omits the tool name', async () => {
    openAIStreamMock.mockReturnValue(
      createOpenAIEventStream([
        {
          type: 'response.output_item.added',
          item: {
            type: 'function_call',
            name: 'create_action_proposal'
          },
          output_index: 1
        },
        {
          type: 'response.function_call_arguments.delta',
          delta:
            '{"kind":"groupTabs","reason":"User asked to \\"Create groups\\" and there is one open tab—group the YouTube tab into a new tab group for organization.","preview":{"title":"Create group: \\"YouTube\\" (1 tab)","summary":"Create a new tab group named \\"YouTube\\" containing the single open video tab to keep media tabs organized.","items":["Coulda Been Love 2 Episode 2: Mile High Club — https://www.youtube.com/watch?v=demo"]},"riskLevel":"low"}',
          output_index: 1
        },
        {
          type: 'response.function_call_arguments.done',
          arguments:
            '{"kind":"groupTabs","reason":"User asked to \\"Create groups\\" and there is one open tab—group the YouTube tab into a new tab group for organization.","preview":{"title":"Create group: \\"YouTube\\" (1 tab)","summary":"Create a new tab group named \\"YouTube\\" containing the single open video tab to keep media tabs organized.","items":["Coulda Been Love 2 Episode 2: Mile High Club — https://www.youtube.com/watch?v=demo"]},"riskLevel":"low"}',
          output_index: 1
        }
      ])
    );

    const gateway = new OpenAIModelGateway({
      apiKey: 'test-key'
    });

    const input: ModelGatewayTurnInput = {
      thread: {
        id: 'thread_sdk_repair',
        userId: 'user_dev',
        title: 'Create groups',
        createdAt: NOW,
        updatedAt: NOW
      },
      messages: [],
      userMessage: {
        id: 'message_user_sdk_repair',
        threadId: 'thread_sdk_repair',
        role: 'user',
        content: 'Create groups',
        attachments: [],
        toolInvocations: [],
        createdAt: NOW
      },
      transientAttachments: [
        {
          kind: 'tabs',
          tabs: [
            {
              tabId: 1,
              windowId: 1,
              index: 0,
              url: 'https://www.youtube.com/watch?v=demo',
              title: 'Coulda Been Love 2 Episode 2: Mile High Club',
              active: true,
              pinned: false,
              groupId: -1
            }
          ]
        },
        {
          kind: 'tabGroups',
          tabGroups: []
        }
      ],
      memories: []
    };

    const events: ModelGatewayStreamEvent[] = [];
    for await (const event of gateway.streamTurn(input)) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: 'proposal',
        proposal: {
          kind: 'groupTabs',
          reason:
            'User asked to "Create groups" and there is one open tab—group the YouTube tab into a new tab group for organization.',
          preview: {
            title: 'Create group: "YouTube" (1 tab)',
            summary:
              'Create a new tab group named "YouTube" containing the single open video tab to keep media tabs organized.',
            items: [
              'Coulda Been Love 2 Episode 2: Mile High Club — https://www.youtube.com/watch?v=demo'
            ]
          },
          riskLevel: 'low',
          payload: {
            tabIds: [1],
            title: 'YouTube'
          }
        }
      }
    ]);
  });

  it('expands singleton group-tabs payloads to related tabs', async () => {
    openAIStreamMock.mockReturnValue(
      createOpenAIEventStream([
        {
          type: 'response.function_call_arguments.done',
          name: 'create_action_proposal',
          arguments: JSON.stringify({
            kind: 'groupTabs',
            reason: 'Group related YouTube tabs together.',
            preview: {
              title: "Create group: 'YouTube'",
              summary: 'Group related YouTube tabs.',
              items: ['YouTube tabs']
            },
            riskLevel: 'low',
            payload: {
              tabIds: [1],
              title: 'YouTube'
            }
          })
        }
      ])
    );

    const gateway = new OpenAIModelGateway({
      apiKey: 'test-key'
    });

    const input: ModelGatewayTurnInput = {
      thread: {
        id: 'thread_related_grouping',
        userId: 'user_dev',
        title: 'Create groups',
        createdAt: NOW,
        updatedAt: NOW
      },
      messages: [],
      userMessage: {
        id: 'message_user_related_grouping',
        threadId: 'thread_related_grouping',
        role: 'user',
        content: 'Create groups',
        attachments: [],
        toolInvocations: [],
        createdAt: NOW
      },
      transientAttachments: [
        {
          kind: 'tabs',
          tabs: [
            {
              tabId: 1,
              windowId: 1,
              index: 0,
              url: 'https://www.youtube.com/watch?v=alpha',
              title: 'Video A',
              active: true,
              pinned: false,
              groupId: -1
            },
            {
              tabId: 2,
              windowId: 1,
              index: 1,
              url: 'https://www.youtube.com/watch?v=beta',
              title: 'Video B',
              active: false,
              pinned: false,
              groupId: -1
            },
            {
              tabId: 3,
              windowId: 1,
              index: 2,
              url: 'https://docs.riv.dev/guide',
              title: 'Riv docs',
              active: false,
              pinned: false,
              groupId: -1
            }
          ]
        }
      ],
      memories: []
    };

    const events: ModelGatewayStreamEvent[] = [];
    for await (const event of gateway.streamTurn(input)) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: 'proposal',
        proposal: {
          kind: 'groupTabs',
          reason: 'Group related YouTube tabs together.',
          preview: {
            title: "Create group: 'YouTube'",
            summary: 'Group related YouTube tabs.',
            items: ['YouTube tabs']
          },
          riskLevel: 'low',
          payload: {
            tabIds: [1, 2],
            title: 'YouTube'
          }
        }
      }
    ]);
  });

  it('builds multi-category tab groups when enough related tabs are available', async () => {
    openAIStreamMock.mockReturnValue(
      createOpenAIEventStream([
        {
          type: 'response.function_call_arguments.done',
          name: 'create_action_proposal',
          arguments: JSON.stringify({
            kind: 'groupTabs',
            reason: 'Group tabs by category.',
            preview: {
              title: 'Group tabs',
              summary: 'Group all related tabs.',
              items: ['Group tabs']
            },
            riskLevel: 'low',
            payload: {
              tabIds: [1],
              title: 'Tabs'
            }
          })
        }
      ])
    );

    const gateway = new OpenAIModelGateway({
      apiKey: 'test-key'
    });

    const input: ModelGatewayTurnInput = {
      thread: {
        id: 'thread_multi_category_grouping',
        userId: 'user_dev',
        title: 'Group tabs',
        createdAt: NOW,
        updatedAt: NOW
      },
      messages: [],
      userMessage: {
        id: 'message_user_multi_category_grouping',
        threadId: 'thread_multi_category_grouping',
        role: 'user',
        content: 'Group tabs',
        attachments: [],
        toolInvocations: [],
        createdAt: NOW
      },
      transientAttachments: [
        {
          kind: 'tabs',
          tabs: [
            {
              tabId: 1,
              windowId: 1,
              index: 0,
              url: 'https://www.youtube.com/watch?v=alpha',
              title: 'Video A',
              active: true,
              pinned: false,
              groupId: -1
            },
            {
              tabId: 2,
              windowId: 1,
              index: 1,
              url: 'https://github.com/riv/extension/issues',
              title: 'GitHub Issues',
              active: false,
              pinned: false,
              groupId: -1
            },
            {
              tabId: 3,
              windowId: 1,
              index: 2,
              url: 'https://www.jumia.com.ng/catalog/?q=headphones',
              title: 'Jumia Headphones',
              active: false,
              pinned: false,
              groupId: -1
            },
            {
              tabId: 4,
              windowId: 1,
              index: 3,
              url: 'https://www.amazon.com/s?k=headphones',
              title: 'Amazon Headphones',
              active: false,
              pinned: false,
              groupId: -1
            },
            {
              tabId: 5,
              windowId: 1,
              index: 4,
              url: 'https://www.youtube.com/watch?v=beta',
              title: 'Video B',
              active: false,
              pinned: false,
              groupId: -1
            },
            {
              tabId: 6,
              windowId: 1,
              index: 5,
              url: 'https://docs.riv.dev/guide',
              title: 'Riv docs',
              active: false,
              pinned: false,
              groupId: -1
            }
          ]
        }
      ],
      memories: []
    };

    const events: ModelGatewayStreamEvent[] = [];
    for await (const event of gateway.streamTurn(input)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('proposal');

    if (events[0]?.type !== 'proposal') {
      return;
    }

    const payload = events[0].proposal.payload as {
      groups?: Array<{ title?: string; tabIds?: number[] }>;
      tabIds?: number[];
    };
    const groups = payload.groups ?? [];
    const flattenedTabIds = new Set(payload.tabIds ?? []);

    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.title)).toEqual(
      expect.arrayContaining(['Media', 'Work', 'Shopping'])
    );
    expect(flattenedTabIds).toEqual(new Set([1, 2, 3, 4, 5, 6]));
  });

  it('infers a group title from broader preview-title phrasing', async () => {
    openAIStreamMock.mockReturnValue(
      createOpenAIEventStream([
        {
          type: 'response.output_item.added',
          item: {
            type: 'function_call',
            name: 'create_action_proposal'
          },
          output_index: 1
        },
        {
          type: 'response.function_call_arguments.done',
          arguments: JSON.stringify({
            kind: 'groupTabs',
            reason:
              'User requested creating groups and there is one open tab available to group.',
            preview: {
              title: "Create a new tab group 'YouTube' with 1 tab",
              summary:
                "Create a new tab group named 'YouTube' containing the listed tab.",
              items: [
                'Coulda Been Love 2 Episode 2: Mile High Club — https://www.youtube.com/watch?v=demo (window 1, tab index 0)'
              ]
            },
            riskLevel: 'low'
          }),
          output_index: 1
        }
      ])
    );

    const gateway = new OpenAIModelGateway({
      apiKey: 'test-key'
    });

    const input: ModelGatewayTurnInput = {
      thread: {
        id: 'thread_title_inference',
        userId: 'user_dev',
        title: 'Create groups',
        createdAt: NOW,
        updatedAt: NOW
      },
      messages: [],
      userMessage: {
        id: 'message_user_title_inference',
        threadId: 'thread_title_inference',
        role: 'user',
        content: 'Create groups',
        attachments: [],
        toolInvocations: [],
        createdAt: NOW
      },
      transientAttachments: [
        {
          kind: 'tabs',
          tabs: [
            {
              tabId: 1,
              windowId: 1,
              index: 0,
              url: 'https://www.youtube.com/watch?v=demo',
              title: 'Coulda Been Love 2 Episode 2: Mile High Club',
              active: true,
              pinned: false,
              groupId: -1
            }
          ]
        }
      ],
      memories: []
    };

    const events: ModelGatewayStreamEvent[] = [];
    for await (const event of gateway.streamTurn(input)) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: 'proposal',
        proposal: {
          kind: 'groupTabs',
          reason:
            'User requested creating groups and there is one open tab available to group.',
          preview: {
            title: "Create a new tab group 'YouTube' with 1 tab",
            summary:
              "Create a new tab group named 'YouTube' containing the listed tab.",
            items: [
              'Coulda Been Love 2 Episode 2: Mile High Club — https://www.youtube.com/watch?v=demo (window 1, tab index 0)'
            ]
          },
          riskLevel: 'low',
          payload: {
            tabIds: [1],
            title: 'YouTube'
          }
        }
      }
    ]);
  });
});
