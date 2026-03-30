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
  BrowserTabGroupSummary,
  BrowserTabSummary,
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

const browserTabs: BrowserTabSummary[] = [
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
];

const browserTabGroups: BrowserTabGroupSummary[] = [];

const sendStatelessTurnMock = vi.fn();
const sendBackgroundMessageMock = vi.fn();
const subscribeToPreparedSelectionMock = vi.fn();
const requestSidePanelToggleMock = vi.fn();
const localConversationStoreMocks = vi.hoisted(() => ({
  getConversationStore: vi.fn()
}));

vi.mock('../lib/api-client', () => ({
  sendStatelessTurn: sendStatelessTurnMock
}));

vi.mock('../lib/messages', () => ({
  sendBackgroundMessage: sendBackgroundMessageMock,
  subscribeToPreparedSelection: subscribeToPreparedSelectionMock,
  requestSidePanelToggle: requestSidePanelToggleMock
}));

vi.mock('../lib/local-conversation-store', async () => {
  const actual =
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
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
    sendStatelessTurnMock.mockReset();
    sendBackgroundMessageMock.mockReset();
    subscribeToPreparedSelectionMock.mockReset();
    requestSidePanelToggleMock.mockReset();
    localConversationStoreMocks.getConversationStore.mockReset();
    conversationStore = createInMemoryConversationStore();
    localConversationStoreMocks.getConversationStore.mockReturnValue(
      conversationStore
    );
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('local-thread-1');
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

    await conversationStore.upsertThread(thread);
    sendStatelessTurnMock.mockReturnValue(
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

  it('keeps streaming assistant deltas while assistant persistence is blocked', async () => {
    const baseStore = createInMemoryConversationStore();
    let releaseSecondDelta: (() => void) | undefined;
    let releaseAssistantPersistence: (() => void) | undefined;
    const secondDeltaGate = new Promise<void>((resolve) => {
      releaseSecondDelta = resolve;
    });
    const assistantPersistenceGate = new Promise<void>((resolve) => {
      releaseAssistantPersistence = resolve;
    });

    conversationStore = {
      ...baseStore,
      async upsertMessage(message) {
        if (message.role === 'assistant') {
          await assistantPersistenceGate;
        }

        await baseStore.upsertMessage(message);
      }
    };
    localConversationStoreMocks.getConversationStore.mockReturnValue(
      conversationStore
    );

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
    sendStatelessTurnMock.mockReturnValue(
      (async function* () {
        yield createEnvelope({
          type: 'message_delta',
          delta: 'First chunk. '
        });

        await secondDeltaGate;

        yield createEnvelope({
          type: 'message_delta',
          delta: 'Second chunk.'
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
          value: 'Stream without blocking'
        }
      }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByText('First chunk.')).toBeDefined();
    });

    releaseSecondDelta?.();

    await waitFor(() => {
      expect(screen.getByText('First chunk. Second chunk.')).toBeDefined();
    });

    releaseAssistantPersistence?.();
  });

  it('toggles the side panel on meta+j while the composer is focused', async () => {
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
    requestSidePanelToggleMock.mockResolvedValue(undefined);

    const { default: App } = await import('../../entrypoints/sidepanel/App');
    render(<App />);

    const composer = await screen.findByPlaceholderText(
      'Ask Riv about this page...'
    );

    fireEvent.keyDown(composer, {
      key: 'j',
      metaKey: true,
      bubbles: true,
      cancelable: true
    });

    await waitFor(() => {
      expect(requestSidePanelToggleMock).toHaveBeenCalledTimes(1);
    });
  });

  it('asks the browser to capitalize composer input by sentence', async () => {
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

    const composer = await screen.findByPlaceholderText(
      'Ask Riv about this page...'
    );

    expect(composer.getAttribute('autocapitalize')).toBe('sentences');
  });

  it('shows a transcript operation indicator until the first assistant delta arrives', async () => {
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
    await conversationStore.upsertThread(thread);
    sendStatelessTurnMock.mockReturnValue(
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
      expect(screen.getByText('Preparing response...')).toBeDefined();
    });

    releaseFirstDelta?.();

    await waitFor(() => {
      expect(screen.getByText('Working through the page now.')).toBeDefined();
    });
    expect(screen.queryByText('Preparing response...')).toBeNull();
  });

  it('shows web-search status while the model is searching', async () => {
    const thread: ConversationThread = {
      id: 'thread_1',
      userId: 'user_dev',
      title: 'Riv docs',
      createdAt: NOW,
      updatedAt: NOW
    };

    let releaseDelta: (() => void) | undefined;
    const deltaGate = new Promise<void>((resolve) => {
      releaseDelta = resolve;
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
    await conversationStore.upsertThread(thread);
    sendStatelessTurnMock.mockReturnValue(
      (async function* () {
        yield createEnvelope({
          type: 'tool_started',
          invocation: {
            id: 'tool_web_search_1',
            tool: 'searchWeb',
            kind: 'read',
            state: 'started',
            args: {
              query: 'CH good girl alternatives'
            },
            createdAt: NOW
          }
        });

        await deltaGate;

        yield createEnvelope({
          type: 'message_delta',
          delta: 'Here are alternatives I found with current listings.'
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
          value: 'Find alternatives'
        }
      }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByText('Searching web...')).toBeDefined();
    });

    releaseDelta?.();

    await waitFor(() => {
      expect(
        screen.getByText('Here are alternatives I found with current listings.')
      ).toBeDefined();
    });
    expect(screen.queryByText('Searching web...')).toBeNull();
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
    await conversationStore.upsertThread(thread);
    sendStatelessTurnMock.mockReturnValue(
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
      expect(sendStatelessTurnMock).toHaveBeenCalledTimes(1);
    });

    expect(sendStatelessTurnMock).toHaveBeenCalledWith({
      thread: expect.objectContaining({
        id: thread.id,
        title: thread.title,
        userId: thread.userId
      }),
      messages: [],
      content: 'Answer using the prepared selection',
      attachments: expect.arrayContaining([
        expect.objectContaining({
          kind: 'page'
        }),
        {
          kind: 'selection',
          selection: preparedSelection
        }
      ])
    });
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
    await conversationStore.upsertThread(thread);
    sendStatelessTurnMock.mockReturnValue(
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
      expect(sendStatelessTurnMock).toHaveBeenCalledTimes(1);
    });

    expect(activePageReads).toBe(2);
    expect(sendStatelessTurnMock).toHaveBeenCalledWith({
      thread: expect.objectContaining({
        id: thread.id,
        title: thread.title,
        userId: thread.userId
      }),
      messages: [],
      content: 'What changed on this page?',
      attachments: expect.arrayContaining([
        {
          kind: 'page',
          snapshot: navigatedSnapshot
        }
      ])
    });
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
    await conversationStore.upsertThread(thread);
    sendStatelessTurnMock.mockReturnValue(
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
      expect(sendStatelessTurnMock).toHaveBeenCalledTimes(1);
    });

    expect(sendStatelessTurnMock).toHaveBeenCalledWith({
      thread: expect.objectContaining({
        id: thread.id,
        title: thread.title,
        userId: thread.userId
      }),
      messages: [],
      content: 'Use the current selection',
      attachments: expect.arrayContaining([
        {
          kind: 'selection',
          selection: freshSelection
        }
      ])
    });
  });

  it('still sends the turn when page context collection fails', async () => {
    const thread: ConversationThread = {
      id: 'thread_1',
      userId: 'user_dev',
      title: 'Riv docs',
      createdAt: NOW,
      updatedAt: NOW
    };

    sendBackgroundMessageMock.mockImplementation(
      async (message: { type: string }) => {
        if (message.type === 'riv/read-active-page') {
          throw new Error('Receiving end does not exist.');
        }

        if (message.type === 'riv/read-selection') {
          throw new Error('Receiving end does not exist.');
        }

        return null;
      }
    );
    subscribeToPreparedSelectionMock.mockReturnValue(() => undefined);
    await conversationStore.upsertThread(thread);
    sendStatelessTurnMock.mockReturnValue(
      (async function* () {
        yield createEnvelope({
          type: 'message_delta',
          delta: 'Fallback send worked.'
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
          value: 'Just answer'
        }
      }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(sendStatelessTurnMock).toHaveBeenCalledTimes(1);
    });

    expect(sendStatelessTurnMock).toHaveBeenCalledWith({
      thread: expect.objectContaining({
        id: thread.id,
        title: thread.title,
        userId: thread.userId
      }),
      messages: [],
      content: 'Just answer',
      attachments: []
    });

    await screen.findByText('Fallback send worked.');
  });

  it('surfaces a visible assistant error when sending the turn fails', async () => {
    const thread: ConversationThread = {
      id: 'thread_1',
      userId: 'user_dev',
      title: 'Riv docs',
      createdAt: NOW,
      updatedAt: NOW
    };

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
    await conversationStore.upsertThread(thread);
    sendStatelessTurnMock.mockReturnValue(
      (async function* () {
        throw new Error('Failed to fetch');
      })()
    );

    const { default: App } = await import('../../entrypoints/sidepanel/App');
    render(<App />);

    await screen.findByText('Riv docs');

    fireEvent.change(
      screen.getByPlaceholderText('Ask Riv about this page...'),
      {
        target: {
          value: 'Why no answer?'
        }
      }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await screen.findByText(
      "Riv couldn't complete that request: Failed to fetch"
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
    expect(sendStatelessTurnMock).not.toHaveBeenCalled();
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
    sendStatelessTurnMock.mockReturnValue(
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

    expect(detail?.thread.id).toBe('thread_local-thread-1');
    expect(detail?.messages).toHaveLength(2);
    expect(detail?.messages[0]?.content).toBe('Persist this exchange');
    expect(detail?.messages[0]?.attachments).toEqual([]);
    expect(detail?.messages[1]).toMatchObject({
      role: 'assistant',
      content: 'Persisted assistant answer.',
      attachments: []
    });
  });

  it('includes live tab context for tab-management requests without persisting stale tab snapshots', async () => {
    sendBackgroundMessageMock.mockImplementation(
      async (message: { type: string }) => {
        if (message.type === 'riv/read-active-page') {
          return pageSnapshot;
        }

        if (message.type === 'riv/read-selection') {
          return null;
        }

        if (message.type === 'riv/list-tabs') {
          return browserTabs;
        }

        if (message.type === 'riv/list-tab-groups') {
          return browserTabGroups;
        }

        return null;
      }
    );
    subscribeToPreparedSelectionMock.mockReturnValue(() => undefined);
    sendStatelessTurnMock.mockReturnValue(
      (async function* () {
        yield createEnvelope({
          type: 'proposal_created',
          proposal: {
            id: 'proposal_tabs',
            threadId: 'thread_local-thread-1',
            kind: 'groupTabs',
            reason: 'The tabs all belong to Riv work.',
            preview: {
              title: 'Group Riv tabs',
              summary: 'Create one group for the current Riv tabs.',
              items: ['Riv docs', 'Riv repo']
            },
            riskLevel: 'low',
            requiresConfirmation: true,
            payload: {
              tabIds: [7, 8],
              title: 'Riv work'
            },
            createdAt: NOW
          }
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
          value: 'Group the browser tabs'
        }
      }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(sendStatelessTurnMock).toHaveBeenCalledTimes(1);
    });

    expect(sendStatelessTurnMock).toHaveBeenCalledWith({
      thread: expect.objectContaining({
        id: 'thread_local-thread-1',
        title: 'Riv docs',
        userId: 'user_dev'
      }),
      messages: [],
      content: 'Group the browser tabs',
      attachments: expect.arrayContaining([
        {
          kind: 'tabs',
          tabs: browserTabs
        },
        {
          kind: 'tabGroups',
          tabGroups: browserTabGroups
        }
      ])
    });

    const detail = await conversationStore.getLatestThreadDetail();
    expect(detail?.messages[0]?.attachments).toEqual([]);
  });

  it('treats continuation phrasing as a tab-management request when recent assistant context references tabs', async () => {
    let activePageReads = 0;
    let selectionReads = 0;
    const existingThread: ConversationThread = {
      id: 'thread_existing',
      userId: 'user_dev',
      title: 'Riv docs',
      createdAt: NOW,
      updatedAt: NOW
    };
    const assistantContextMessage: ConversationMessage = {
      id: 'message_assistant_existing',
      threadId: existingThread.id,
      role: 'assistant',
      content:
        'I can group your tabs by category. Want me to apply these groups now?',
      attachments: [],
      toolInvocations: [],
      createdAt: NOW
    };

    await conversationStore.upsertThread(existingThread);
    await conversationStore.upsertMessage(assistantContextMessage);

    sendBackgroundMessageMock.mockImplementation(
      async (message: { type: string }) => {
        if (message.type === 'riv/read-active-page') {
          activePageReads += 1;
          return pageSnapshot;
        }

        if (message.type === 'riv/read-selection') {
          selectionReads += 1;
          return null;
        }

        if (message.type === 'riv/list-tabs') {
          return browserTabs;
        }

        if (message.type === 'riv/list-tab-groups') {
          return browserTabGroups;
        }

        return null;
      }
    );
    subscribeToPreparedSelectionMock.mockReturnValue(() => undefined);
    sendStatelessTurnMock.mockReturnValue(
      (async function* () {
        yield createEnvelope({
          type: 'message_delta',
          delta: 'Applying grouping now.'
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
          value: 'Looks good, group them'
        }
      }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(sendStatelessTurnMock).toHaveBeenCalledTimes(1);
    });

    const request = sendStatelessTurnMock.mock.calls[0]?.[0] as {
      content: string;
      attachments: unknown[];
    };

    expect(request.content).toBe('Looks good, group them');
    expect(request.attachments).toEqual(
      expect.arrayContaining([
        {
          kind: 'tabs',
          tabs: browserTabs
        },
        {
          kind: 'tabGroups',
          tabGroups: browserTabGroups
        }
      ])
    );
    expect(activePageReads).toBe(1);
    expect(selectionReads).toBe(1);
  });

  it('skips page and selection reads for tab-management requests so tab actions start faster', async () => {
    let activePageReads = 0;
    let selectionReads = 0;

    sendBackgroundMessageMock.mockImplementation(
      async (message: { type: string }) => {
        if (message.type === 'riv/read-active-page') {
          activePageReads += 1;
          return pageSnapshot;
        }

        if (message.type === 'riv/read-selection') {
          selectionReads += 1;
          return null;
        }

        if (message.type === 'riv/list-tabs') {
          return browserTabs;
        }

        if (message.type === 'riv/list-tab-groups') {
          return browserTabGroups;
        }

        return null;
      }
    );
    subscribeToPreparedSelectionMock.mockReturnValue(() => undefined);
    sendStatelessTurnMock.mockReturnValue(
      (async function* () {
        yield createEnvelope({
          type: 'proposal_created',
          proposal: {
            id: 'proposal_fast_tabs',
            threadId: 'thread_local-thread-1',
            kind: 'groupTabs',
            reason: 'The tabs all belong together.',
            preview: {
              title: 'Group video tabs',
              summary: 'Create one tab group.',
              items: ['Riv docs', 'Riv repo']
            },
            riskLevel: 'low',
            requiresConfirmation: true,
            payload: {
              tabIds: [7, 8],
              title: 'Videos'
            },
            createdAt: NOW
          }
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
          value: 'Group the browser tabs'
        }
      }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(sendStatelessTurnMock).toHaveBeenCalledTimes(1);
    });

    expect(activePageReads).toBe(1);
    expect(selectionReads).toBe(1);
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
    await conversationStore.upsertThread(thread);
    sendStatelessTurnMock.mockReturnValue(
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

    await waitFor(() => {
      expect(sendBackgroundMessageMock).toHaveBeenCalledWith({
        type: 'riv/register-proposal',
        proposal
      });
      expect(sendBackgroundMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'riv/confirm-proposal',
          proposal,
          confirmation: expect.objectContaining({
            proposalId: proposal.id,
            decision: 'confirm'
          })
        })
      );
    });

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

  it('shows a visible error when resolving a proposal fails', async () => {
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

    sendBackgroundMessageMock.mockImplementation(
      async (message: { type: string }) => {
        if (message.type === 'riv/read-active-page') {
          return pageSnapshot;
        }

        if (message.type === 'riv/read-selection') {
          return null;
        }

        if (message.type === 'riv/confirm-proposal') {
          return null;
        }

        return null;
      }
    );
    subscribeToPreparedSelectionMock.mockReturnValue(() => undefined);
    await conversationStore.upsertThread(thread);
    sendStatelessTurnMock.mockReturnValue(
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

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await screen.findByText(
      "Riv couldn't confirm that suggestion: Riv could not resolve that suggestion. Please try again."
    );
  });
});
