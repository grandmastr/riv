function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    Boolean(target.closest('[contenteditable="true"]'))
  );
}

type SidePanelShortcutOptions = {
  ignoreEditableTargets?: boolean;
};

export function handleSidePanelShortcutKeydown(
  event: KeyboardEvent,
  toggle: () => void,
  options: SidePanelShortcutOptions = {}
) {
  const { ignoreEditableTargets = true } = options;

  if (event.defaultPrevented) {
    return;
  }

  if (ignoreEditableTargets && isEditableTarget(event.target)) {
    return;
  }

  const key = event.key.toLowerCase();
  const isLegacyMacShortcut =
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    key === 'j';
  const isPrimaryShortcut =
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    event.shiftKey &&
    key === 'y';

  if (!isLegacyMacShortcut && !isPrimaryShortcut) {
    return;
  }

  event.preventDefault();
  toggle();
}
