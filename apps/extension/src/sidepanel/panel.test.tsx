import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  ActionProposal,
  ConversationMessage,
  ContextAttachment,
  SelectedTextContext
} from '@riv/contracts';

import { RivSidepanel } from './panel';

const NOW = '2026-03-29T15:00:00.000Z';

const pageAttachment: ContextAttachment = {
  kind: 'page',
  snapshot: {
    tabId: 7,
    url: 'https://docs.riv.dev',
    title: 'Riv docs',
    pageType: 'documentation',
    capturedAt: NOW,
    metadata: {
      section: 'overview'
    },
    contentBlocks: []
  }
};

const formPageAttachment: ContextAttachment = {
  kind: 'page',
  snapshot: {
    tabId: 9,
    url: 'https://example.com/form',
    title: 'Signup',
    pageType: 'form',
    capturedAt: NOW,
    metadata: {},
    contentBlocks: []
  }
};

const selectionAttachment: ContextAttachment = {
  kind: 'selection',
  selection: {
    tabId: 9,
    url: 'https://example.com/form',
    title: 'Signup',
    text: 'Selected signup copy',
    capturedAt: NOW
  }
};

const messages: ConversationMessage[] = [
  {
    id: 'message_1',
    threadId: 'thread_1',
    role: 'assistant',
    content: 'I reviewed the current page and I can group related tabs.',
    attachments: [pageAttachment],
    toolInvocations: [],
    createdAt: NOW
  }
];

const proposals: ActionProposal[] = [
  {
    id: 'proposal_1',
    threadId: 'thread_1',
    kind: 'groupTabs',
    reason: 'These tabs are all about the same feature.',
    preview: {
      title: 'Group Riv tabs',
      summary: 'Collect the current research tabs into one group.',
      items: ['Riv docs', 'Riv API']
    },
    riskLevel: 'low',
    requiresConfirmation: true,
    payload: {
      tabIds: [7, 8],
      title: 'Riv'
    },
    createdAt: NOW
  }
];

const preparedSelection: SelectedTextContext = {
  tabId: 7,
  url: 'https://docs.riv.dev',
  title: 'Riv docs',
  text: 'Highlighting text should prepare it for the next message.',
  capturedAt: NOW
};

afterEach(() => {
  cleanup();
});

