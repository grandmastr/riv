import type { SelectedTextContext } from '@riv/contracts';

export type PreparedSelectionSyncPayload = Omit<
  SelectedTextContext,
  'tabId'
> | null;

type TabLike = {
  id?: number;
  active?: boolean;
};

type PreparedSelectionUpdateMessage = {
  type: 'riv/prepared-selection-updated';
  selection: SelectedTextContext | null;
};

type PreparedSelectionStoreOptions = {
  broadcast?(
    message: PreparedSelectionUpdateMessage
  ): Promise<unknown> | unknown;
};

function areSelectionsEqual(
  left: SelectedTextContext | null | undefined,
  right: SelectedTextContext | null
) {
  if (left == null && right == null) {
    return true;
  }

  if (left == null || right == null) {
    return false;
  }

  return (
    left.tabId === right.tabId &&
    left.url === right.url &&
    left.title === right.title &&
    left.text === right.text &&
    left.capturedAt === right.capturedAt
  );
}

export function createPreparedSelectionStore(
  options: PreparedSelectionStoreOptions = {}
) {
  const selections = new Map<number, SelectedTextContext | null>();

  function getForTab(tabId: number) {
    return selections.get(tabId) ?? null;
  }

  function hasForTab(tabId: number) {
    return selections.has(tabId);
  }

  function syncFromTab(tab: TabLike, selection: PreparedSelectionSyncPayload) {
    if (typeof tab.id !== 'number') {
      return null;
    }

    const nextSelection =
      selection == null
        ? null
        : {
            tabId: tab.id,
            ...selection
          };
    const previousSelection = selections.get(tab.id);

    if (nextSelection == null) {
      selections.delete(tab.id);
    } else {
      selections.set(tab.id, nextSelection);
    }

    if (!areSelectionsEqual(previousSelection, nextSelection) && tab.active) {
      void options.broadcast?.({
        type: 'riv/prepared-selection-updated',
        selection: nextSelection
      });
    }

    return nextSelection;
  }

  return {
    getForTab,
    hasForTab,
    syncFromTab
  };
}
