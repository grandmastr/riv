import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSidePanelController } from './sidepanel-controller';

function createController() {
  let activeWindowId = 7;
  let storedWindowIds: number[] = [];
  let onOpenedListener: ((info: { windowId: number }) => void) | undefined;
  let onClosedListener: ((info: { windowId: number }) => void) | undefined;
  let onWindowRemovedListener: ((windowId: number) => void) | undefined;

  const api = {
    getActiveWindowId: vi.fn(async () => activeWindowId),
    open: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    loadOpenWindowIds: vi.fn(async () => storedWindowIds),
    saveOpenWindowIds: vi.fn(async (windowIds: number[]) => {
      storedWindowIds = [...windowIds];
    }),
    addOnOpenedListener: vi.fn(
      (listener: (info: { windowId: number }) => void) => {
        onOpenedListener = listener;
      }
    ),
    addOnClosedListener: vi.fn(
      (listener: (info: { windowId: number }) => void) => {
        onClosedListener = listener;
      }
    ),
    addOnWindowRemovedListener: vi.fn(
      (listener: (windowId: number) => void) => {
        onWindowRemovedListener = listener;
      }
    )
  };

  return {
    api,
    controller: createSidePanelController(api),
    setActiveWindowId(windowId: number) {
      activeWindowId = windowId;
    },
    setStoredWindowIds(windowIds: number[]) {
      storedWindowIds = [...windowIds];
    },
    emitOpened(windowId: number) {
      onOpenedListener?.({ windowId });
    },
    emitClosed(windowId: number) {
      onClosedListener?.({ windowId });
    },
    emitWindowRemoved(windowId: number) {
      onWindowRemovedListener?.(windowId);
    },
    getStoredWindowIds() {
      return storedWindowIds;
    }
  };
}

describe('createSidePanelController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the side panel for the active window when it is currently closed', async () => {
    const harness = createController();

    await expect(harness.controller.toggleCurrentWindow()).resolves.toBe(
      'opened'
    );

    expect(harness.api.open).toHaveBeenCalledWith({
      windowId: 7
    });
    expect(harness.api.close).not.toHaveBeenCalled();
    expect(harness.getStoredWindowIds()).toEqual([7]);
  });

  it('closes the side panel for the active window when it is already open', async () => {
    const harness = createController();
    harness.setStoredWindowIds([7]);

    await expect(harness.controller.toggleCurrentWindow()).resolves.toBe(
      'closed'
    );

    expect(harness.api.close).toHaveBeenCalledWith({
      windowId: 7
    });
    expect(harness.api.open).not.toHaveBeenCalled();
    expect(harness.getStoredWindowIds()).toEqual([]);
  });

  it('tracks side panel events and removed windows so toggle state stays in sync', async () => {
    const harness = createController();
    harness.controller.observe();

    harness.emitOpened(11);
    harness.emitOpened(12);
    harness.emitClosed(11);
    harness.emitWindowRemoved(12);

    expect(harness.getStoredWindowIds()).toEqual([]);
  });

  it('falls back to opening when the browser does not support programmatic close', async () => {
    const harness = createController();
    harness.setStoredWindowIds([7]);
    const controller = createSidePanelController({
      ...harness.api,
      close: undefined
    });

    await expect(controller.toggleCurrentWindow()).resolves.toBe('opened');
    expect(harness.api.open).toHaveBeenCalledWith({
      windowId: 7
    });
  });
});
