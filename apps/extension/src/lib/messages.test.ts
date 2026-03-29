import { describe, expect, it, vi } from 'vitest';

import type { SelectedTextContext } from '@riv/contracts';

import { subscribeToPreparedSelection } from './messages';

const NOW = '2026-03-29T15:00:00.000Z';

describe('subscribeToPreparedSelection', () => {
  it('forwards prepared selection runtime updates and ignores unrelated messages', () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();

    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: {
          addListener,
          removeListener
        }
      }
    });

    const listener = vi.fn();
    const unsubscribe = subscribeToPreparedSelection(listener);
    const handler = addListener.mock.calls[0]?.[0];

    expect(typeof handler).toBe('function');

    const selection: SelectedTextContext = {
      tabId: 7,
      url: 'https://docs.riv.dev',
      title: 'Riv docs',
      text: 'Prepared selection',
      capturedAt: NOW
    };

    handler?.({
      type: 'riv/prepared-selection-updated',
      selection
    });
    handler?.({
      type: 'riv/read-selection'
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(selection);

    unsubscribe();

    expect(removeListener).toHaveBeenCalledWith(handler);
  });
});
