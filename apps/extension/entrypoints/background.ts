import { defineBackground } from 'wxt/utils/define-background';

import { createBackgroundBridge } from '../src/background/bridge';
import { createPreparedSelectionStore } from '../src/background/prepared-selection-store';
import { createSidePanelController } from '../src/background/sidepanel-controller';
import type {
  RivBackgroundRequest,
  RivSelectionSyncMessage
} from '../src/lib/messages';

type BrowserGroupColor =
  | 'grey'
  | 'blue'
  | 'red'
  | 'yellow'
  | 'green'
  | 'pink'
  | 'purple'
  | 'cyan'
  | 'orange';

const TOGGLE_RIV_SIDEPANEL_COMMAND = 'toggle-riv-sidepanel';
const OPEN_WINDOW_IDS_STORAGE_KEY = 'riv-open-side-panel-window-ids';

type ChromeSidePanelWithToggle = typeof chrome.sidePanel & {
  close?: (options: { windowId: number }) => Promise<void>;
  onOpened?: {
    addListener(listener: (info: { windowId: number }) => void): void;
  };
  onClosed?: {
    addListener(listener: (info: { windowId: number }) => void): void;
  };
};

const sidePanel = chrome.sidePanel as ChromeSidePanelWithToggle;

function mapGroupColor(color?: string): BrowserGroupColor {
  switch (color) {
    case 'grey':
    case 'blue':
    case 'red':
    case 'yellow':
    case 'green':
    case 'pink':
    case 'purple':
    case 'cyan':
    case 'orange':
      return color;
    default:
      return 'grey';
  }
}

function queryTabs(queryInfo: { [key: string]: unknown }) {
  return chrome.tabs.query(queryInfo);
}

async function getActiveTab(windowId?: number) {
  const queryInfo =
    typeof windowId === 'number'
      ? {
          active: true,
          windowId
        }
      : {
          active: true,
          lastFocusedWindow: true
        };
  const [tab] = await queryTabs(queryInfo);

  return tab ?? null;
}

function queryTabGroups() {
  return chrome.tabGroups.query({});
}

async function listCurrentWindowTabs(windowId?: number) {
  const resolvedWindowId = await getActiveWindowId(windowId);
  return queryTabs({ windowId: resolvedWindowId });
}

async function listCurrentWindowTabGroups(windowId?: number) {
  const resolvedWindowId = await getActiveWindowId(windowId);
  const groups = await queryTabGroups();

  return groups.filter((group) => group.windowId === resolvedWindowId);
}

async function getActiveWindowId(windowId?: number) {
  if (typeof windowId === 'number') {
    return windowId;
  }

  const tab = await getActiveTab();

  if (typeof tab?.windowId !== 'number') {
    throw new Error('Riva could not determine the active browser window.');
  }

  return tab.windowId;
}

async function loadOpenWindowIds() {
  const stored = await chrome.storage.session.get(OPEN_WINDOW_IDS_STORAGE_KEY);
  const rawValue = stored[OPEN_WINDOW_IDS_STORAGE_KEY];

  if (!Array.isArray(rawValue)) {
    return [];
  }

  return rawValue.filter(
    (windowId): windowId is number =>
      typeof windowId === 'number' && Number.isInteger(windowId)
  );
}

function saveOpenWindowIds(windowIds: number[]) {
  return chrome.storage.session.set({
    [OPEN_WINDOW_IDS_STORAGE_KEY]: windowIds
  });
}

function updateTabGroup(
  groupId: number,
  updateProperties: { title?: string; color?: BrowserGroupColor }
) {
  return chrome.tabGroups.update(groupId, updateProperties);
}

function groupTabs(tabIds: number[]) {
  if (tabIds.length === 0) {
    return Promise.reject(new Error('At least one tab is required.'));
  }

  return chrome.tabs.group({
    tabIds: tabIds.length === 1 ? tabIds[0] : (tabIds as [number, ...number[]])
  });
}

function moveTabs(
  tabIds: number[],
  moveProperties: { index: number; windowId?: number }
) {
  return chrome.tabs.move(
    tabIds.length === 1 ? tabIds[0] : tabIds,
    moveProperties
  );
}

function removeTabs(tabIds: number[]) {
  return chrome.tabs.remove(tabIds.length === 1 ? tabIds[0] : tabIds);
}

function updateTab(tabId: number, updateProperties: { active: boolean }) {
  return chrome.tabs.update(tabId, updateProperties);
}

function sendTabMessage<T>(tabId: number, type: string) {
  return chrome.tabs.sendMessage(tabId, { type, tabId }) as Promise<T>;
}

