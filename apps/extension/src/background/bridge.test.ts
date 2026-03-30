import { describe, expect, it, vi } from 'vitest';

import {
  ActionExecutionResultSchema,
  ActionProposalSchema,
  BrowserTabSummarySchema,
  PageContextSnapshotSchema
} from '@riv/contracts';

import {
  createBackgroundBridge,
  type BackgroundBridgeBrowserApi
} from './bridge';

const NOW = '2026-03-29T15:00:00.000Z';

function createBrowserApi(): BackgroundBridgeBrowserApi {
  return {
    getActiveTab: vi.fn().mockResolvedValue({
      id: 11,
      windowId: 2,
      index: 0,
      url: 'https://docs.riv.dev/extension',
      title: 'Riv extension docs',
      active: true,
      pinned: false,
      groupId: -1,
      favIconUrl: 'https://docs.riv.dev/favicon.ico'
    }),
    listTabs: vi.fn().mockResolvedValue([
      {
        id: 11,
        windowId: 2,
        index: 0,
        url: 'https://docs.riv.dev/extension',
        title: 'Riv extension docs',
        active: true,
        pinned: false,
        groupId: -1,
        favIconUrl: 'https://docs.riv.dev/favicon.ico'
      },
      {
        id: 12,
        windowId: 2,
        index: 1,
        url: 'https://example.com/duplicate',
        title: 'Duplicate tab',
        active: false,
        pinned: false,
        groupId: -1
      }
    ]),
    listTabGroups: vi.fn().mockResolvedValue([]),
    readPageContext: vi.fn().mockResolvedValue({
      tabId: 11,
      url: 'https://docs.riv.dev/extension',
      title: 'Riv extension docs',
      pageType: 'documentation',
      capturedAt: NOW,
      metadata: {
        description: 'Docs'
      },
      contentBlocks: [
        {
          id: 'heading-1',
          kind: 'heading',
          text: 'Riv extension docs',
          level: 1
        }
      ]
    }),
    readSelection: vi.fn().mockResolvedValue(null),
    groupTabs: vi.fn().mockResolvedValue({
      groupId: 42,
      windowId: 2,
      title: 'Docs',
      color: 'blue',
      collapsed: false,
      tabIds: [11, 12]
    }),
    moveTabs: vi.fn().mockResolvedValue(undefined),
    closeTabs: vi.fn().mockResolvedValue(undefined),
    focusTab: vi.fn().mockResolvedValue({
      id: 11,
      windowId: 2,
      index: 0,
      url: 'https://docs.riv.dev/extension',
      title: 'Riv extension docs',
      active: true,
      pinned: false,
      groupId: -1
    })
  };
}

