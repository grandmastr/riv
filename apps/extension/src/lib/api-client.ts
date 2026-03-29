import {
  MessageEnvelopeSchema,
  type ActionProposal,
  type ContextAttachment,
  type ConversationThread,
  type MessageEnvelope
} from '@riv/contracts';

const DEFAULT_API_URL = 'http://localhost:3000';
const DEFAULT_VIEWER_ID = 'user_dev';

function getApiBaseUrl() {
  const env = (
    import.meta as ImportMeta & {
      env?: Record<string, string | undefined>;
    }
  ).env;

  return env?.WXT_RIV_API_URL || DEFAULT_API_URL;
}

function createHeaders() {
  return {
    'content-type': 'application/json',
    'x-riv-user-id': DEFAULT_VIEWER_ID
  };
}

async function readErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    try {
      const payload = (await response.json()) as { error?: string };

      if (payload.error) {
        return payload.error;
      }
    } catch {
      return fallback;
    }
  }

  const text = await response.text();
  return text.trim() || fallback;
}

function parseSsePayload(text: string) {
  return text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice(6)))
    .map((envelope) => MessageEnvelopeSchema.parse(envelope));
}

async function* parseSseStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, {
      stream: !done
    });

    let boundaryIndex = buffer.indexOf('\n\n');

    while (boundaryIndex >= 0) {
      const chunk = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);

      if (chunk.startsWith('data: ')) {
        yield MessageEnvelopeSchema.parse(JSON.parse(chunk.slice(6)));
      }

      boundaryIndex = buffer.indexOf('\n\n');
    }

    if (done) {
      break;
    }
  }

  const trailing = buffer.trim();

  if (trailing.startsWith('data: ')) {
    yield MessageEnvelopeSchema.parse(JSON.parse(trailing.slice(6)));
  }
}

export async function createThread(title: string) {
  const response = await fetch(`${getApiBaseUrl()}/threads`, {
    method: 'POST',
    headers: createHeaders(),
    body: JSON.stringify({ title })
  });

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(
        response,
        `Unable to create a Riv thread (${response.status}).`
      )
    );
  }

  const payload = (await response.json()) as { thread: ConversationThread };
  return payload.thread;
}

export async function* sendMessage(
  threadId: string,
  content: string,
  attachments: ContextAttachment[]
) {
  const response = await fetch(
    `${getApiBaseUrl()}/threads/${threadId}/messages`,
    {
      method: 'POST',
      headers: createHeaders(),
      body: JSON.stringify({
        content,
        attachments
      })
    }
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(
        response,
        `Riv could not send the message (${response.status}).`
      )
    );
  }

  if (!response.body) {
    for (const envelope of parseSsePayload(await response.text())) {
      yield envelope;
    }

    return;
  }

  for await (const envelope of parseSseStream(response.body)) {
    yield envelope;
  }
}

export async function resolveProposal(
  threadId: string,
  proposal: ActionProposal,
  decision: 'confirm' | 'reject'
) {
  const endpoint = decision === 'confirm' ? 'confirm' : 'reject';

  const response = await fetch(
    `${getApiBaseUrl()}/threads/${threadId}/action-proposals/${proposal.id}/${endpoint}`,
    {
      method: 'POST',
      headers: createHeaders()
    }
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(
        response,
        `Riv could not ${endpoint} the proposal (${response.status}).`
      )
    );
  }

  return response.json() as Promise<{
    result: MessageEnvelope['payload'] | unknown;
  }>;
}
