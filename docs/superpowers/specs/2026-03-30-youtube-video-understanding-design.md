# YouTube Video Understanding Design

## Goal

Extend Riv so it can answer substantive questions about YouTube videos from page-derived evidence, not just surface metadata. For v1, the target is YouTube watch pages only. The system should extract structured video context, especially transcripts when available, and guide the model to answer from that evidence with clear limitations when transcript data is missing.

## Scope

In scope:

- Detect YouTube watch pages in the extension.
- Extract YouTube-specific metadata from the page.
- Extract transcript segments with timestamps when available.
- Send structured video context through the existing extension -> API -> agent pipeline.
- Update prompt/input construction so the assistant prioritizes transcript evidence.
- Preserve current behavior for non-YouTube pages.

Out of scope:

- Audio transcription of media streams.
- Frame analysis or multimodal video understanding.
- Vimeo or arbitrary video-site support.
- New backend media-processing infrastructure.

## Product Behavior

On a YouTube watch page, Riv should answer questions such as:

- "What is this video arguing?"
- "What are the main points?"
- "Where does it say X?"
- "Summarize this video's position on Y."

Best case:

- Riv extracts transcript cues and answers from them.
- The response cites timestamps when helpful.
- The response distinguishes thesis, supporting points, and evidence.

Fallback case:

- If no transcript is available, Riv answers from visible description, chapters, and page metadata.
- Riv explicitly states that transcript evidence was unavailable and that the answer is based on surface page context only.

## Architecture

The implementation should extend the existing page-context pipeline instead of introducing a separate media ingestion service.

Current flow:

1. Content script extracts page context from the active tab.
2. Background script requests page context from the content script.
3. Sidepanel sends attachments to the API.
4. Agent forwards thread, messages, memories, and transient attachments to the model.

Planned change:

1. Detect YouTube watch pages in the content script extractor.
2. Enrich the extracted page context with a structured `media` block for YouTube videos.
3. Preserve existing `contentBlocks` for generic reasoning.
4. Pass the enriched page snapshot through the existing attachment flow unchanged.
5. Update model guidance so transcript evidence is preferred over shallow page metadata.

## Data Model

The design should extend `PageContextSnapshot` with optional media context rather than adding a separate attachment kind in v1.

Proposed structure:

```ts
media?: {
  kind: 'youtube-video';
  videoId: string;
  channelName?: string;
  description?: string;
  chapters: Array<{
    title: string;
    timestampLabel?: string;
    startSeconds?: number;
  }>;
  transcript: Array<{
    timestampLabel: string;
    startSeconds?: number;
    text: string;
  }>;
  transcriptStatus: 'available' | 'unavailable' | 'not-requested' | 'failed';
  transcriptFailureReason?:
    | 'button-missing'
    | 'panel-open-failed'
    | 'panel-timeout'
    | 'parse-failed';
}
```

Design constraints:

- `media` must be optional so non-YouTube pages remain valid without branching logic throughout the stack.
- `contentBlocks` remain intact for the existing generic summarization path.
- Transcript items should be normalized into concise segments, not raw DOM dumps.
- Transcript payloads must be bounded before they enter the API request.

Transcript budget for v1:

- hard cap at 150 transcript cues
- hard cap at 12,000 transcript characters after normalization
- deterministic trimming from the start of the transcript until either cap is reached
- an oversized-transcript test fixture must verify that truncation is stable and repeatable

## Extraction Strategy

Extraction should be layered and resilient:

1. Detect whether the current page is a YouTube watch page.
2. Read stable metadata first:
   - title
   - video id
   - channel name
   - description text
   - chapter list when visible
3. Attempt transcript extraction:
   - If transcript panel is already open, parse cue rows.
   - If transcript UI is available but closed, attempt to open it programmatically.
   - Wait briefly for transcript content to render.
   - Parse cue rows into structured segments.
   - Restore the page to its prior UI state if the extension opened the transcript panel.
4. If transcript parsing fails or transcript UI is unavailable:
   - return the rest of the video context
   - mark transcript status accordingly
   - set a specific `transcriptFailureReason` when the failure is known

Important behavior:

- Transcript extraction must not block page capture indefinitely.
- A timeout/fallback path is required.
- Transcript extraction must be non-invasive from the user's point of view; if the extension changes the page UI to access transcript data, it must restore the prior state before returning.
- DOM selectors should be isolated in a single YouTube-specific parser module so site changes are easier to fix.

## Prompting and Answer Quality

The agent input should continue sending recent messages and transient attachments, but the model instructions should be tightened for pages with `media.kind === 'youtube-video'`.

Required answer behavior:

- Prefer transcript evidence over title/description inference.
- Summarize the central claim or argument first.
- Organize the answer into thesis and support when appropriate.
- Reference timestamps when transcript data supports it.
- State limitations explicitly when no transcript is available.

Desired failure mode:

- "I can only infer from the video's description and chapters because the transcript was not available on the page."

Desired diagnostic quality:

- When transcript extraction fails, the agent input should carry a reason specific enough for internal debugging and for accurate limitation text.

This is materially better than implying full video understanding when the system only has partial evidence.

## Rollout Plan

Implementation order:

1. Extend contracts for optional YouTube media context.
2. Add YouTube page detection and metadata extraction.
3. Add chapter extraction.
4. Add transcript extraction from the rendered transcript panel.
5. Update model input/prompting to prioritize transcript evidence.
6. Optionally add lightweight UI provenance later, such as a transcript-captured label.

This ordering ensures the system delivers incremental value even before transcript extraction is perfect.

## Risks

### YouTube DOM volatility

The transcript and chapter UI may change. To contain breakage:

- keep selectors in one parser module
- add focused tests using representative HTML fixtures
- degrade gracefully instead of failing the whole capture

### Transcript availability

Some videos may not expose transcripts to the page. The assistant must not overstate confidence in that case.

### Context bloat

Large transcripts can overwhelm model context. The design should cap transcript size, normalize whitespace, and possibly trim cues to the most relevant or first N segments until better chunking exists.

Because the current request path serializes attachment payloads directly into model input, transcript truncation must happen in the extension before the request is sent.

### UI timing and async extraction

Opening the transcript panel may require waiting for YouTube UI updates. The extractor should use a short bounded wait and return partial context if the transcript does not materialize.

## Testing Strategy

Required tests:

- Contract validation for the new optional media fields.
- YouTube watch-page detection tests.
- Metadata extraction tests.
- Chapter extraction tests.
- Transcript parsing tests.
- Oversized transcript truncation tests.
- Missing-transcript fallback tests.
- Transcript failure-reason coverage tests.
- Page-state restoration tests for cases where transcript extraction opens and closes transcript UI.
- Integration test proving the enriched page context reaches the model input.
- Behavior test proving Riv shows a substantive answer path when transcript data exists.

Where possible, transcript and chapter parsing should be tested against DOM fixtures rather than browser-only flows.

## Success Criteria

The feature is successful when:

- On a normal YouTube watch page with transcript available, Riv can answer "what is this video arguing?" with a substantive summary grounded in transcript evidence.
- Riv can point to timestamps for supporting points when the transcript provides them.
- When transcript data is unavailable, Riv clearly states that it answered from description, chapters, or other visible page text only.
- Non-YouTube page capture and current sidepanel behavior remain unchanged.

## Non-Goals for Follow-Up Work

Likely future work, but not part of this design:

- Vimeo support
- arbitrary HTML5 video support
- audio transcription services
- frame-level analysis
- caching full transcripts per thread or per video
- semantic retrieval over very long transcripts
