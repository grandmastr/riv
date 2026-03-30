import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ActionExecutionResult,
  ActionProposal,
  AssistantStreamEvent,
  ConversationMessage,
  ConversationThread,
  MessageEnvelope,
  PageContextSnapshot,
  SelectedTextContext
} from '@riv/contracts';

import {
  createInMemoryConversationStore,
  type LocalConversationStore
} from '../lib/local-conversation-store';

const NOW = '2026-03-29T15:00:00.000Z';

const pageSnapshot: PageContextSnapshot = {
  tabId: 7,
  url: 'https://docs.riv.dev',
  title: 'Riv docs',
  pageType: 'documentation',
  capturedAt: NOW,
  metadata: {
    section: 'overview'
  },
  contentBlocks: []
};

const createThreadMock = vi.fn();
const resolveProposalMock = vi.fn();
const sendMessageMock = vi.fn();
const sendBackgroundMessageMock = vi.fn();
const subscribeToPreparedSelectionMock = vi.fn();
const localConversationStoreMocks = vi.hoisted(() => ({
  getConversationStore: vi.fn()
}));

vi.mock('../lib/api-client', () => ({
  createThread: createThreadMock,
  resolveProposal: resolveProposalMock,
  sendMessage: sendMessageMock
}));

vi.mock('../lib/messages', () => ({
  sendBackgroundMessage: sendBackgroundMessageMock,
  subscribeToPreparedSelection: subscribeToPreparedSelectionMock
}));

vi.mock('../lib/local-conversation-store', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/local-conversation-store')>(
      '../lib/local-conversation-store'
    );

  return {
    ...actual,
    getConversationStore: localConversationStoreMocks.getConversationStore
  };
});

function createEnvelope(payload: AssistantStreamEvent): MessageEnvelope {
  return {
    version: '2026-03-29',
    type: 'assistant_stream',
    emittedAt: NOW,
    payload
  };
}

