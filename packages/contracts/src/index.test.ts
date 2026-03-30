import { describe, expect, it } from 'vitest';

import {
  ActionConfirmationSchema,
  ActionProposalSchema,
  AssistantStreamEventSchema,
  BrowserTabSummarySchema,
  ContextAttachmentSchema,
  DashboardAutomationsResponseSchema,
  DashboardOverviewResponseSchema,
  GoogleIntegrationStatusSchema,
  MessageEnvelopeSchema,
  PageContextSnapshotSchema
} from './index';

describe('contracts', () => {
  it('rejects available YouTube transcript states with a failure reason', () => {
    expect(() =>
      PageContextSnapshotSchema.parse({
        tabId: 12,
        url: 'https://www.youtube.com/watch?v=abc123',
        title: 'Example video',
        pageType: 'generic',
        capturedAt: '2026-03-29T15:00:00.000Z',
        metadata: {},
        contentBlocks: [],
        media: {
          kind: 'youtube-video',
          videoId: 'abc123',
          chapters: [],
          transcript: [
            {
              timestampLabel: '0:32',
              startSeconds: 32,
              text: 'The speaker introduces the main claim.'
            }
          ],
          transcriptStatus: 'available',
          transcriptFailureReason: 'button-missing'
        }
      })
    ).toThrow();
  });

  it('rejects unavailable YouTube transcript states with transcript cues', () => {
    expect(() =>
      PageContextSnapshotSchema.parse({
        tabId: 12,
        url: 'https://www.youtube.com/watch?v=abc123',
        title: 'Example video',
        pageType: 'generic',
        capturedAt: '2026-03-29T15:00:00.000Z',
        metadata: {},
        contentBlocks: [],
        media: {
          kind: 'youtube-video',
          videoId: 'abc123',
          chapters: [],
          transcript: [
            {
              timestampLabel: '0:32',
              startSeconds: 32,
              text: 'The speaker introduces the main claim.'
            }
          ],
          transcriptStatus: 'unavailable',
          transcriptFailureReason: 'button-missing'
        }
      })
    ).toThrow();
  });

  it('rejects failed YouTube transcript states with transcript cues', () => {
    expect(() =>
      PageContextSnapshotSchema.parse({
        tabId: 12,
        url: 'https://www.youtube.com/watch?v=abc123',
        title: 'Example video',
        pageType: 'generic',
        capturedAt: '2026-03-29T15:00:00.000Z',
        metadata: {},
        contentBlocks: [],
        media: {
          kind: 'youtube-video',
          videoId: 'abc123',
          chapters: [],
          transcript: [
            {
              timestampLabel: '0:32',
              startSeconds: 32,
              text: 'The speaker introduces the main claim.'
            }
          ],
          transcriptStatus: 'failed',
          transcriptFailureReason: 'parse-failed'
        }
      })
    ).toThrow();
  });

  it('rejects available YouTube transcript states with no transcript evidence', () => {
    expect(() =>
      PageContextSnapshotSchema.parse({
        tabId: 12,
        url: 'https://www.youtube.com/watch?v=abc123',
        title: 'Example video',
        pageType: 'generic',
        capturedAt: '2026-03-29T15:00:00.000Z',
        metadata: {},
        contentBlocks: [],
        media: {
          kind: 'youtube-video',
          videoId: 'abc123',
          chapters: [],
          transcript: [],
          transcriptStatus: 'available'
        }
      })
    ).toThrow();
  });

  it('retains optional YouTube media context on parsed page snapshots', () => {
    expect(
      PageContextSnapshotSchema.parse({
        tabId: 12,
        url: 'https://www.youtube.com/watch?v=abc123',
        title: 'Example video',
        pageType: 'generic',
        capturedAt: '2026-03-29T15:00:00.000Z',
        metadata: {},
        contentBlocks: [],
        media: {
          kind: 'youtube-video',
          videoId: 'abc123',
          channelName: 'Example Channel',
          description: 'Example description',
          chapters: [
            {
              title: 'Introduction',
              timestampLabel: '0:00',
              startSeconds: 0
            }
          ],
          transcript: [
            {
              timestampLabel: '0:32',
              startSeconds: 32,
              text: 'The speaker introduces the main claim.'
            }
          ],
          transcriptStatus: 'available'
        }
      })
    ).toMatchObject({
      media: {
        kind: 'youtube-video',
        videoId: 'abc123',
        channelName: 'Example Channel',
        description: 'Example description',
        chapters: [
          {
            title: 'Introduction',
            timestampLabel: '0:00',
            startSeconds: 0
          }
        ],
        transcript: [
          {
            timestampLabel: '0:32',
            startSeconds: 32,
            text: 'The speaker introduces the main claim.'
          }
        ],
        transcriptStatus: 'available'
      }
    });
  });

  it('retains YouTube transcript failure reasons in parsed snapshots', () => {
    expect(
      PageContextSnapshotSchema.parse({
        tabId: 12,
        url: 'https://www.youtube.com/watch?v=abc123',
        title: 'Example video',
        pageType: 'generic',
        capturedAt: '2026-03-29T15:00:00.000Z',
        metadata: {},
        contentBlocks: [],
        media: {
          kind: 'youtube-video',
          videoId: 'abc123',
          chapters: [],
          transcript: [],
          transcriptStatus: 'unavailable',
          transcriptFailureReason: 'button-missing'
        }
      })
    ).toMatchObject({
      media: {
        transcriptStatus: 'unavailable',
        transcriptFailureReason: 'button-missing'
      }
    });
  });

  it('retains parsed YouTube transcript cues in page snapshots', () => {
    expect(
      PageContextSnapshotSchema.parse({
        tabId: 12,
        url: 'https://www.youtube.com/watch?v=abc123',
        title: 'Example video',
        pageType: 'generic',
        capturedAt: '2026-03-29T15:00:00.000Z',
        metadata: {},
        contentBlocks: [],
        media: {
          kind: 'youtube-video',
          videoId: 'abc123',
          chapters: [],
          transcript: [
            {
              timestampLabel: '0:32',
              startSeconds: 32,
              text: 'The speaker introduces the main claim.'
            }
          ],
          transcriptStatus: 'available'
        }
      })
    ).toMatchObject({
      media: {
        transcript: [
          {
            timestampLabel: '0:32',
            startSeconds: 32,
            text: 'The speaker introduces the main claim.'
          }
        ]
      }
    });
  });

  it('parses a valid page context snapshot', () => {
    const snapshot = PageContextSnapshotSchema.parse({
      tabId: 12,
      url: 'https://example.com/article',
      title: 'Example article',
      pageType: 'article',
      capturedAt: '2026-03-29T15:00:00.000Z',
      metadata: {
        byline: 'Ada'
      },
      contentBlocks: [
        {
          id: 'intro',
          kind: 'paragraph',
          text: 'Riv can read this page.'
        }
      ]
    });

    expect(snapshot.url).toBe('https://example.com/article');
    expect(snapshot.contentBlocks).toHaveLength(1);
  });

  it('rejects malformed page context snapshots', () => {
    expect(() =>
      PageContextSnapshotSchema.parse({
        tabId: 'bad-id',
        url: 'notaurl',
        title: 'Broken',
        pageType: 'article',
        capturedAt: 'not-a-date',
        metadata: {},
        contentBlocks: []
      })
    ).toThrow();
  });

  it('rejects malformed tab summaries', () => {
    expect(() =>
      BrowserTabSummarySchema.parse({
        tabId: 'abc',
        windowId: 1,
        index: 0,
        url: 'https://example.com',
        title: 'Example',
        active: true,
        pinned: false,
        groupId: -1
      })
    ).toThrow();
  });

  it('parses context attachments for tab inventories', () => {
    const attachment = ContextAttachmentSchema.parse({
      kind: 'tabs',
      tabs: [
        {
          tabId: 3,
          windowId: 1,
          index: 0,
          url: 'https://example.com',
          title: 'Example',
          active: true,
          pinned: false,
          groupId: -1
        }
      ]
    });

    expect(attachment.kind).toBe('tabs');

    if (attachment.kind === 'tabs') {
      expect(attachment.tabs[0]?.tabId).toBe(3);
    }
  });

  it('parses dashboard overview payloads with reminders and gmail suggestions', () => {
    const payload = DashboardOverviewResponseSchema.parse({
      meetings: [
        {
          id: 'meeting_1',
          title: 'Weekly product sync',
          startAt: '2026-03-31T09:00:00.000Z',
          endAt: '2026-03-31T10:00:00.000Z',
          attendees: ['alex@example.com'],
          source: 'google-calendar'
        }
      ],
      reminders: [
        {
          id: 'reminder_1',
          meetingId: 'meeting_1',
          triggerAt: '2026-03-31T08:30:00.000Z',
          status: 'scheduled'
        }
      ],
      gmailSuggestions: [
        {
          id: 'suggestion_1',
          meetingId: 'meeting_1',
          threadId: 'thread_99',
          subject: 'Agenda for weekly product sync',
          suggestion:
            'Hi team, here are the updates I plan to cover in today’s sync...',
          status: 'new',
          matchSignals: ['participant-overlap', 'subject-similarity']
        }
      ]
    });

    expect(payload.meetings[0]?.source).toBe('google-calendar');
    expect(payload.gmailSuggestions[0]?.status).toBe('new');
  });

  it('parses dashboard automations payloads with settings and run logs', () => {
    const payload = DashboardAutomationsResponseSchema.parse({
      automations: [
        {
          key: 'meeting-reminders',
          name: 'Meeting reminders',
          enabled: true,
          status: 'healthy',
          nextRunAt: '2026-03-30T15:00:00.000Z'
        }
      ],
      runLogs: [
        {
          id: 'run_1',
          automationKey: 'meeting-reminders',
          status: 'success',
          message: 'Scheduled reminders for 3 meetings.',
          startedAt: '2026-03-30T14:00:00.000Z',
          finishedAt: '2026-03-30T14:00:02.000Z'
        }
      ],
      settings: {
        meetingReminderOffsetsMinutes: [1440, 30],
        enabledMeetingReminders: true,
        enabledGmailSuggestions: true
      }
    });

    expect(payload.settings.meetingReminderOffsetsMinutes).toEqual([1440, 30]);
    expect(payload.runLogs[0]?.status).toBe('success');
  });

  it('parses Google integration connection status', () => {
    const status = GoogleIntegrationStatusSchema.parse({
      provider: 'google',
      status: 'connected',
      calendarConnected: true,
      gmailConnected: true,
      connectedAt: '2026-03-30T14:00:00.000Z',
      scopes: ['calendar.readonly', 'gmail.readonly']
    });

    expect(status.provider).toBe('google');
    expect(status.status).toBe('connected');
  });

  it('parses action proposals and rejects missing confirmation requirements', () => {
    const proposal = ActionProposalSchema.parse({
      id: 'proposal_1',
      threadId: 'thread_1',
      kind: 'groupTabs',
      reason: 'These tabs are all about Riv',
      preview: {
        title: 'Group 3 related tabs',
        summary: 'Create a Riv research tab group',
        items: ['https://docs.riv.dev', 'https://example.com']
      },
      riskLevel: 'low',
      requiresConfirmation: true,
      payload: {
        tabIds: [1, 2, 3],
        title: 'Riv research'
      },
      createdAt: '2026-03-29T15:00:00.000Z'
    });

    expect(proposal.kind).toBe('groupTabs');

    expect(() =>
      ActionProposalSchema.parse({
        id: 'proposal_2',
        threadId: 'thread_1',
        kind: 'closeTabs',
        reason: 'Close duplicates',
        preview: {
          title: 'Close duplicate tabs',
          summary: 'Remove duplicates',
          items: []
        },
        riskLevel: 'high',
        payload: {
          tabIds: [4, 5]
        },
        createdAt: '2026-03-29T15:00:00.000Z'
      })
    ).toThrow();
  });

  it('rejects malformed action confirmations', () => {
    expect(() =>
      ActionConfirmationSchema.parse({
        proposalId: 'proposal_1',
        threadId: 'thread_1',
        decision: 'confirm'
      })
    ).toThrow();
  });

  it('parses message envelopes for assistant stream events', () => {
    const envelope = MessageEnvelopeSchema.parse({
      version: '2026-03-29',
      type: 'assistant_stream',
      emittedAt: '2026-03-29T15:00:00.000Z',
      payload: {
        type: 'proposal_created',
        proposal: {
          id: 'proposal_1',
          threadId: 'thread_1',
          kind: 'groupTabs',
          reason: 'These tabs are related',
          preview: {
            title: 'Group tabs',
            summary: 'Group related tabs',
            items: []
          },
          riskLevel: 'low',
          requiresConfirmation: true,
          payload: {
            tabIds: [1, 2]
          },
          createdAt: '2026-03-29T15:00:00.000Z'
        }
      }
    });

    expect(envelope.payload.type).toBe('proposal_created');
    expect(() =>
      AssistantStreamEventSchema.parse({ type: 'unknown' })
    ).toThrow();
  });
});
