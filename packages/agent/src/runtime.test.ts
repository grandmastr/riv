import { describe, expect, it } from 'vitest';

import { MessageEnvelopeSchema, type ContextAttachment } from '@riv/contracts';

import {
  MockModelGateway,
  createAgentRuntime,
  createSequenceIdGenerator
} from './index';

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

describe('agent runtime', () => {
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
            reason: 'The documentation tabs are all part of the same research task.',
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
    expect(detail.messages[0]?.content).toBe('Please organize these docs tabs.');
    expect(detail.messages[0]?.attachments).toEqual([]);
    expect(detail.messages[1]?.role).toBe('assistant');
    expect(detail.messages[1]?.content).toBe('I can group those Riv tabs for you.');
    expect(detail.actionProposals).toHaveLength(1);
    expect(detail.actionProposals[0]?.status).toBe('pending');
    expect(await runtime.listMemories({ userId: 'user_dev' })).toEqual([]);
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

    for await (const _ of runtime.runAssistantTurn({
      threadId: confirmThread.id,
      userId: 'user_dev',
      content: 'Handle the duplicate tabs.',
      attachments: []
    })) {
      // consume stream
    }

    const confirmation = await runtime.confirmActionProposal({
      actorUserId: 'user_dev',
      proposalId: 'proposal_confirm',
      threadId: confirmThread.id
    });

    expect(confirmation.confirmation.decision).toBe('confirm');
    expect(confirmation.result.status).toBe('executed');
    expect(confirmation.result.affectedTabs.map((tab) => tab.tabId)).toEqual([7, 8]);

    const rejectThread = await runtime.createThread({
      title: 'Reject flow',
      userId: 'user_dev'
    });

    for await (const _ of runtime.runAssistantTurn({
      threadId: rejectThread.id,
      userId: 'user_dev',
      content: 'Maybe close the duplicate tabs.',
      attachments: []
    })) {
      // consume stream
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
