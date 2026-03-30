import type {
  YouTubeChapter,
  YouTubeMediaContext,
  YouTubeTranscriptCue
} from '@riv/contracts';

const MAX_TRANSCRIPT_CUES = 150;
const MAX_TRANSCRIPT_CHARACTERS = 12000;

function parseUrl(url: string) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isYouTubeHostname(hostname: string) {
  const normalized = hostname.toLowerCase();

  return normalized === 'youtube.com' || normalized.endsWith('.youtube.com');
}

function normalizeText(value: string | null | undefined) {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function getMetaContent(document: Document, name: string) {
  return normalizeText(
    document.querySelector(`meta[name="${name}"]`)?.getAttribute('content')
  );
}

function getPropertyContent(document: Document, property: string) {
  return normalizeText(
    document
      .querySelector(`meta[property="${property}"]`)
      ?.getAttribute('content')
  );
}

function getElementText(root: ParentNode, selectors: string[]) {
  for (const selector of selectors) {
    const text = normalizeText(root.querySelector(selector)?.textContent);

    if (text) {
      return text;
    }
  }

  return '';
}

function parseTimestampLabel(value: string) {
  const normalized = normalizeText(value);

  if (!/^\d{1,2}:\d{2}(?::\d{2})?$/.test(normalized)) {
    return null;
  }

  const parts = normalized.split(':').map((part) => Number(part));

  if (parts.some((part) => Number.isNaN(part))) {
    return null;
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function formatTimestampLabel(totalSeconds: number) {
  const wholeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainingSeconds = wholeSeconds % 60;

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function parseHrefTimestamp(value: string | null) {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  const match = normalized.match(
    /^(?:(?<hours>\d+)h)?(?:(?<minutes>\d+)m)?(?:(?<seconds>\d+)s)?$/i
  );

  if (!match?.groups) {
    return null;
  }

  const hours = Number(match.groups.hours ?? '0');
  const minutes = Number(match.groups.minutes ?? '0');
  const seconds = Number(match.groups.seconds ?? '0');

  if ([hours, minutes, seconds].some((part) => Number.isNaN(part))) {
    return null;
  }

  const totalSeconds = hours * 3600 + minutes * 60 + seconds;

  return totalSeconds > 0 || /0s?$/.test(normalized) ? totalSeconds : null;
}

function extractTimestampFromHref(href: string) {
  const parsed = parseUrl(href);

  if (!parsed) {
    return {
      timestampLabel: undefined,
      startSeconds: undefined
    };
  }

  const secondsText = parsed.searchParams.get('t') ?? parsed.searchParams.get('start');
  const seconds = parseHrefTimestamp(secondsText);

  if (seconds === null) {
    return {
      timestampLabel: undefined,
      startSeconds: undefined
    };
  }

  const wholeSeconds = Math.max(0, Math.floor(seconds));

  return {
    timestampLabel: formatTimestampLabel(wholeSeconds),
    startSeconds: wholeSeconds
  };
}

function extractTitle(document: Document) {
  return (
    getPropertyContent(document, 'og:title') ||
    getMetaContent(document, 'title') ||
    getElementText(document, ['h1', 'title'])
  );
}

function extractChannelName(document: Document) {
  return getElementText(document, [
    '#owner #channel-name a',
    '#owner a[href^="/@"]',
    'ytd-watch-metadata ytd-channel-name a',
    'ytd-channel-name a',
    '[itemprop="author"]'
  ]);
}

function extractDescription(document: Document) {
  return (
    getMetaContent(document, 'description') ||
    getPropertyContent(document, 'og:description') ||
    getElementText(document, ['#description-inline-expander', '#description'])
  );
}

function extractChapters(document: Document, videoId: string) {
  const chapters: YouTubeChapter[] = [];
  const seen = new Set<string>();

  const links = document.querySelectorAll<HTMLAnchorElement>('a[href*="t="], a[href*="start="]');

  for (const link of links) {
    const href = link.getAttribute('href');

    if (!href) {
      continue;
    }

    const parsedHref = parseUrl(new URL(href, 'https://www.youtube.com').toString());

    if (!parsedHref) {
      continue;
    }

    const hrefVideoId = parsedHref.searchParams.get('v');

    if (hrefVideoId && hrefVideoId !== videoId) {
      continue;
    }

    const linkedTimestamp = extractTimestampFromHref(parsedHref.toString());
    const visibleTimestamp =
      getElementText(link, ['.chapter-time', '[class*="chapter-time"]']) ||
      linkedTimestamp.timestampLabel ||
      '';
    const title = getElementText(link, [
      '.chapter-title',
      '[class*="chapter-title"]',
      'h4',
      '#title'
    ]);

    if (!title) {
      continue;
    }

    const chapter: YouTubeChapter = {
      title
    };

    const parsedVisibleTimestamp = parseTimestampLabel(visibleTimestamp);

    if (visibleTimestamp) {
      chapter.timestampLabel = visibleTimestamp;
    }

    if (parsedVisibleTimestamp !== null) {
      chapter.startSeconds = parsedVisibleTimestamp;
    } else if (linkedTimestamp.startSeconds !== undefined) {
      chapter.startSeconds = linkedTimestamp.startSeconds;
    }

    const dedupeKey = `${chapter.title}:${chapter.timestampLabel ?? ''}:${chapter.startSeconds ?? ''}`;

    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      chapters.push(chapter);
    }
  }

  return chapters;
}

function getTranscriptRows(document: Document) {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      [
        'ytd-transcript-segment-renderer',
        '[data-transcript-row]',
        '[data-target-id="transcript-row"]'
      ].join(', ')
    )
  );
}

export function normalizeTranscriptCues(rows: HTMLElement[]) {
  const cues: YouTubeTranscriptCue[] = [];

  for (const row of rows) {
    const childTexts = Array.from(row.children)
      .map((child) => normalizeText(child.textContent))
      .filter(Boolean);
    const timestampLabel =
      getElementText(row, [
        '#timestamp',
        '.segment-timestamp',
        '[class*="timestamp"]'
      ]) ||
      normalizeText(row.getAttribute('data-start-label')) ||
      childTexts.find((text) => parseTimestampLabel(text) !== null) ||
      '';
    const text =
      getElementText(row, [
        '#segment-text',
        '.segment-text',
        '[class*="segment-text"]'
      ]) ||
      normalizeText(row.getAttribute('data-text')) ||
      childTexts.filter((value) => value !== timestampLabel).join(' ');

    if (!timestampLabel || !text) {
      continue;
    }

    const cue: YouTubeTranscriptCue = {
      timestampLabel,
      text
    };
    const startSeconds = parseTimestampLabel(timestampLabel);

    if (startSeconds !== null) {
      cue.startSeconds = startSeconds;
    }

    cues.push(cue);
  }

  return cues;
}

export function truncateTranscript(cues: YouTubeTranscriptCue[]) {
  const transcript: YouTubeTranscriptCue[] = [];
  let totalCharacters = 0;

  for (const cue of cues) {
    if (transcript.length >= MAX_TRANSCRIPT_CUES) {
      break;
    }

    const nextTotal =
      totalCharacters + cue.text.length + cue.timestampLabel.length;

    if (nextTotal > MAX_TRANSCRIPT_CHARACTERS) {
      break;
    }

    transcript.push(cue);
    totalCharacters = nextTotal;
  }

  return transcript;
}

function hasTranscriptButton(document: Document) {
  return document.querySelector(
    [
      'button[aria-label*="transcript" i]',
      'button[title*="transcript" i]',
      '[aria-label*="transcript" i][role="button"]',
      'ytd-video-description-transcript-section-renderer'
    ].join(', ')
  );
}

export function isYouTubeWatchPage(url: string) {
  const parsed = parseUrl(url);

  if (!parsed) {
    return false;
  }

  return (
    isYouTubeHostname(parsed.hostname) &&
    parsed.pathname === '/watch' &&
    normalizeText(parsed.searchParams.get('v')).length > 0
  );
}

export function extractYouTubeVideoId(url: string) {
  if (!isYouTubeWatchPage(url)) {
    return null;
  }

  return normalizeText(parseUrl(url)?.searchParams.get('v')) || null;
}

export function extractYouTubeMediaContext(
  document: Document,
  url: string
): YouTubeMediaContext | null {
  const videoId = extractYouTubeVideoId(url);

  if (!videoId) {
    return null;
  }

  const base = {
    kind: 'youtube-video' as const,
    videoId,
    channelName: extractChannelName(document) || undefined,
    description: extractDescription(document) || extractTitle(document) || undefined,
    chapters: extractChapters(document, videoId)
  };

  const transcriptRows = getTranscriptRows(document);

  if (transcriptRows.length > 0) {
    const transcript = truncateTranscript(normalizeTranscriptCues(transcriptRows));

    if (transcript.length > 0) {
      return {
        ...base,
        transcriptStatus: 'available',
        transcript
      };
    }

    return {
      ...base,
      transcriptStatus: 'failed',
      transcript: [],
      transcriptFailureReason: 'parse-failed'
    };
  }

  if (hasTranscriptButton(document)) {
    return {
      ...base,
      transcriptStatus: 'not-requested',
      transcript: []
    };
  }

  return {
    ...base,
    transcriptStatus: 'unavailable',
    transcript: [],
    transcriptFailureReason: 'button-missing'
  };
}
