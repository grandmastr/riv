import { defineContentScript } from 'wxt/utils/define-content-script';

import {
  extractPageContextSnapshot,
  extractSelectedTextContext
} from '../src/content/extract-page-context';
import { extractYouTubeMediaContextWithTranscript } from '../src/content/extract-youtube-context';
import { handleSidePanelShortcutKeydown } from '../src/content/shortcut-handler';
import {
  requestSidePanelToggle,
  syncPreparedSelection
} from '../src/lib/messages';

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
    document.addEventListener(
      'keydown',
      (event) => {
        handleSidePanelShortcutKeydown(event, () => {
          void requestSidePanelToggle().catch((error: unknown) => {
            console.error(error);
          });
        });
      },
      {
        capture: true
      }
    );

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'riv/extract-page-context') {
        const input = {
          tabId: message.tabId ?? 0,
          url: window.location.href,
          title: document.title,
          document,
          capturedAt: new Date().toISOString()
        };
        const snapshot = extractPageContextSnapshot(input);

        if (
          snapshot.media?.kind !== 'youtube-video' ||
          snapshot.media.transcriptStatus === 'available'
        ) {
          sendResponse(snapshot);
          return false;
        }

        void extractYouTubeMediaContextWithTranscript(document, window.location.href)
          .then((media) => {
            sendResponse({
              ...snapshot,
              media: media ?? undefined
            });
          })
          .catch((error: unknown) => {
            console.error(error);
            sendResponse(snapshot);
          });

        return true;
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
