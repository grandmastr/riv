import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ActionProposal, ConversationMessage, ContextAttachment } from '@riv/contracts';

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

describe('RivSidepanel', () => {
  it('renders conversation context and forwards proposal decisions', () => {
    const onSend = vi.fn();
    const onResolveProposal = vi.fn();

    render(
      <RivSidepanel
        threadTitle="Riv workspace"
        messages={messages}
        proposals={proposals}
        isSending={false}
        onSend={onSend}
        onResolveProposal={onResolveProposal}
      />
    );

    expect(screen.getByText('Riv workspace')).toBeDefined();
    expect(
      screen.getByText('I reviewed the current page and I can group related tabs.')
    ).toBeDefined();
    expect(screen.getByText('page')).toBeDefined();
    expect(screen.getByText('documentation')).toBeDefined();
    expect(screen.getByText('Group Riv tabs')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    expect(onResolveProposal).toHaveBeenNthCalledWith(1, 'proposal_1', 'confirm');
    expect(onResolveProposal).toHaveBeenNthCalledWith(2, 'proposal_1', 'reject');

    fireEvent.change(screen.getByPlaceholderText('Ask Riv about this page...'), {
      target: {
        value: 'Summarize the current tab'
      }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSend).toHaveBeenCalledWith('Summarize the current tab');
  });
});
