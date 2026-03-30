import { describe, expect, it } from 'vitest';

import { YouTubeMediaContextSchema } from '@riv/contracts';

import {
  extractYouTubeMediaContext,
  extractYouTubeVideoId,
  isYouTubeWatchPage
} from './extract-youtube-context';

function createWatchPageDocument() {
  document.head.innerHTML = `
    <meta property="og:title" content="How Riv reads YouTube pages" />
    <meta name="description" content="A walkthrough of the extraction pipeline." />
  `;

  document.body.innerHTML = `
    <main>
      <h1>How Riv reads YouTube pages</h1>
      <div id="owner">
        <a href="/@rivdev">Riv Dev</a>
      </div>
      <div id="description-inline-expander">
        <span>The DOM parser should stay deterministic.</span>
      </div>
      <div id="chapters">
        <a href="/watch?v=abc123&t=32s">
          <span class="chapter-title">Opening thesis</span>
          <span class="chapter-time">0:32</span>
        </a>
        <a href="/watch?v=abc123&t=185s">
          <span class="chapter-title">Transcript budgeting</span>
          <span class="chapter-time">3:05</span>
        </a>
      </div>
      <ytd-engagement-panel-section-list-renderer target-id="engagement-panel-searchable-transcript">
        <ytd-transcript-segment-renderer>
          <div id="timestamp">0:32</div>
          <div id="segment-text">  The speaker introduces   the main claim. </div>
        </ytd-transcript-segment-renderer>
        <ytd-transcript-segment-renderer>
          <div id="timestamp">0:47</div>
          <div id="segment-text">The argument is grounded in page evidence.</div>
        </ytd-transcript-segment-renderer>
      </ytd-engagement-panel-section-list-renderer>
    `;
}

describe('isYouTubeWatchPage', () => {
  it('detects canonical YouTube watch URLs and extracts the video id', () => {
    expect(isYouTubeWatchPage('https://www.youtube.com/watch?v=abc123')).toBe(
      true
    );
    expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=abc123')).toBe(
      'abc123'
    );
    expect(isYouTubeWatchPage('https://www.youtube.com/results?search_query=riv')).toBe(
      false
    );
    expect(extractYouTubeVideoId('https://www.youtube.com/results?search_query=riv')).toBeNull();
  });
});

