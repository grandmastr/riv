import { describe, expect, it } from 'vitest';

import {
  ActionConfirmationSchema,
  ActionProposalSchema,
  AssistantStreamEventSchema,
  BrowserTabSummarySchema,
  ContextAttachmentSchema,
  MessageEnvelopeSchema,
  PageContextSnapshotSchema
} from './index';

describe('contracts', () => {
  it('parses a valid page context snapshot', () => {
    const snapshot = PageContextSnapshotSchema.parse({
      tabId: 12,
      url: 'https://example.com/article',
      title: 'Example article',
      pageType: 'article',
      capturedAt: '2026-03-29T15:00:00.000Z',
      metadata: {
        byline: 'Ada'
      },
      contentBlocks: [
        {
          id: 'intro',
          kind: 'paragraph',
          text: 'Riv can read this page.'
        }
      ]
    });

    expect(snapshot.url).toBe('https://example.com/article');
    expect(snapshot.contentBlocks).toHaveLength(1);
  });

  it('rejects malformed page context snapshots', () => {
    expect(() =>
      PageContextSnapshotSchema.parse({
        tabId: 'bad-id',
        url: 'notaurl',
        title: 'Broken',
        pageType: 'article',
        capturedAt: 'not-a-date',
        metadata: {},
        contentBlocks: []
      })
    ).toThrow();
  });

  it('rejects malformed tab summaries', () => {
    expect(() =>
      BrowserTabSummarySchema.parse({
        tabId: 'abc',
        windowId: 1,
        index: 0,
        url: 'https://example.com',
        title: 'Example',
        active: true,
        pinned: false,
        groupId: -1
      })
    ).toThrow();
  });

  it('parses context attachments for tab inventories', () => {
    const attachment = ContextAttachmentSchema.parse({
      kind: 'tabs',
      tabs: [
        {
          tabId: 3,
          windowId: 1,
          index: 0,
          url: 'https://example.com',
          title: 'Example',
          active: true,
          pinned: false,
          groupId: -1
        }
      ]
    });

    expect(attachment.kind).toBe('tabs');
    expect(attachment.tabs[0]?.tabId).toBe(3);
  });

  it('parses action proposals and rejects missing confirmation requirements', () => {
    const proposal = ActionProposalSchema.parse({
      id: 'proposal_1',
      threadId: 'thread_1',
      kind: 'groupTabs',
      reason: 'These tabs are all about Riv',
      preview: {
        title: 'Group 3 related tabs',
        summary: 'Create a Riv research tab group',
        items: ['https://docs.riv.dev', 'https://example.com']
      },
      riskLevel: 'low',
      requiresConfirmation: true,
      payload: {
        tabIds: [1, 2, 3],
        title: 'Riv research'
      },
      createdAt: '2026-03-29T15:00:00.000Z'
    });

    expect(proposal.kind).toBe('groupTabs');

    expect(() =>
      ActionProposalSchema.parse({
        id: 'proposal_2',
        threadId: 'thread_1',
        kind: 'closeTabs',
        reason: 'Close duplicates',
        preview: {
          title: 'Close duplicate tabs',
          summary: 'Remove duplicates',
          items: []
        },
        riskLevel: 'high',
        payload: {
          tabIds: [4, 5]
        },
        createdAt: '2026-03-29T15:00:00.000Z'
      })
    ).toThrow();
  });

  it('rejects malformed action confirmations', () => {
    expect(() =>
      ActionConfirmationSchema.parse({
        proposalId: 'proposal_1',
        threadId: 'thread_1',
        decision: 'confirm'
      })
    ).toThrow();
  });

  it('parses message envelopes for assistant stream events', () => {
    const envelope = MessageEnvelopeSchema.parse({
      version: '2026-03-29',
      type: 'assistant_stream',
      emittedAt: '2026-03-29T15:00:00.000Z',
      payload: {
        type: 'proposal_created',
        proposal: {
          id: 'proposal_1',
          threadId: 'thread_1',
          kind: 'groupTabs',
          reason: 'These tabs are related',
          preview: {
            title: 'Group tabs',
            summary: 'Group related tabs',
            items: []
          },
          riskLevel: 'low',
          requiresConfirmation: true,
          payload: {
            tabIds: [1, 2]
          },
          createdAt: '2026-03-29T15:00:00.000Z'
        }
      }
    });

    expect(envelope.payload.type).toBe('proposal_created');
    expect(() => AssistantStreamEventSchema.parse({ type: 'unknown' })).toThrow();
  });
});
