import { describe, expect, it, vi } from 'vitest';

import type { SelectedTextContext } from '@riv/contracts';

import { createPreparedSelectionStore } from './prepared-selection-store';

const NOW = '2026-03-29T15:00:00.000Z';

function createSelection(text: string): Omit<SelectedTextContext, 'tabId'> {
  return {
    url: 'https://docs.riv.dev/selection',
    title: 'Selection docs',
    text,
    capturedAt: NOW
  };
}

describe('createPreparedSelectionStore', () => {
  it('stores active-tab selections and broadcasts them to the sidepanel', async () => {
    const broadcast = vi.fn().mockResolvedValue(undefined);
    const store = createPreparedSelectionStore({
      broadcast
    });

    const selection = store.syncFromTab(
      {
        id: 12,
        active: true
      },
      createSelection('Keep this paragraph in context.')
    );

    expect(selection).toEqual({
      tabId: 12,
      ...createSelection('Keep this paragraph in context.')
    });
    expect(store.getForTab(12)).toEqual(selection);
    expect(broadcast).toHaveBeenCalledWith({
      type: 'riv/prepared-selection-updated',
      selection
    });
  });

  it('removes cached selections when the page clears the highlight', () => {
    const store = createPreparedSelectionStore();

    store.syncFromTab(
      {
        id: 12,
        active: true
      },
      createSelection('Temporary selection')
    );

    const cleared = store.syncFromTab(
      {
        id: 12,
        active: true
      },
      null
    );

    expect(cleared).toBeNull();
    expect(store.getForTab(12)).toBeNull();
  });

  it('does not rebroadcast identical selection payloads', async () => {
    const broadcast = vi.fn().mockResolvedValue(undefined);
    const store = createPreparedSelectionStore({
      broadcast
    });

    store.syncFromTab(
      {
        id: 12,
        active: true
      },
      createSelection('Duplicate selection')
    );
    store.syncFromTab(
      {
        id: 12,
        active: true
      },
      createSelection('Duplicate selection')
    );

    expect(broadcast).toHaveBeenCalledTimes(1);
  });
});
