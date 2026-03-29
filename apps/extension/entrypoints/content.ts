import { defineContentScript } from 'wxt/utils/define-content-script';

import {
  extractPageContextSnapshot,
  extractSelectedTextContext
} from '../src/content/extract-page-context';
import { syncPreparedSelection } from '../src/lib/messages';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main() {
    let lastPreparedSelection: string | null | undefined;

    const syncSelection = () => {
      const selection = extractSelectedTextContext({
        tabId: 0,
        url: window.location.href,
        title: document.title,
        selectedText: window.getSelection()?.toString() ?? '',
        capturedAt: new Date().toISOString()
      });
      const selectionKey = selection
        ? JSON.stringify({
            url: selection.url,
            title: selection.title,
            text: selection.text
          })
        : null;

      if (selectionKey === lastPreparedSelection) {
        return;
      }

      lastPreparedSelection = selectionKey;

      void syncPreparedSelection(
        selection
          ? {
              url: selection.url,
              title: selection.title,
              text: selection.text,
              capturedAt: selection.capturedAt
            }
          : null
      );
    };

    document.addEventListener('selectionchange', syncSelection);
    window.addEventListener('mouseup', syncSelection);
    window.addEventListener('keyup', syncSelection);

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'riv/extract-page-context') {
        sendResponse(
          extractPageContextSnapshot({
            tabId: message.tabId ?? 0,
            url: window.location.href,
            title: document.title,
            document,
            capturedAt: new Date().toISOString()
          })
        );
        return false;
      }

      if (message.type === 'riv/extract-selection') {
        sendResponse(
          extractSelectedTextContext({
            tabId: message.tabId ?? 0,
            url: window.location.href,
            title: document.title,
            selectedText: window.getSelection()?.toString() ?? '',
            capturedAt: new Date().toISOString()
          })
        );
        return false;
      }

      return false;
    });

    syncSelection();
  }
});
