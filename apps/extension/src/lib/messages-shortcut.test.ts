import { describe, expect, it, vi } from 'vitest';

import { requestSidePanelToggle } from './messages';

describe('requestSidePanelToggle', () => {
  it('sends the background toggle request', async () => {
    const sendMessage = vi.fn(async () => undefined);

    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage
      }
    });

    await requestSidePanelToggle();

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'riv/toggle-sidepanel'
    });
  });
});
