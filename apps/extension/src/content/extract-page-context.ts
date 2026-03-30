import type {
  ContentBlock,
  PageContextSnapshot,
  SelectedTextContext
} from '@riv/contracts';

import { extractYouTubeMediaContext } from './extract-youtube-context';

type ExtractPageContextInput = {
  tabId: number;
  url: string;
  title: string;
  document: Document;
  capturedAt: string;
};

type ExtractSelectedTextInput = {
  tabId: number;
  url: string;
  title: string;
  selectedText: string;
  capturedAt: string;
};

function inferPageType(
  url: string,
  document: Document
): PageContextSnapshot['pageType'] {
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();

  if (
    hostname.includes('google.') ||
    hostname.includes('bing.com') ||
    pathname.includes('/search') ||
    parsed.searchParams.has('q')
  ) {
    return 'search';
  }

  if (hostname.includes('docs.') || pathname.includes('/docs')) {
    return 'documentation';
  }

  if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
    return 'social';
  }

  if (document.querySelector('form')) {
    return 'form';
  }

  if (pathname.includes('/dashboard')) {
    return 'dashboard';
  }

  if (document.querySelector('article')) {
    return 'article';
  }

  return 'generic';
}

function extractMetadata(document: Document) {
  const metadata: Record<string, string> = {};
  const tags = document.querySelectorAll<HTMLMetaElement>(
    'meta[name], meta[property]'
  );

  for (const tag of tags) {
    const key = tag.getAttribute('name') ?? tag.getAttribute('property');
    const content = tag.getAttribute('content')?.trim();

    if (key && content) {
      metadata[key.replace(/^og:/, '')] = content;
    }
  }

  return metadata;
}

function collectContentBlocks(document: Document) {
  const root = document.querySelector('main, article, body') ?? document.body;
  const elements = root.querySelectorAll<
    | HTMLHeadingElement
    | HTMLParagraphElement
    | HTMLQuoteElement
    | HTMLUListElement
    | HTMLOListElement
    | HTMLPreElement
  >('h1, h2, h3, h4, h5, h6, p, blockquote, ul, ol, pre');
  const counters: Record<ContentBlock['kind'], number> = {
    heading: 0,
    paragraph: 0,
    list: 0,
    code: 0,
    quote: 0,
    metadata: 0
  };

  const blocks: ContentBlock[] = [];

  for (const element of elements) {
    const tagName = element.tagName.toLowerCase();
    let block: ContentBlock | null = null;

    if (/^h[1-6]$/.test(tagName)) {
      counters.heading += 1;
      block = {
        id: `heading-${counters.heading}`,
        kind: 'heading',
        text: element.textContent?.trim() ?? '',
        level: Number(tagName.slice(1))
      };
    } else if (tagName === 'p') {
      counters.paragraph += 1;
      block = {
        id: `paragraph-${counters.paragraph}`,
        kind: 'paragraph',
        text: element.textContent?.trim() ?? ''
      };
    } else if (tagName === 'blockquote') {
      counters.quote += 1;
      block = {
        id: `quote-${counters.quote}`,
        kind: 'quote',
        text: element.textContent?.trim() ?? ''
      };
    } else if (tagName === 'ul' || tagName === 'ol') {
      counters.list += 1;
      block = {
        id: `list-${counters.list}`,
        kind: 'list',
        text: Array.from(element.querySelectorAll('li'))
          .map((item) => item.textContent?.trim() ?? '')
          .filter(Boolean)
          .join('\n')
      };
    } else if (tagName === 'pre') {
      counters.code += 1;
      block = {
        id: `code-${counters.code}`,
        kind: 'code',
        text: element.textContent?.trim() ?? ''
      };
    }

    if (block && block.text) {
      blocks.push(block);
    }
  }

  return blocks;
}

export function extractPageContextSnapshot(
  input: ExtractPageContextInput
): PageContextSnapshot {
  const media = extractYouTubeMediaContext(input.document, input.url);

  return {
    tabId: input.tabId,
    url: input.url,
    title: input.title,
    pageType: inferPageType(input.url, input.document),
    capturedAt: input.capturedAt,
    metadata: extractMetadata(input.document),
    contentBlocks: collectContentBlocks(input.document),
    media: media ?? undefined
  };
}

export function extractSelectedTextContext(
  input: ExtractSelectedTextInput
): SelectedTextContext | null {
  const text = input.selectedText.trim();

  if (!text) {
    return null;
  }

  return {
    tabId: input.tabId,
    url: input.url,
    title: input.title,
    text,
    capturedAt: input.capturedAt
  };
}