describe('createBackgroundBridge', () => {
  it('reads the active page through the browser adapter', async () => {
    const bridge = createBackgroundBridge(createBrowserApi(), {
      now: () => NOW,
      randomId: () => 'proposal_1'
    });

    const snapshot = await bridge.readActivePage();

    expect(PageContextSnapshotSchema.parse(snapshot)).toMatchObject({
      tabId: 11,
      pageType: 'documentation'
    });
  });

  it('does not execute write actions until they are confirmed', async () => {
    const api = createBrowserApi();
    const bridge = createBackgroundBridge(api, {
      now: () => NOW,
      randomId: () => 'proposal_1'
    });

    const proposal = await bridge.createProposal({
      threadId: 'thread_1',
      kind: 'closeTabs',
      reason: 'Close duplicate tabs after confirming with the user.',
      preview: {
        title: 'Close 1 duplicate tab',
        summary: 'Remove the duplicate documentation tab.',
        items: ['Duplicate tab']
      },
      riskLevel: 'high',
      payload: {
        tabIds: [12]
      }
    });

    expect(ActionProposalSchema.parse(proposal)).toMatchObject({
      id: 'proposal_1',
      requiresConfirmation: true,
      kind: 'closeTabs'
    });
    expect(api.closeTabs).not.toHaveBeenCalled();

    const rejected = await bridge.confirmProposal({
      proposalId: 'proposal_1',
      threadId: 'thread_1',
      actorUserId: 'user_1',
      decision: 'reject',
      confirmedAt: NOW
    });

    expect(ActionExecutionResultSchema.parse(rejected)).toMatchObject({
      proposalId: 'proposal_1',
      status: 'rejected'
    });
    expect(api.closeTabs).not.toHaveBeenCalled();
  });

  it('executes confirmed write actions and reports affected tabs', async () => {
    const api = createBrowserApi();
    const bridge = createBackgroundBridge(api, {
      now: () => NOW,
      randomId: () => 'proposal_2'
    });

    await bridge.createProposal({
      threadId: 'thread_1',
      kind: 'groupTabs',
      reason: 'Keep related docs together.',
      preview: {
        title: 'Group 2 docs tabs',
        summary: 'Create a Docs group.',
        items: ['Riv extension docs', 'Duplicate tab']
      },
      riskLevel: 'medium',
      payload: {
        tabIds: [11, 12],
        title: 'Docs',
        color: 'blue'
      }
    });

    const result = await bridge.confirmProposal({
      proposalId: 'proposal_2',
      threadId: 'thread_1',
      actorUserId: 'user_1',
      decision: 'confirm',
      confirmedAt: NOW
    });

    expect(ActionExecutionResultSchema.parse(result)).toMatchObject({
      proposalId: 'proposal_2',
      status: 'executed',
      affectedTabs: [
        { tabId: 11, title: 'Riv extension docs' },
        { tabId: 12, title: 'Duplicate tab' }
      ]
    });
    expect(api.groupTabs).toHaveBeenCalledWith({
      tabIds: [11, 12],
      title: 'Docs',
      color: 'blue'
    });
  });

  it('executes multi-group payloads when proposal includes category groups', async () => {
    const api = createBrowserApi();
    const bridge = createBackgroundBridge(api, {
      now: () => NOW,
      randomId: () => 'proposal_multi_group'
    });

    await bridge.createProposal({
      threadId: 'thread_1',
      kind: 'groupTabs',
      reason: 'Group tabs by category.',
      preview: {
        title: 'Group tabs by category',
        summary: 'Create category groups for related tabs.',
        items: ['Work', 'Media']
      },
      riskLevel: 'low',
      payload: {
        groups: [
          {
            tabIds: [11],
            title: 'Work',
            color: 'blue'
          },
          {
            tabIds: [12],
            title: 'Research',
            color: 'purple'
          }
        ]
      }
    });

    const result = await bridge.confirmProposal({
      proposalId: 'proposal_multi_group',
      threadId: 'thread_1',
      actorUserId: 'user_1',
      decision: 'confirm',
      confirmedAt: NOW
    });

    expect(ActionExecutionResultSchema.parse(result)).toMatchObject({
      proposalId: 'proposal_multi_group',
      status: 'executed',
      summary: 'Grouped tabs into 2 groups.'
    });
    expect(api.groupTabs).toHaveBeenNthCalledWith(1, {
      tabIds: [11],
      title: 'Work',
      color: 'blue'
    });
    expect(api.groupTabs).toHaveBeenNthCalledWith(2, {
      tabIds: [12],
      title: 'Research',
      color: 'purple'
    });
  });

  it('confirms using the provided fallback proposal when bridge memory is cold', async () => {
    const api = createBrowserApi();
    const bridge = createBackgroundBridge(api, {
      now: () => NOW,
      randomId: () => 'proposal_5'
    });
    const fallbackProposal = ActionProposalSchema.parse({
      id: 'proposal_fallback',
      threadId: 'thread_1',
      kind: 'groupTabs',
      reason: 'Keep related docs together.',
      preview: {
        title: 'Group 2 docs tabs',
        summary: 'Create a Docs group.',
        items: ['Riv extension docs', 'Duplicate tab']
      },
      riskLevel: 'medium',
      requiresConfirmation: true,
      payload: {
        tabIds: [11, 12],
        title: 'Docs',
        color: 'blue'
      },
      createdAt: NOW
    });

    const result = await bridge.confirmProposal(
      {
        proposalId: 'proposal_fallback',
        threadId: 'thread_1',
        actorUserId: 'user_1',
        decision: 'confirm',
        confirmedAt: NOW
      },
      fallbackProposal
    );

    expect(ActionExecutionResultSchema.parse(result)).toMatchObject({
      proposalId: 'proposal_fallback',
      status: 'executed'
    });
    expect(api.groupTabs).toHaveBeenCalledWith({
      tabIds: [11, 12],
      title: 'Docs',
      color: 'blue'
    });
  });

  it('maps tabs into the shared browser summary contract', async () => {
    const bridge = createBackgroundBridge(createBrowserApi(), {
      now: () => NOW,
      randomId: () => 'proposal_3'
    });

    const tabs = await bridge.listTabs();

    expect(tabs.map((tab) => BrowserTabSummarySchema.parse(tab).tabId)).toEqual(
      [11, 12]
    );
  });

  it('drops invalid favicon URLs from tab summaries', async () => {
    const api = createBrowserApi();
    vi.mocked(api.listTabs).mockResolvedValue([
      {
        id: 11,
        windowId: 2,
        index: 0,
        url: 'https://docs.riv.dev/extension',
        title: 'Riv extension docs',
        active: true,
        pinned: false,
        groupId: -1,
        favIconUrl: ''
      }
    ]);
    const bridge = createBackgroundBridge(api, {
      now: () => NOW,
      randomId: () => 'proposal_4'
    });

    const [tab] = await bridge.listTabs();

    expect(BrowserTabSummarySchema.parse(tab)).toMatchObject({
      tabId: 11,
      favIconUrl: undefined
    });
  });
});
