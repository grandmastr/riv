export type SidePanelToggleResult = 'opened' | 'closed';

export type SidePanelControllerApi = {
  getActiveWindowId(): Promise<number>;
  open(options: { windowId: number }): Promise<void>;
  close?: (options: { windowId: number }) => Promise<void>;
  loadOpenWindowIds(): Promise<number[]>;
  saveOpenWindowIds(windowIds: number[]): Promise<void>;
  addOnOpenedListener?(listener: (info: { windowId: number }) => void): void;
  addOnClosedListener?(listener: (info: { windowId: number }) => void): void;
  addOnWindowRemovedListener?(listener: (windowId: number) => void): void;
};

function sortWindowIds(windowIds: Iterable<number>) {
  return [...new Set(windowIds)].sort((left, right) => left - right);
}

export function createSidePanelController(api: SidePanelControllerApi) {
  async function updateWindowIds(
    updater: (windowIds: Set<number>) => SidePanelToggleResult | void
  ) {
    const windowIds = new Set(await api.loadOpenWindowIds());
    const result = updater(windowIds);
    await api.saveOpenWindowIds(sortWindowIds(windowIds));
    return result;
  }

  async function markOpened(windowId: number) {
    await updateWindowIds((windowIds) => {
      windowIds.add(windowId);
    });
  }

  async function markClosed(windowId: number) {
    await updateWindowIds((windowIds) => {
      windowIds.delete(windowId);
    });
  }

  return {
    observe() {
      api.addOnOpenedListener?.((info) => {
        void markOpened(info.windowId);
      });

      api.addOnClosedListener?.((info) => {
        void markClosed(info.windowId);
      });

      api.addOnWindowRemovedListener?.((windowId) => {
        void markClosed(windowId);
      });
    },

    async toggleCurrentWindow(): Promise<SidePanelToggleResult> {
      const windowId = await api.getActiveWindowId();
      const openWindowIds = new Set(await api.loadOpenWindowIds());

      if (openWindowIds.has(windowId) && api.close) {
        await api.close({
          windowId
        });
        openWindowIds.delete(windowId);
        await api.saveOpenWindowIds(sortWindowIds(openWindowIds));
        return 'closed';
      }

      await api.open({
        windowId
      });
      openWindowIds.add(windowId);
      await api.saveOpenWindowIds(sortWindowIds(openWindowIds));
      return 'opened';
    }
  };
}
