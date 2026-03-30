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

  if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return;
  }

  if (event.key.toLowerCase() !== 'j') {
    return;
  }

  event.preventDefault();
  toggle();
}