const preparedSelectionStore = createPreparedSelectionStore({
  broadcast(message) {
    return chrome.runtime.sendMessage(message).catch(() => undefined);
  }
});

const bridge = createBackgroundBridge(
  {
    getActiveTab,
    async listTabs(windowId) {
      return listCurrentWindowTabs(windowId);
    },
    async listTabGroups(windowId) {
      const groups = await listCurrentWindowTabGroups(windowId);

      return groups.map((group) => ({
        groupId: group.id,
        windowId: group.windowId,
        title: group.title ?? '',
        color: mapGroupColor(group.color),
        collapsed: group.collapsed,
        tabIds: []
      }));
    },
    async readPageContext(tabId) {
      return sendTabMessage(tabId!, 'riv/extract-page-context');
    },
    async readSelection(tabId) {
      return sendTabMessage(tabId!, 'riv/extract-selection');
    },
    async groupTabs(input) {
      const groupId = await groupTabs(input.tabIds);
      const updated = await updateTabGroup(groupId, {
        title: input.title,
        color: input.color
      });

      if (!updated) {
        throw new Error('Chrome did not return the updated tab group.');
      }

      return {
        groupId: updated.id,
        windowId: updated.windowId,
        title: updated.title ?? '',
        color: mapGroupColor(updated.color),
        collapsed: updated.collapsed,
        tabIds: input.tabIds
      };
    },
    async moveTabs(input) {
      await moveTabs(input.tabIds, {
        index: input.index,
        windowId: input.windowId
      });
    },
    async closeTabs(tabIds) {
      await removeTabs(tabIds);
    },
    async focusTab(tabId) {
      const focused = await updateTab(tabId, {
        active: true
      });

      if (!focused) {
        throw new Error('Chrome did not return the focused tab.');
      }

      return focused;
    }
  },
  {
    now: () => new Date().toISOString(),
    randomId: () => `proposal_${crypto.randomUUID()}`
  }
);

async function readPreparedSelection(windowId?: number) {
  const activeTab = await getActiveTab(windowId);

  if (typeof activeTab?.id !== 'number') {
    return null;
  }

  if (preparedSelectionStore.hasForTab(activeTab.id)) {
    return preparedSelectionStore.getForTab(activeTab.id);
  }

  return bridge.readCurrentSelection(windowId);
}

const sidePanelController = createSidePanelController({
  getActiveWindowId,
  open(options) {
    return sidePanel.open(options);
  },
  close: sidePanel.close
    ? (options) => sidePanel.close?.(options) ?? Promise.resolve()
    : undefined,
  loadOpenWindowIds,
  saveOpenWindowIds,
  addOnOpenedListener: sidePanel.onOpened
    ? (listener) => {
        sidePanel.onOpened?.addListener(listener);
      }
    : undefined,
  addOnClosedListener: sidePanel.onClosed
    ? (listener) => {
        sidePanel.onClosed?.addListener(listener);
      }
    : undefined,
  addOnWindowRemovedListener(listener) {
    chrome.windows.onRemoved.addListener(listener);
  }
});

async function handleMessage(message: RivBackgroundRequest) {
  switch (message.type) {
    case 'riv/read-active-page':
      return bridge.readActivePage(message.windowId);
    case 'riv/read-selection':
      return readPreparedSelection(message.windowId);
    case 'riv/list-tabs':
      return bridge.listTabs(message.windowId);
    case 'riv/list-tab-groups':
      return bridge.listTabGroups(message.windowId);
    case 'riv/toggle-sidepanel':
      return sidePanelController.toggleCurrentWindow();
    case 'riv/register-proposal':
      return bridge.registerProposal(message.proposal);
    case 'riv/confirm-proposal':
      return bridge.confirmProposal(message.confirmation, message.proposal);
  }
}

export default defineBackground(() => {
  sidePanelController.observe();

  chrome.sidePanel?.setPanelBehavior({
    openPanelOnActionClick: true
  });

  chrome.commands.onCommand.addListener((command) => {
    if (command !== TOGGLE_RIV_SIDEPANEL_COMMAND) {
      return;
    }

    void sidePanelController.toggleCurrentWindow().catch((error: unknown) => {
      console.error(error);
    });
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'riv/selection-sync') {
      const selectionMessage = message as RivSelectionSyncMessage;
      const senderTab = _sender.tab;

      preparedSelectionStore.syncFromTab(
        senderTab ?? {},
        selectionMessage.selection
      );
      sendResponse(undefined);
      return false;
    }

    void handleMessage(message as RivBackgroundRequest)
      .then((response) => sendResponse(response))
      .catch((error: unknown) => {
        console.error(error);
        sendResponse(undefined);
      });

    return true;
  });
});
