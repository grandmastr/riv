import { describe, expect, it } from 'vitest';

import {
  PageContextSnapshotSchema,
  SelectedTextContextSchema
} from '@riv/contracts';

import {
  extractPageContextSnapshot,
  extractSelectedTextContext
} from './extract-page-context';

describe('extractPageContextSnapshot', () => {
  it('extracts structured page content with metadata and typed blocks', () => {
    document.head.innerHTML = `
      <meta name="description" content="Extension architecture guide" />
      <meta name="author" content="Riv Team" />
    `;

    document.body.innerHTML = `
      <main>
        <article>
          <h1>Shipping the Riv extension</h1>
          <p>The side panel should keep page provenance visible.</p>
          <blockquote>Confirm every write action before execution.</blockquote>
          <ul>
            <li>Capture page context</li>
            <li>List tabs and groups</li>
          </ul>
          <pre><code>browser.tabs.query({ active: true })</code></pre>
        </article>
      </main>
    `;

    const snapshot = extractPageContextSnapshot({
      tabId: 7,
      url: 'https://docs.riv.dev/extension/architecture',
      title: 'Shipping the Riv extension',
      document,
      capturedAt: '2026-03-29T15:00:00.000Z'
    });

    expect(PageContextSnapshotSchema.parse(snapshot)).toMatchObject({
      tabId: 7,
      pageType: 'documentation',
      metadata: {
        description: 'Extension architecture guide',
        author: 'Riv Team'
      }
    });

    expect(snapshot.contentBlocks).toEqual([
      {
        id: 'heading-1',
        kind: 'heading',
        text: 'Shipping the Riv extension',
        level: 1
      },
      {
        id: 'paragraph-1',
        kind: 'paragraph',
        text: 'The side panel should keep page provenance visible.'
      },
      {
        id: 'quote-1',
        kind: 'quote',
        text: 'Confirm every write action before execution.'
      },
      {
        id: 'list-1',
        kind: 'list',
        text: 'Capture page context\nList tabs and groups'
      },
      {
        id: 'code-1',
        kind: 'code',
        text: 'browser.tabs.query({ active: true })'
      }
    ]);
  });
});

describe('extractSelectedTextContext', () => {
  it('normalizes selected text into the shared contract', () => {
    const selection = extractSelectedTextContext({
      tabId: 7,
      url: 'https://example.com/focus',
      title: 'Focus',
      selectedText: '   Ship confirmation cards before tab writes.   ',
      capturedAt: '2026-03-29T15:01:00.000Z'
    });

    expect(SelectedTextContextSchema.parse(selection)).toEqual({
      tabId: 7,
      url: 'https://example.com/focus',
      title: 'Focus',
      text: 'Ship confirmation cards before tab writes.',
      capturedAt: '2026-03-29T15:01:00.000Z'
    });
  });

  it('returns null when the selected text is empty after trimming', () => {
    const selection = extractSelectedTextContext({
      tabId: 7,
      url: 'https://example.com/focus',
      title: 'Focus',
      selectedText: '   ',
      capturedAt: '2026-03-29T15:01:00.000Z'
    });

    expect(selection).toBeNull();
  });
});