describe('sidepanel App', () => {
  let conversationStore: LocalConversationStore;

  beforeEach(() => {
    createThreadMock.mockReset();
    resolveProposalMock.mockReset();
    sendMessageMock.mockReset();
    sendBackgroundMessageMock.mockReset();
    subscribeToPreparedSelectionMock.mockReset();
    localConversationStoreMocks.getConversationStore.mockReset();
    conversationStore = createInMemoryConversationStore();
    localConversationStoreMocks.getConversationStore.mockReturnValue(
      conversationStore
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('streams assistant deltas into the transcript instead of waiting for the full response', async () => {
    const thread: ConversationThread = {
      id: 'thread_1',
      userId: 'user_dev',
      title: 'Riv docs',
      createdAt: NOW,
      updatedAt: NOW
    };

    let releaseSecondDelta: (() => void) | undefined;
    const secondDeltaGate = new Promise<void>((resolve) => {
      releaseSecondDelta = resolve;
    });

    sendBackgroundMessageMock.mockImplementation(
      async (message: { type: string }) => {
        if (message.type === 'riv/read-active-page') {
          return pageSnapshot;
        }

        if (message.type === 'riv/read-selection') {
          return null;
        }

        return null;
      }
    );
    subscribeToPreparedSelectionMock.mockReturnValue(() => undefined);

    createThreadMock.mockResolvedValue(thread);
    sendMessageMock.mockReturnValue(
      (async function* () {
        yield createEnvelope({
          type: 'message_delta',
          delta: '## Summary\n\n'
        });

        await secondDeltaGate;

        yield createEnvelope({
          type: 'message_delta',
          delta: '- First point\n- Second point'
        });
      })()
    );

    const { default: App } = await import('../../entrypoints/sidepanel/App');
    render(<App />);

    await screen.findByText('Riv docs');

    fireEvent.change(
      screen.getByPlaceholderText('Ask Riv about this page...'),
      {
        target: {
          value: 'Summarize this page'
        }
      }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 2, name: 'Summary' })
      ).toBeDefined();
    });
    expect(screen.queryByText('First point')).toBeNull();

    releaseSecondDelta?.();

    await waitFor(() => {
      expect(screen.getByText('First point')).toBeDefined();
      expect(screen.getByText('Second point')).toBeDefined();
    });
  });

  it('shows a transcript thinking indicator until the first assistant delta arrives', async () => {
    const thread: ConversationThread = {
      id: 'thread_1',
      userId: 'user_dev',
      title: 'Riv docs',
      createdAt: NOW,
      updatedAt: NOW
    };

    let releaseFirstDelta: (() => void) | undefined;
    const firstDeltaGate = new Promise<void>((resolve) => {
      releaseFirstDelta = resolve;
    });

    sendBackgroundMessageMock.mockImplementation(
      async (message: { type: string }) => {
        if (message.type === 'riv/read-active-page') {
          return pageSnapshot;
        }

        if (message.type === 'riv/read-selection') {
          return null;
        }

        return null;
      }
    );
    subscribeToPreparedSelectionMock.mockReturnValue(() => undefined);
    createThreadMock.mockResolvedValue(thread);
    sendMessageMock.mockReturnValue(
      (async function* () {
        await firstDeltaGate;

        yield createEnvelope({
          type: 'message_delta',
          delta: 'Working through the page now.'
        });
      })()
    );

    const { default: App } = await import('../../entrypoints/sidepanel/App');
    render(<App />);

    await screen.findByText('Riv docs');

    fireEvent.change(
      screen.getByPlaceholderText('Ask Riv about this page...'),
      {
        target: {
          value: 'Summarize this page'
        }
      }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByText('Riv is thinking')).toBeDefined();
    });

    releaseFirstDelta?.();

    await waitFor(() => {
      expect(screen.getByText('Working through the page now.')).toBeDefined();
    });
    expect(screen.queryByText('Riv is thinking')).toBeNull();
  });

  it('shows a prepared selection indicator and sends that selection as context', async () => {
    const thread: ConversationThread = {
      id: 'thread_1',
      userId: 'user_dev',
      title: 'Riv docs',
      createdAt: NOW,
      updatedAt: NOW
    };
    const preparedSelection: SelectedTextContext = {
      tabId: 7,
      url: 'https://docs.riv.dev',
      title: 'Riv docs',
      text: 'Use this highlighted passage in the answer.',
      capturedAt: NOW
    };

    sendBackgroundMessageMock.mockImplementation(
      async (message: { type: string }) => {
        if (message.type === 'riv/read-active-page') {
          return pageSnapshot;
        }

        if (message.type === 'riv/read-selection') {
          return preparedSelection;
        }

        return null;
      }
    );
    subscribeToPreparedSelectionMock.mockImplementation(
      (listener: (selection: SelectedTextContext | null) => void) => {
        listener(preparedSelection);
        return () => undefined;
      }
    );
    createThreadMock.mockResolvedValue(thread);
    sendMessageMock.mockReturnValue(
      (async function* () {
        yield createEnvelope({
          type: 'message_delta',
          delta: 'Selection received.'
        });
      })()
    );

    const { default: App } = await import('../../entrypoints/sidepanel/App');
    render(<App />);

    await screen.findByText('Riv docs');
    expect(screen.queryByText('Selection ready')).toBeNull();
    expect(
      screen.getByText('Use this highlighted passage in the answer.')
    ).toBeDefined();

    fireEvent.change(
      screen.getByPlaceholderText('Ask Riv about this page...'),
      {
        target: {
          value: 'Answer using the prepared selection'
        }
      }
    );
    fireEvent.keyDown(
      screen.getByPlaceholderText('Ask Riv about this page...'),
      {
        key: 'Enter'
      }
    );

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledTimes(1);
    });

    expect(sendMessageMock).toHaveBeenCalledWith(
      'thread_1',
      'Answer using the prepared selection',
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'page'
        }),
        {
          kind: 'selection',
          selection: preparedSelection
        }
      ])
    );
  });

  it('re-reads the active page before sending so navigation does not reuse stale page context', async () => {
    const thread: ConversationThread = {
      id: 'thread_1',
      userId: 'user_dev',
      title: 'Riv docs',
      createdAt: NOW,
      updatedAt: NOW
    };
    const navigatedSnapshot: PageContextSnapshot = {
      ...pageSnapshot,
      url: 'https://docs.riv.dev/guides/navigation',
      title: 'Riv navigation guide',
      capturedAt: '2026-03-29T15:01:00.000Z',
      metadata: {
        section: 'navigation'
      }
    };
    let activePageReads = 0;

    sendBackgroundMessageMock.mockImplementation(
      async (message: { type: string }) => {
        if (message.type === 'riv/read-active-page') {
          activePageReads += 1;
          return activePageReads === 1 ? pageSnapshot : navigatedSnapshot;
        }

        if (message.type === 'riv/read-selection') {
          return null;
        }

        return null;
      }
    );
    subscribeToPreparedSelectionMock.mockReturnValue(() => undefined);
    createThreadMock.mockResolvedValue(thread);
    sendMessageMock.mockReturnValue(
      (async function* () {
        yield createEnvelope({
          type: 'message_delta',
          delta: 'Fresh page context received.'
        });
      })()
    );

    const { default: App } = await import('../../entrypoints/sidepanel/App');
    render(<App />);

    await screen.findByText('Riv docs');

    fireEvent.change(
      screen.getByPlaceholderText('Ask Riv about this page...'),
      {
        target: {
          value: 'What changed on this page?'
        }
      }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledTimes(1);
    });

    expect(activePageReads).toBe(2);
    expect(sendMessageMock).toHaveBeenCalledWith(
      'thread_1',
      'What changed on this page?',
      expect.arrayContaining([
        {
          kind: 'page',
          snapshot: navigatedSnapshot
        }
      ])
    );
  });

  it('re-reads the current selection before sending so stale prepared text is not reused', async () => {
    const thread: ConversationThread = {
      id: 'thread_1',
      userId: 'user_dev',
      title: 'Riv docs',
      createdAt: NOW,
      updatedAt: NOW
    };
    const staleSelection: SelectedTextContext = {
      tabId: 7,
      url: 'https://docs.riv.dev',
      title: 'Riv docs',
      text: 'Old highlighted text.',
      capturedAt: NOW
    };
    const freshSelection: SelectedTextContext = {
      tabId: 7,
      url: 'https://docs.riv.dev/guides/navigation',
      title: 'Riv navigation guide',
      text: 'Fresh highlighted text.',
      capturedAt: '2026-03-29T15:01:00.000Z'
    };

    sendBackgroundMessageMock.mockImplementation(
      async (message: { type: string }) => {
        if (message.type === 'riv/read-active-page') {
          return pageSnapshot;
        }

        if (message.type === 'riv/read-selection') {
          return freshSelection;
        }

        return null;
      }
    );
    subscribeToPreparedSelectionMock.mockImplementation(
      (listener: (selection: SelectedTextContext | null) => void) => {
        listener(staleSelection);
        return () => undefined;
      }
    );
    createThreadMock.mockResolvedValue(thread);
    sendMessageMock.mockReturnValue(
      (async function* () {
        yield createEnvelope({
          type: 'message_delta',
          delta: 'Fresh selection received.'
        });
      })()
    );

    const { default: App } = await import('../../entrypoints/sidepanel/App');
    render(<App />);

    await screen.findByText('Riv docs');
    await screen.findByText('Old highlighted text.');

    fireEvent.change(
      screen.getByPlaceholderText('Ask Riv about this page...'),
      {
        target: {
          value: 'Use the current selection'
        }
      }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledTimes(1);
    });

    expect(sendMessageMock).toHaveBeenCalledWith(
      'thread_1',
      'Use the current selection',
      expect.arrayContaining([
        {
          kind: 'selection',
          selection: freshSelection
        }
      ])
    );
  });

  it('hydrates the most recently updated local thread with its messages and proposals on startup', async () => {
    const olderThread: ConversationThread = {
      id: 'thread_older',
      userId: 'user_dev',
      title: 'Older thread',
      createdAt: '2026-03-29T14:00:00.000Z',
      updatedAt: '2026-03-29T14:30:00.000Z'
    };
    const newerThread: ConversationThread = {
      id: 'thread_newer',
      userId: 'user_dev',
      title: 'Newer thread',
      createdAt: '2026-03-29T15:00:00.000Z',
      updatedAt: '2026-03-29T15:45:00.000Z'
    };
    const newerMessage: ConversationMessage = {
      id: 'message_newer',
      threadId: newerThread.id,
      role: 'assistant',
      content: 'Recovered locally persisted answer.',
      attachments: [],
      toolInvocations: [],
      createdAt: '2026-03-29T15:40:00.000Z'
    };
    const newerProposal: ActionProposal = {
      id: 'proposal_1',
      threadId: newerThread.id,
      kind: 'focusTab',
      reason: 'The API reference tab looks most relevant.',
      preview: {
        title: 'Focus the API reference tab',
        summary: 'Bring the API reference into view.',
        items: ['docs.riv.dev/api']
      },
      riskLevel: 'low',
      requiresConfirmation: true,
      payload: {
        tabId: 8
      },
      createdAt: '2026-03-29T15:41:00.000Z'
    };

    await conversationStore.upsertThread(olderThread);
    await conversationStore.upsertThread(newerThread);
    await conversationStore.upsertMessage({
      id: 'message_older',
      threadId: olderThread.id,
      role: 'assistant',
      content: 'Older answer.',
      attachments: [],
      toolInvocations: [],
      createdAt: '2026-03-29T14:10:00.000Z'
    });
    await conversationStore.upsertMessage(newerMessage);
    await conversationStore.upsertProposal(newerProposal);

    sendBackgroundMessageMock.mockImplementation(
      async (message: { type: string }) => {
        if (message.type === 'riv/read-active-page') {
          return pageSnapshot;
        }

        if (message.type === 'riv/read-selection') {
          return null;
        }

        return null;
      }
    );
    subscribeToPreparedSelectionMock.mockReturnValue(() => undefined);

    const { default: App } = await import('../../entrypoints/sidepanel/App');
    render(<App />);

    await screen.findByText('Recovered locally persisted answer.');
    expect(screen.getByText('Focus the API reference tab')).toBeDefined();
    expect(createThreadMock).not.toHaveBeenCalled();
  });

  it('persists created threads and strips transient page and selection attachments from local messages', async () => {
    const thread: ConversationThread = {
      id: 'thread_1',
      userId: 'user_dev',
      title: 'Riv docs',
      createdAt: NOW,
      updatedAt: NOW
    };
    const preparedSelection: SelectedTextContext = {
      tabId: 7,
      url: 'https://docs.riv.dev',
      title: 'Riv docs',
      text: 'Persist this without keeping transient attachments.',
      capturedAt: NOW
    };

    sendBackgroundMessageMock.mockImplementation(
      async (message: { type: string }) => {
        if (message.type === 'riv/read-active-page') {
          return pageSnapshot;
        }

        if (message.type === 'riv/read-selection') {
          return preparedSelection;
        }

        return null;
      }
    );
    subscribeToPreparedSelectionMock.mockReturnValue(() => undefined);
    createThreadMock.mockResolvedValue(thread);
    sendMessageMock.mockReturnValue(
      (async function* () {
        yield createEnvelope({
          type: 'message_delta',
          delta: 'Persisted assistant answer.'
        });
      })()
    );

    const { default: App } = await import('../../entrypoints/sidepanel/App');
    render(<App />);

    await screen.findByText('Riv docs');

    fireEvent.change(
      screen.getByPlaceholderText('Ask Riv about this page...'),
      {
        target: {
          value: 'Persist this exchange'
        }
      }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await screen.findByText('Persisted assistant answer.');

    const detail = await conversationStore.getLatestThreadDetail();

    expect(detail?.thread.id).toBe('thread_1');
    expect(detail?.messages).toHaveLength(2);
    expect(detail?.messages[0]?.content).toBe('Persist this exchange');
    expect(detail?.messages[0]?.attachments).toEqual([]);
    expect(detail?.messages[1]).toMatchObject({
      role: 'assistant',
      content: 'Persisted assistant answer.',
      attachments: []
    });
  });

  it('persists proposals locally and removes them after confirmation while storing the action result message', async () => {
    const thread: ConversationThread = {
      id: 'thread_1',
      userId: 'user_dev',
      title: 'Riv docs',
      createdAt: NOW,
      updatedAt: NOW
    };
    const proposal: ActionProposal = {
      id: 'proposal_1',
      threadId: thread.id,
      kind: 'focusTab',
      reason: 'The documentation tab is the best match.',
      preview: {
        title: 'Focus the documentation tab',
        summary: 'Switch to docs.riv.dev.',
        items: ['docs.riv.dev']
      },
      riskLevel: 'low',
      requiresConfirmation: true,
      payload: {
        tabId: 7
      },
      createdAt: NOW
    };
    const result: ActionExecutionResult = {
      proposalId: proposal.id,
      status: 'executed',
      summary: 'Focused the documentation tab.',
      affectedTabs: [
        {
          tabId: 7,
          title: 'Riv docs',
          url: 'https://docs.riv.dev'
        }
      ],
      executedAt: '2026-03-29T15:03:00.000Z'
    };

    sendBackgroundMessageMock.mockImplementation(
      async (message: { type: string }) => {
        if (message.type === 'riv/read-active-page') {
          return pageSnapshot;
        }

        if (message.type === 'riv/read-selection') {
          return null;
        }

        if (message.type === 'riv/confirm-proposal') {
          return result;
        }

        return null;
      }
    );
    subscribeToPreparedSelectionMock.mockReturnValue(() => undefined);
    createThreadMock.mockResolvedValue(thread);
    resolveProposalMock.mockResolvedValue({
      result: {
        proposalId: proposal.id
      }
    });
    sendMessageMock.mockReturnValue(
      (async function* () {
        yield createEnvelope({
          type: 'proposal_created',
          proposal
        });
      })()
    );

    const { default: App } = await import('../../entrypoints/sidepanel/App');
    render(<App />);

    await screen.findByText('Riv docs');

    fireEvent.change(
      screen.getByPlaceholderText('Ask Riv about this page...'),
      {
        target: {
          value: 'Take the best next action'
        }
      }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await screen.findByText('Focus the documentation tab');

    let detail = await conversationStore.getLatestThreadDetail();
    expect(detail?.proposals).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await screen.findByText('Focused the documentation tab.');

    detail = await conversationStore.getLatestThreadDetail();
    expect(detail?.proposals).toEqual([]);
    expect(detail?.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Focused the documentation tab.',
      attachments: [
        {
          kind: 'actionResult',
          result
        }
      ]
    });
  });
});