describe('RivSidepanel', () => {
  it('renders conversation context and forwards proposal decisions', () => {
    const onSend = vi.fn();
    const onResolveProposal = vi.fn();

    render(
      <RivSidepanel
        threadTitle="Riv workspace"
        messages={messages}
        proposals={proposals}
        preparedSelection={preparedSelection}
        isSending={false}
        onSend={onSend}
        onResolveProposal={onResolveProposal}
      />
    );

    expect(screen.getByText('Riv workspace')).toBeDefined();
    expect(screen.queryByText('Page-aware assistant')).toBeNull();
    expect(
      screen.getByText(
        'I reviewed the current page and I can group related tabs.'
      )
    ).toBeDefined();
    expect(screen.getByText('page')).toBeDefined();
    expect(screen.getByText('documentation')).toBeDefined();
    expect(screen.getByText('Group Riv tabs')).toBeDefined();
    expect(
      screen.getByText(
        'Highlighting text should prepare it for the next message.'
      )
    ).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    expect(onResolveProposal).toHaveBeenNthCalledWith(
      1,
      'proposal_1',
      'confirm'
    );
    expect(onResolveProposal).toHaveBeenNthCalledWith(
      2,
      'proposal_1',
      'reject'
    );

    fireEvent.change(
      screen.getByPlaceholderText('Ask Riv about this page...'),
      {
        target: {
          value: 'Summarize the current tab'
        }
      }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSend).toHaveBeenCalledWith('Summarize the current tab');
  });

  it('renders assistant markdown with real structure', () => {
    const onSend = vi.fn();
    const onResolveProposal = vi.fn();
    const markdownMessages: ConversationMessage[] = [
      {
        id: 'message_markdown',
        threadId: 'thread_1',
        role: 'assistant',
        content: '## Summary\n\n- First point\n- Second point',
        attachments: [],
        toolInvocations: [],
        createdAt: NOW
      }
    ];

    render(
      <RivSidepanel
        threadTitle="Riv workspace"
        messages={markdownMessages}
        proposals={[]}
        preparedSelection={null}
        isSending={false}
        onSend={onSend}
        onResolveProposal={onResolveProposal}
      />
    );

    expect(
      screen.getByRole('heading', { level: 2, name: 'Summary' })
    ).toBeDefined();
    expect(screen.getByText('First point')).toBeDefined();
    expect(screen.getByText('Second point')).toBeDefined();
  });

  it('does not render the old empty-state prompt line', () => {
    render(
      <RivSidepanel
        threadTitle="Riv workspace"
        messages={[]}
        proposals={[]}
        preparedSelection={null}
        isSending={false}
        onSend={vi.fn()}
        onResolveProposal={vi.fn()}
      />
    );

    expect(screen.getByText('Assistant ready')).toBeDefined();
    expect(
      screen.queryByText(
        'Ask about the page in front of you, a selected passage, or the tabs you have open.'
      )
    ).toBeNull();
  });

  it('shows a Claude-style thinking row while waiting on the first assistant reply', () => {
    const { container } = render(
      <RivSidepanel
        threadTitle="Riv workspace"
        messages={[
          {
            id: 'message_user_waiting',
            threadId: 'thread_1',
            role: 'user',
            content: 'What changed on this page?',
            attachments: [],
            toolInvocations: [],
            createdAt: NOW
          }
        ]}
        proposals={[]}
        preparedSelection={null}
        isSending={true}
        onSend={vi.fn()}
        onResolveProposal={vi.fn()}
      />
    );

    expect(screen.getByText('Riv is thinking')).toBeDefined();
    expect(container.querySelectorAll('.riv-thinking-dot')).toHaveLength(3);
  });

  it('hides page-derived pills inside user bubbles while keeping direct context labels', () => {
    const { container } = render(
      <RivSidepanel
        threadTitle="Riv workspace"
        messages={[
          {
            id: 'message_user_1',
            threadId: 'thread_1',
            role: 'user',
            content: 'Use this selected text.',
            attachments: [formPageAttachment, selectionAttachment],
            toolInvocations: [],
            createdAt: NOW
          }
        ]}
        proposals={[]}
        preparedSelection={null}
        isSending={false}
        onSend={vi.fn()}
        onResolveProposal={vi.fn()}
      />
    );

    expect(screen.getByText('selection')).toBeDefined();
    expect(screen.queryByText('page')).toBeNull();
    expect(screen.queryByText('form')).toBeNull();
    expect(container.querySelector('.riv-scroll-aura-top')).toBeTruthy();
    expect(container.querySelector('.riv-scroll-aura-bottom')).toBeTruthy();
  });

  it('submits the composer with plain enter', () => {
    const onSend = vi.fn();

    render(
      <RivSidepanel
        threadTitle="Riv workspace"
        messages={messages}
        proposals={[]}
        preparedSelection={null}
        isSending={false}
        onSend={onSend}
        onResolveProposal={vi.fn()}
      />
    );

    const composer = screen.getByPlaceholderText(
      'Ask Riv about this page...'
    ) as HTMLTextAreaElement;
    expect(composer.rows).toBe(2);
    fireEvent.change(composer, {
      target: {
        value: 'Use the selected article as context'
      }
    });

    fireEvent.keyDown(composer, {
      key: 'Enter'
    });

    expect(onSend).toHaveBeenCalledWith('Use the selected article as context');
  });

  it('uses an icon-style send control with an accessible label', () => {
    render(
      <RivSidepanel
        threadTitle="Riv workspace"
        messages={messages}
        proposals={[]}
        preparedSelection={null}
        isSending={false}
        onSend={vi.fn()}
        onResolveProposal={vi.fn()}
      />
    );

    const sendButton = screen.getByRole('button', { name: 'Send message' });
    expect(sendButton.textContent?.trim()).toBe('');
  });

  it('renders prepared selection as a compact composer chip', () => {
    const { container } = render(
      <RivSidepanel
        threadTitle="Riv workspace"
        messages={messages}
        proposals={[]}
        preparedSelection={{
          ...preparedSelection,
          text: 'This is a deliberately long prepared selection that should be shortened before it is shown above the composer field so the chip stays compact.'
        }}
        isSending={false}
        onSend={vi.fn()}
        onResolveProposal={vi.fn()}
      />
    );

    expect(screen.queryByText('Selection ready')).toBeNull();

    const chip = container.querySelector('.riv-prepared-selection-chip');
    expect(chip).toBeTruthy();
    expect(chip?.textContent).toContain('selection');
    expect(chip?.textContent).toContain('This is a deliberately long prepared');
    expect(chip?.textContent).toContain('...');

    const composerShell = container.querySelector('.riv-composer-shell');
    expect(composerShell?.contains(chip ?? null)).toBe(true);
  });

  it('disables the send button until the composer has real content', () => {
    render(
      <RivSidepanel
        threadTitle="Riv workspace"
        messages={messages}
        proposals={[]}
        preparedSelection={null}
        isSending={false}
        onSend={vi.fn()}
        onResolveProposal={vi.fn()}
      />
    );

    const composer = screen.getByPlaceholderText('Ask Riv about this page...');
    const sendButton = screen.getByRole('button', { name: 'Send message' });

    expect((sendButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(composer, {
      target: {
        value: '   '
      }
    });

    expect((sendButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(composer, {
      target: {
        value: 'Summarize this page'
      }
    });

    expect((sendButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not render header status chrome', () => {
    render(
      <RivSidepanel
        threadTitle="Riv workspace"
        messages={messages}
        proposals={[]}
        preparedSelection={null}
        isSending={false}
        onSend={vi.fn()}
        onResolveProposal={vi.fn()}
      />
    );

    expect(screen.queryByText('Ready')).toBeNull();
    expect(
      screen.queryByText('Riv responded using the current page context.')
    ).toBeNull();
  });

  it('does not render composer helper chrome', () => {
    render(
      <RivSidepanel
        threadTitle="Riv workspace"
        messages={messages}
        proposals={[]}
        preparedSelection={null}
        isSending={false}
        onSend={vi.fn()}
        onResolveProposal={vi.fn()}
      />
    );

    expect(screen.queryByText('Message Riv')).toBeNull();
    expect(
      screen.queryByText('Enter sends. Shift + Enter adds a line.')
    ).toBeNull();
  });

  it('keeps shift enter for multiline composition', () => {
    const onSend = vi.fn();

    render(
      <RivSidepanel
        threadTitle="Riv workspace"
        messages={messages}
        proposals={[]}
        preparedSelection={null}
        isSending={false}
        onSend={onSend}
        onResolveProposal={vi.fn()}
      />
    );

    const composer = screen.getByPlaceholderText('Ask Riv about this page...');
    fireEvent.change(composer, {
      target: {
        value: 'Line one'
      }
    });

    fireEvent.keyDown(composer, {
      key: 'Enter',
      shiftKey: true
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('scrolls the transcript to the bottom when a new message arrives', () => {
    const { container, rerender } = render(
      <RivSidepanel
        threadTitle="Riv workspace"
        messages={messages}
        proposals={[]}
        preparedSelection={null}
        isSending={false}
        onSend={vi.fn()}
        onResolveProposal={vi.fn()}
      />
    );

    const transcript = container.querySelector('.riv-transcript');

    expect(transcript).toBeTruthy();

    if (!(transcript instanceof HTMLElement)) {
      throw new Error('Missing transcript container.');
    }

    Object.defineProperty(transcript, 'scrollHeight', {
      configurable: true,
      value: 480
    });

    transcript.scrollTop = 32;

    rerender(
      <RivSidepanel
        threadTitle="Riv workspace"
        messages={[
          ...messages,
          {
            id: 'message_2',
            threadId: 'thread_1',
            role: 'assistant',
            content: 'Here is the latest message in the thread.',
            attachments: [],
            toolInvocations: [],
            createdAt: NOW
          }
        ]}
        proposals={[]}
        preparedSelection={null}
        isSending={false}
        onSend={vi.fn()}
        onResolveProposal={vi.fn()}
      />
    );

    expect(transcript.scrollTop).toBe(480);
  });
});
