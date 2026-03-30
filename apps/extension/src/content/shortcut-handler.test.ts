import { describe, expect, it, vi } from 'vitest';

import { handleSidePanelShortcutKeydown } from './shortcut-handler';

describe('handleSidePanelShortcutKeydown', () => {
  it('toggles the side panel on meta+j when focus is in page content', () => {
    const toggle = vi.fn();
    const preventDefault = vi.fn();
    const event = new KeyboardEvent('keydown', {
      key: 'j',
      metaKey: true,
      bubbles: true,
      cancelable: true
    });

    Object.defineProperty(event, 'preventDefault', {
      value: preventDefault
    });

    handleSidePanelShortcutKeydown(event, toggle);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('ignores meta+j while typing in an input-like target', () => {
    const toggle = vi.fn();
    const preventDefault = vi.fn();
    const input = document.createElement('input');
    const event = new KeyboardEvent('keydown', {
      key: 'j',
      metaKey: true,
      bubbles: true,
      cancelable: true
    });

    Object.defineProperty(event, 'target', {
      value: input
    });
    Object.defineProperty(event, 'preventDefault', {
      value: preventDefault
    });

    handleSidePanelShortcutKeydown(event, toggle);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(toggle).not.toHaveBeenCalled();
  });

  it('can toggle inside an input-like target when editable targets are allowed', () => {
    const toggle = vi.fn();
    const preventDefault = vi.fn();
    const input = document.createElement('textarea');
    const event = new KeyboardEvent('keydown', {
      key: 'j',
      metaKey: true,
      bubbles: true,
      cancelable: true
    });

    Object.defineProperty(event, 'target', {
      value: input
    });
    Object.defineProperty(event, 'preventDefault', {
      value: preventDefault
    });

    handleSidePanelShortcutKeydown(event, toggle, {
      ignoreEditableTargets: false
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('toggles the side panel on command+shift+y', () => {
    const toggle = vi.fn();
    const preventDefault = vi.fn();
    const event = new KeyboardEvent('keydown', {
      key: 'y',
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true
    });

    Object.defineProperty(event, 'preventDefault', {
      value: preventDefault
    });

    handleSidePanelShortcutKeydown(event, toggle);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('toggles the side panel on ctrl+shift+y', () => {
    const toggle = vi.fn();
    const preventDefault = vi.fn();
    const event = new KeyboardEvent('keydown', {
      key: 'y',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true
    });

    Object.defineProperty(event, 'preventDefault', {
      value: preventDefault
    });

    handleSidePanelShortcutKeydown(event, toggle);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledTimes(1);
  });
});
