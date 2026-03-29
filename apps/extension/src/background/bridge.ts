import type {
  ActionConfirmation,
  ActionExecutionResult,
  ActionProposal,
  BrowserTabGroupSummary,
  BrowserTabSummary,
  PageContextSnapshot,
  SelectedTextContext
} from '@riv/contracts';

import type {
  RivBackgroundRequest,
  RivBackgroundResponse
} from '../lib/messages';

type BrowserTabLike = {
  id?: number;
  windowId: number;
  index: number;
  url?: string;
  title?: string;
  active: boolean;
  pinned: boolean;
  groupId?: number;
  favIconUrl?: string;
};

type GroupTabsInput = {
  tabIds: number[];
  title?: string;
  color?: BrowserTabGroupSummary['color'];
};

type MoveTabsInput = {
  tabIds: number[];
  index: number;
  windowId?: number;
};

export interface BackgroundBridgeBrowserApi {
  getActiveTab(): Promise<BrowserTabLike | null>;
  listTabs(): Promise<BrowserTabLike[]>;
  listTabGroups(): Promise<BrowserTabGroupSummary[]>;
  readPageContext(tabId?: number): Promise<PageContextSnapshot>;
  readSelection(tabId?: number): Promise<SelectedTextContext | null>;
  groupTabs(input: GroupTabsInput): Promise<BrowserTabGroupSummary>;
  moveTabs(input: MoveTabsInput): Promise<void>;
  closeTabs(tabIds: number[]): Promise<void>;
  focusTab(tabId: number): Promise<BrowserTabLike>;
}

type ProposalInput = Omit<
  ActionProposal,
  'id' | 'requiresConfirmation' | 'createdAt'
>;

type BridgeOptions = {
  now?: () => string;
  randomId?: () => string;
};

function mapTab(tab: BrowserTabLike): BrowserTabSummary {
  if (typeof tab.id !== 'number') {
    throw new Error('Tab is missing an id.');
  }

  return {
    tabId: tab.id,
    windowId: tab.windowId,
    index: tab.index,
    url: tab.url ?? 'about:blank',
    title: tab.title ?? 'Untitled tab',
    active: tab.active,
    pinned: tab.pinned,
    groupId: tab.groupId ?? -1,
    favIconUrl: tab.favIconUrl
  };
}

function getPayloadTabIds(payload: Record<string, unknown>) {
  if (Array.isArray(payload.tabIds)) {
    return payload.tabIds.filter(
      (value): value is number => typeof value === 'number'
    );
  }

  if (typeof payload.tabId === 'number') {
    return [payload.tabId];
  }

  return [];
}

export function createBackgroundBridge(
  api: BackgroundBridgeBrowserApi,
  options: BridgeOptions = {}
) {
  const now = options.now ?? (() => new Date().toISOString());
  const randomId = options.randomId ?? (() => crypto.randomUUID());
  const proposals = new Map<string, ActionProposal>();

  async function readActivePage() {
    const activeTab = await api.getActiveTab();

    if (!activeTab?.id) {
      throw new Error('No active tab is available.');
    }

    return api.readPageContext(activeTab.id);
  }

  async function readCurrentSelection() {
    const activeTab = await api.getActiveTab();

    if (!activeTab?.id) {
      return null;
    }

    return api.readSelection(activeTab.id);
  }

  async function listTabs() {
    const tabs = await api.listTabs();
    return tabs.map(mapTab);
  }

  async function listTabGroups() {
    return api.listTabGroups();
  }

  function createProposal(input: ProposalInput) {
    const proposal: ActionProposal = {
      ...input,
      id: randomId(),
      requiresConfirmation: true,
      createdAt: now()
    };

    proposals.set(proposal.id, proposal);
    return proposal;
  }

  function registerProposal(proposal: ActionProposal) {
    proposals.set(proposal.id, proposal);
    return proposal;
  }

  async function confirmProposal(
    confirmation: ActionConfirmation
  ): Promise<ActionExecutionResult> {
    const proposal = proposals.get(confirmation.proposalId);

    if (!proposal) {
      throw new Error(`Proposal ${confirmation.proposalId} was not found.`);
    }

    const executedAt = confirmation.confirmedAt || now();
    const tabIds = getPayloadTabIds(proposal.payload);
    const currentTabs = await api.listTabs();
    const affectedTabs = currentTabs
      .filter((tab) => typeof tab.id === 'number' && tabIds.includes(tab.id))
      .map((tab) => ({
        tabId: tab.id!,
        title: tab.title ?? 'Untitled tab',
        url: tab.url
      }));

    if (confirmation.decision === 'reject') {
      proposals.delete(proposal.id);
      return {
        proposalId: proposal.id,
        status: 'rejected',
        summary: `Rejected ${proposal.kind}.`,
        affectedTabs,
        executedAt
      };
    }

    switch (proposal.kind) {
      case 'groupTabs':
        await api.groupTabs({
          tabIds,
          title:
            typeof proposal.payload.title === 'string'
              ? proposal.payload.title
              : undefined,
          color:
            typeof proposal.payload.color === 'string'
              ? (proposal.payload.color as BrowserTabGroupSummary['color'])
              : undefined
        });
        break;
      case 'moveTabs':
        await api.moveTabs({
          tabIds,
          index:
            typeof proposal.payload.index === 'number'
              ? proposal.payload.index
              : 0,
          windowId:
            typeof proposal.payload.windowId === 'number'
              ? proposal.payload.windowId
              : undefined
        });
        break;
      case 'closeTabs':
        await api.closeTabs(tabIds);
        break;
      case 'focusTab':
        if (tabIds[0] !== undefined) {
          const focused = await api.focusTab(tabIds[0]);
          proposals.delete(proposal.id);
          return {
            proposalId: proposal.id,
            status: 'executed',
            summary: `Executed ${proposal.kind}.`,
            affectedTabs: [
              {
                tabId: focused.id ?? tabIds[0],
                title: focused.title ?? 'Untitled tab',
                url: focused.url
              }
            ],
            executedAt
          };
        }
        break;
    }

    proposals.delete(proposal.id);
    return {
      proposalId: proposal.id,
      status: 'executed',
      summary: `Executed ${proposal.kind}.`,
      affectedTabs,
      executedAt
    };
  }

  async function handleRequest(
    message: RivBackgroundRequest
  ): Promise<RivBackgroundResponse> {
    switch (message.type) {
      case 'riv/read-active-page':
        return readActivePage();
      case 'riv/read-selection':
        return readCurrentSelection();
      case 'riv/list-tabs':
        return listTabs();
      case 'riv/list-tab-groups':
        return listTabGroups();
      case 'riv/register-proposal':
        return registerProposal(message.proposal);
      case 'riv/confirm-proposal':
        return confirmProposal(message.confirmation);
    }
  }

  return {
    createProposal,
    registerProposal,
    confirmProposal,
    handleRequest,
    listTabGroups,
    listTabs,
    readActivePage,
    readCurrentSelection
  };
}