describe('extractYouTubeMediaContext', () => {
  it('parses watch-page metadata, chapters, and rendered transcript cues', () => {
    createWatchPageDocument();

    const result = extractYouTubeMediaContext(
      document,
      'https://www.youtube.com/watch?v=abc123'
    );

    expect(YouTubeMediaContextSchema.parse(result)).toMatchObject({
      kind: 'youtube-video',
      videoId: 'abc123',
      channelName: 'Riv Dev',
      description: 'A walkthrough of the extraction pipeline.',
      chapters: [
        {
          title: 'Opening thesis',
          timestampLabel: '0:32',
          startSeconds: 32
        },
        {
          title: 'Transcript budgeting',
          timestampLabel: '3:05',
          startSeconds: 185
        }
      ],
      transcriptStatus: 'available'
    });

    expect(result?.transcript).toEqual([
      {
        timestampLabel: '0:32',
        startSeconds: 32,
        text: 'The speaker introduces the main claim.'
      },
      {
        timestampLabel: '0:47',
        startSeconds: 47,
        text: 'The argument is grounded in page evidence.'
      }
    ]);
  });

  it('parses chapter timestamps from common YouTube time query formats', () => {
    document.head.innerHTML = `
      <meta property="og:title" content="Chapter formats" />
    `;
    document.body.innerHTML = `
      <div id="chapters">
        <a href="/watch?v=abc123&t=1m32s">
          <span class="chapter-title">Minute format</span>
        </a>
        <a href="/watch?v=abc123&t=1h2m3s">
          <span class="chapter-title">Hour format</span>
        </a>
        <a href="/watch?v=abc123&start=1m32s">
          <span class="chapter-title">Start format</span>
        </a>
      </div>
    `;

    const result = extractYouTubeMediaContext(
      document,
      'https://www.youtube.com/watch?v=abc123'
    );

    expect(result?.chapters).toEqual([
      {
        title: 'Minute format',
        timestampLabel: '1:32',
        startSeconds: 92
      },
      {
        title: 'Hour format',
        timestampLabel: '1:02:03',
        startSeconds: 3723
      },
      {
        title: 'Start format',
        timestampLabel: '1:32',
        startSeconds: 92
      }
    ]);
  });

  it('truncates transcript cues deterministically from the start using both hard caps', () => {
    document.head.innerHTML = `
      <meta property="og:title" content="Budgeted transcript" />
      <meta name="description" content="Transcript budget test." />
    `;

    const rows = Array.from({ length: 170 }, (_, index) => {
      const minute = Math.floor(index / 60);
      const second = index % 60;

      return `
        <ytd-transcript-segment-renderer>
          <div id="timestamp">${minute}:${String(second).padStart(2, '0')}</div>
          <div id="segment-text">Cue ${index + 1} ${'word '.repeat(40)}</div>
        </ytd-transcript-segment-renderer>
      `;
    }).join('');

    document.body.innerHTML = `
      <button aria-label="Show transcript">Show transcript</button>
      <ytd-engagement-panel-section-list-renderer target-id="engagement-panel-searchable-transcript">
        ${rows}
      </ytd-engagement-panel-section-list-renderer>
    `;

    const result = extractYouTubeMediaContext(
      document,
      'https://www.youtube.com/watch?v=budget123'
    );

    expect(result?.transcriptStatus).toBe('available');
    expect(result?.transcript.length).toBeLessThanOrEqual(150);
    expect(
      result?.transcript.reduce((total, cue) => total + cue.text.length, 0)
    ).toBeLessThanOrEqual(12000);
    expect(result?.transcript[0]?.timestampLabel).toBe('0:00');
    expect(result?.transcript[0]?.text.startsWith('Cue 1')).toBe(true);
  });

  it('counts timestamp labels toward the transcript character budget', () => {
    document.head.innerHTML = `
      <meta property="og:title" content="Timestamp budget" />
    `;

    const rows = Array.from({ length: 151 }, (_, index) => {
      const minute = Math.floor(index / 60);
      const second = index % 60;

      return `
        <ytd-transcript-segment-renderer>
          <div id="timestamp">${minute}:${String(second).padStart(2, '0')}</div>
          <div id="segment-text">${'a'.repeat(77)}</div>
        </ytd-transcript-segment-renderer>
      `;
    }).join('');

    document.body.innerHTML = `
      <ytd-engagement-panel-section-list-renderer target-id="engagement-panel-searchable-transcript">
        ${rows}
      </ytd-engagement-panel-section-list-renderer>
    `;

    const result = extractYouTubeMediaContext(
      document,
      'https://www.youtube.com/watch?v=budget456'
    );
    const payloadCharacters =
      result?.transcript.reduce(
        (total, cue) => total + cue.text.length + cue.timestampLabel.length,
        0
      ) ?? 0;

    expect(result?.transcriptStatus).toBe('available');
    expect(result?.transcript.length).toBe(148);
    expect(payloadCharacters).toBeLessThanOrEqual(12000);
    expect(result?.transcript.at(-1)?.timestampLabel).toBe('2:27');
  });

  it('marks transcript as not requested when the button exists but rows are not rendered', () => {
    document.head.innerHTML = `
      <meta property="og:title" content="Transcript closed" />
    `;
    document.body.innerHTML = `
      <h1>Transcript closed</h1>
      <button aria-label="Show transcript">Show transcript</button>
    `;

    const result = extractYouTubeMediaContext(
      document,
      'https://www.youtube.com/watch?v=closed123'
    );

    expect(YouTubeMediaContextSchema.parse(result)).toMatchObject({
      kind: 'youtube-video',
      videoId: 'closed123',
      transcript: [],
      transcriptStatus: 'not-requested'
    });
  });

  it('marks transcript as unavailable when the transcript button is missing', () => {
    document.head.innerHTML = `
      <meta property="og:title" content="Transcript unavailable" />
    `;
    document.body.innerHTML = `
      <h1>Transcript unavailable</h1>
    `;

    const result = extractYouTubeMediaContext(
      document,
      'https://www.youtube.com/watch?v=missing123'
    );

    expect(YouTubeMediaContextSchema.parse(result)).toMatchObject({
      kind: 'youtube-video',
      videoId: 'missing123',
      transcript: [],
      transcriptStatus: 'unavailable',
      transcriptFailureReason: 'button-missing'
    });
  });

  it('marks transcript parsing as failed when rendered rows contain no usable cues', () => {
    document.head.innerHTML = `
      <meta property="og:title" content="Broken transcript" />
    `;
    document.body.innerHTML = `
      <ytd-engagement-panel-section-list-renderer target-id="engagement-panel-searchable-transcript">
        <ytd-transcript-segment-renderer>
          <div id="timestamp"></div>
          <div id="segment-text">   </div>
        </ytd-transcript-segment-renderer>
      </ytd-engagement-panel-section-list-renderer>
    `;

    const result = extractYouTubeMediaContext(
      document,
      'https://www.youtube.com/watch?v=broken123'
    );

    expect(YouTubeMediaContextSchema.parse(result)).toMatchObject({
      kind: 'youtube-video',
      videoId: 'broken123',
      transcript: [],
      transcriptStatus: 'failed',
      transcriptFailureReason: 'parse-failed'
    });
  });

  it('returns null for non-watch pages so generic extraction can continue unchanged', () => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<main><p>Search results</p></main>';

    expect(
      extractYouTubeMediaContext(
        document,
        'https://www.youtube.com/results?search_query=riv'
      )
    ).toBeNull();
  });
});
