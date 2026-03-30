import { describe, expect, it } from 'vitest';

import type {
  ActionProposal,
  ConversationMessage,
  ConversationThread
} from '@riv/contracts';

import { createInMemoryConversationStore } from './local-conversation-store';

describe('createInMemoryConversationStore', () => {
  it('returns the most recently updated thread with its persisted messages and proposals', async () => {
    const store = createInMemoryConversationStore();
    const olderThread: ConversationThread = {
      id: 'thread_older',
      userId: 'user_dev',
      title: 'Older',
      createdAt: '2026-03-29T13:00:00.000Z',
      updatedAt: '2026-03-29T13:30:00.000Z'
    };
    const newerThread: ConversationThread = {
      id: 'thread_newer',
      userId: 'user_dev',
      title: 'Newer',
      createdAt: '2026-03-29T14:00:00.000Z',
      updatedAt: '2026-03-29T14:30:00.000Z'
    };
    const newerMessage: ConversationMessage = {
      id: 'message_1',
      threadId: newerThread.id,
      role: 'assistant',
      content: 'Newest answer',
      attachments: [],
      toolInvocations: [],
      createdAt: '2026-03-29T14:05:00.000Z'
    };
    const newerProposal: ActionProposal = {
      id: 'proposal_1',
      threadId: newerThread.id,
      kind: 'focusTab',
      reason: 'Relevant tab found',
      preview: {
        title: 'Focus the relevant tab',
        summary: 'Move to the best tab.',
        items: ['docs.riv.dev']
      },
      riskLevel: 'low',
      requiresConfirmation: true,
      payload: {
        tabId: 2
      },
      createdAt: '2026-03-29T14:06:00.000Z'
    };

    await store.upsertThread(olderThread);
    await store.upsertThread(newerThread);
    await store.upsertMessage(newerMessage);
    await store.upsertProposal(newerProposal);

    await expect(store.getLatestThreadDetail()).resolves.toEqual({
      thread: newerThread,
      messages: [newerMessage],
      proposals: [newerProposal]
    });
  });

  it('replaces messages by id and removes proposals by id', async () => {
    const store = createInMemoryConversationStore();
    const thread: ConversationThread = {
      id: 'thread_1',
      userId: 'user_dev',
      title: 'Thread',
      createdAt: '2026-03-29T13:00:00.000Z',
      updatedAt: '2026-03-29T13:00:00.000Z'
    };
    const initialMessage: ConversationMessage = {
      id: 'message_1',
      threadId: thread.id,
      role: 'assistant',
      content: 'Partial',
      attachments: [],
      toolInvocations: [],
      createdAt: '2026-03-29T13:01:00.000Z'
    };
    const updatedMessage: ConversationMessage = {
      ...initialMessage,
      content: 'Partial and final'
    };
    const proposal: ActionProposal = {
      id: 'proposal_1',
      threadId: thread.id,
      kind: 'focusTab',
      reason: 'Relevant tab found',
      preview: {
        title: 'Focus the relevant tab',
        summary: 'Move to the best tab.',
        items: ['docs.riv.dev']
      },
      riskLevel: 'low',
      requiresConfirmation: true,
      payload: {
        tabId: 2
      },
      createdAt: '2026-03-29T13:02:00.000Z'
    };

    await store.upsertThread(thread);
    await store.upsertMessage(initialMessage);
    await store.upsertMessage(updatedMessage);
    await store.upsertProposal(proposal);
    await store.removeProposal(thread.id, proposal.id);

    await expect(store.getThreadDetail(thread.id)).resolves.toEqual({
      thread,
      messages: [updatedMessage],
      proposals: []
    });
  });

  it('deletes a thread together with its messages and proposals', async () => {
    const store = createInMemoryConversationStore();
    const thread: ConversationThread = {
      id: 'thread_delete',
      userId: 'user_dev',
      title: 'Delete me',
      createdAt: '2026-03-29T13:00:00.000Z',
      updatedAt: '2026-03-29T13:00:00.000Z'
    };
    const message: ConversationMessage = {
      id: 'message_delete',
      threadId: thread.id,
      role: 'assistant',
      content: 'This thread should be removed.',
      attachments: [],
      toolInvocations: [],
      createdAt: '2026-03-29T13:01:00.000Z'
    };
    const proposal: ActionProposal = {
      id: 'proposal_delete',
      threadId: thread.id,
      kind: 'focusTab',
      reason: 'Cleanup',
      preview: {
        title: 'Remove tab',
        summary: 'For deletion test',
        items: ['example']
      },
      riskLevel: 'low',
      requiresConfirmation: true,
      payload: {
        tabId: 4
      },
      createdAt: '2026-03-29T13:02:00.000Z'
    };

    await store.upsertThread(thread);
    await store.upsertMessage(message);
    await store.upsertProposal(proposal);
    await store.deleteThread(thread.id);

    await expect(store.getThreadDetail(thread.id)).resolves.toBeNull();
    await expect(store.listThreads()).resolves.toEqual([]);
  });
});
