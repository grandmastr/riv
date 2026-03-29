import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AssistantStreamEvent,
  ConversationThread,
  MessageEnvelope,
  PageContextSnapshot,
  SelectedTextContext
} from '@riv/contracts';

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

vi.mock('../lib/api-client', () => ({
  createThread: createThreadMock,
  resolveProposal: resolveProposalMock,
  sendMessage: sendMessageMock
}));

vi.mock('../lib/messages', () => ({
  sendBackgroundMessage: sendBackgroundMessageMock,
  subscribeToPreparedSelection: subscribeToPreparedSelectionMock
}));

function createEnvelope(payload: AssistantStreamEvent): MessageEnvelope {
  return {
    version: '2026-03-29',
    type: 'assistant_stream',
    emittedAt: NOW,
    payload
  };
}

describe('sidepanel App', () => {
  beforeEach(() => {
    createThreadMock.mockReset();
    resolveProposalMock.mockReset();
    sendMessageMock.mockReset();
    sendBackgroundMessageMock.mockReset();
    subscribeToPreparedSelectionMock.mockReset();
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
          return null;
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
});
