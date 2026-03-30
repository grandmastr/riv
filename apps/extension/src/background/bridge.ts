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
  getActiveTab(windowId?: number): Promise<BrowserTabLike | null>;
  listTabs(windowId?: number): Promise<BrowserTabLike[]>;
  listTabGroups(windowId?: number): Promise<BrowserTabGroupSummary[]>;
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
    favIconUrl: toValidUrl(tab.favIconUrl)
  };
}

function toValidUrl(value: string | undefined) {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }

  try {
    return new URL(value).toString();
  } catch {
    return undefined;
  }
}

function getPayloadTabIds(payload: Record<string, unknown>) {
  const collected: number[] = [];

  if (Array.isArray(payload.tabIds)) {
    collected.push(
      ...payload.tabIds.filter(
        (value): value is number => typeof value === 'number'
      )
    );
  }

  if (typeof payload.tabId === 'number') {
    collected.push(payload.tabId);
  }

  if (Array.isArray(payload.groups)) {
    for (const group of payload.groups) {
      if (!group || typeof group !== 'object') {
        continue;
      }

      const tabIds = (group as { tabIds?: unknown }).tabIds;

      if (!Array.isArray(tabIds)) {
        continue;
      }

      collected.push(
        ...tabIds.filter(
          (value): value is number => typeof value === 'number'
        )
      );
    }
  }

  return [...new Set(collected)];
}

function isTabGroupColor(value: unknown): value is BrowserTabGroupSummary['color'] {
  return (
    value === 'grey' ||
    value === 'blue' ||
    value === 'red' ||
    value === 'yellow' ||
    value === 'green' ||
    value === 'pink' ||
    value === 'purple' ||
    value === 'cyan' ||
    value === 'orange'
  );
}

function getPayloadGroups(payload: Record<string, unknown>): GroupTabsInput[] {
  if (!Array.isArray(payload.groups)) {
    return [];
  }

  const seenTabIds = new Set<number>();
  const groups: GroupTabsInput[] = [];

  for (const rawGroup of payload.groups) {
    if (!rawGroup || typeof rawGroup !== 'object') {
      continue;
    }

    const tabIds = (rawGroup as { tabIds?: unknown }).tabIds;

    if (!Array.isArray(tabIds)) {
      continue;
    }

    const normalizedTabIds = [...new Set(
      tabIds.filter((value): value is number => typeof value === 'number')
    )].filter((tabId) => !seenTabIds.has(tabId));

    if (normalizedTabIds.length === 0) {
      continue;
    }

    for (const tabId of normalizedTabIds) {
      seenTabIds.add(tabId);
    }

    const title =
      typeof (rawGroup as { title?: unknown }).title === 'string'
        ? (rawGroup as { title: string }).title
        : undefined;
    const colorCandidate = (rawGroup as { color?: unknown }).color;
    const color = isTabGroupColor(colorCandidate) ? colorCandidate : undefined;

    groups.push({
      tabIds: normalizedTabIds,
      ...(title ? { title } : {}),
      ...(color ? { color } : {})
    });
  }

  return groups;
}

function buildGroupTabsSummary(groupCount: number) {
  if (groupCount <= 1) {
    return 'Grouped related tabs.';
  }

  return `Grouped tabs into ${groupCount} groups.`;
}

function buildRejectedGroupTabsSummary(groupCount: number) {
  if (groupCount <= 1) {
    return 'Rejected tab grouping.';
  }

  return `Rejected grouping into ${groupCount} groups.`;
}

function getSingleGroupInput(payload: Record<string, unknown>, tabIds: number[]) {
  return {
    tabIds,
    title:
      typeof payload.title === 'string'
        ? payload.title
        : undefined,
    color: isTabGroupColor(payload.color)
      ? payload.color
      : undefined
  } satisfies GroupTabsInput;
}

function getGroupCount(proposal: ActionProposal) {
  const payloadGroups = getPayloadGroups(proposal.payload);
  return payloadGroups.length > 0 ? payloadGroups.length : 1;
}

function getRejectedSummary(proposal: ActionProposal) {
  if (proposal.kind !== 'groupTabs') {
    return `Rejected ${proposal.kind}.`;
  }

  return buildRejectedGroupTabsSummary(getGroupCount(proposal));
}

function getExecutedSummary(proposal: ActionProposal) {
  if (proposal.kind !== 'groupTabs') {
    return `Executed ${proposal.kind}.`;
  }

  return buildGroupTabsSummary(getGroupCount(proposal));
}

export function createBackgroundBridge(
  api: BackgroundBridgeBrowserApi,
  options: BridgeOptions = {}
) {
  const now = options.now ?? (() => new Date().toISOString());
  const randomId = options.randomId ?? (() => crypto.randomUUID());
  const proposals = new Map<string, ActionProposal>();

  async function readActivePage(windowId?: number) {
    const activeTab = await api.getActiveTab(windowId);

    if (!activeTab?.id) {
      throw new Error('No active tab is available.');
    }

    return api.readPageContext(activeTab.id);
  }

  async function readCurrentSelection(windowId?: number) {
    const activeTab = await api.getActiveTab(windowId);

    if (!activeTab?.id) {
      return null;
    }

    return api.readSelection(activeTab.id);
  }

  async function listTabs(windowId?: number) {
    const tabs = await api.listTabs(windowId);
    return tabs.map(mapTab);
  }

  async function listTabGroups(windowId?: number) {
    return api.listTabGroups(windowId);
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
    confirmation: ActionConfirmation,
    fallbackProposal?: ActionProposal
  ): Promise<ActionExecutionResult> {
    const proposal =
      proposals.get(confirmation.proposalId) ??
      (fallbackProposal?.id === confirmation.proposalId
        ? fallbackProposal
        : undefined);

    if (!proposal) {
      throw new Error(`Proposal ${confirmation.proposalId} was not found.`);
    }

    proposals.set(proposal.id, proposal);

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
        summary: getRejectedSummary(proposal),
        affectedTabs,
        executedAt
      };
    }

    switch (proposal.kind) {
      case 'groupTabs': {
        const groups = getPayloadGroups(proposal.payload);

        if (groups.length > 0) {
          for (const group of groups) {
            await api.groupTabs(group);
          }
          break;
        }

        await api.groupTabs(getSingleGroupInput(proposal.payload, tabIds));
        break;
      }
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
      summary: getExecutedSummary(proposal),
      affectedTabs,
      executedAt
    };
  }

  async function handleRequest(
    message: RivBackgroundRequest
  ): Promise<RivBackgroundResponse> {
    switch (message.type) {
      case 'riv/read-active-page':
        return readActivePage(message.windowId);
      case 'riv/read-selection':
        return readCurrentSelection(message.windowId);
      case 'riv/list-tabs':
        return listTabs(message.windowId);
      case 'riv/list-tab-groups':
        return listTabGroups(message.windowId);
      case 'riv/register-proposal':
        return registerProposal(message.proposal);
      case 'riv/confirm-proposal':
        return confirmProposal(message.confirmation, message.proposal);
      default:
        throw new Error(`Unsupported background request: ${String(message)}`);
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
