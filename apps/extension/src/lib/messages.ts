import type {
  ActionConfirmation,
  ActionExecutionResult,
  ActionProposal,
  BrowserTabGroupSummary,
  BrowserTabSummary,
  PageContextSnapshot,
  SelectedTextContext
} from '@riv/contracts';

import type { PreparedSelectionSyncPayload } from '../background/prepared-selection-store';

export type RivBackgroundRequest =
  | { type: 'riv/read-active-page'; windowId?: number }
  | { type: 'riv/read-selection'; windowId?: number }
  | { type: 'riv/list-tabs'; windowId?: number }
  | { type: 'riv/list-tab-groups'; windowId?: number }
  | { type: 'riv/toggle-sidepanel'; windowId?: number }
  | { type: 'riv/register-proposal'; proposal: ActionProposal }
  | {
      type: 'riv/confirm-proposal';
      confirmation: ActionConfirmation;
      proposal?: ActionProposal;
    };

export type RivSelectionSyncMessage = {
  type: 'riv/selection-sync';
  selection: PreparedSelectionSyncPayload;
};

export type RivPreparedSelectionMessage = {
  type: 'riv/prepared-selection-updated';
  selection: SelectedTextContext | null;
};

export type RivBackgroundResponse =
  | PageContextSnapshot
  | SelectedTextContext
  | null
  | BrowserTabSummary[]
  | BrowserTabGroupSummary[]
  | ActionProposal
  | ActionExecutionResult;

export async function sendBackgroundMessage<T extends RivBackgroundResponse>(
  message: RivBackgroundRequest
) {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

export async function syncPreparedSelection(
  selection: PreparedSelectionSyncPayload
) {
  return chrome.runtime.sendMessage({
    type: 'riv/selection-sync',
    selection
  } satisfies RivSelectionSyncMessage);
}

export async function requestSidePanelToggle() {
  return chrome.runtime.sendMessage({
    type: 'riv/toggle-sidepanel'
  } satisfies RivBackgroundRequest);
}

export function subscribeToPreparedSelection(
  listener: (selection: SelectedTextContext | null) => void
) {
  const handleMessage: Parameters<
    typeof chrome.runtime.onMessage.addListener
  >[0] = (message) => {
    if (
      typeof message === 'object' &&
      message != null &&
      'type' in message &&
      message.type === 'riv/prepared-selection-updated' &&
      'selection' in message
    ) {
      listener((message as RivPreparedSelectionMessage).selection);
    }

    return undefined;
  };

  chrome.runtime.onMessage.addListener(handleMessage);

  return () => {
    chrome.runtime.onMessage.removeListener(handleMessage);
  };
}
