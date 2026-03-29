import OpenAI from 'openai';

import type {
  ActionProposalDraft,
  ModelGateway,
  ModelGatewayStreamEvent,
  ModelGatewayTurnInput,
  ModelGatewayTurnResult
} from './types';

export type MockModelGatewayResponse =
  | ModelGatewayTurnResult
  | ((
      input: ModelGatewayTurnInput
    ) => Promise<ModelGatewayTurnResult> | ModelGatewayTurnResult);

export type OpenAIModelGatewayOptions = {
  apiKey: string;
  model?: string;
  defaultProposals?: ActionProposalDraft[];
};

function chunkAssistantMessage(message: string) {
  const chunks: string[] = [];
  const sections = message.split(/(\n\n+)/).filter((section) => section.length);
  let current = '';

  for (const section of sections) {
    if ((current + section).length > 120 && current.length > 0) {
      chunks.push(current);
      current = section;
      continue;
    }

    current += section;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  if (chunks.length > 1 || message.length <= 120) {
    return chunks;
  }

  const wordChunks: string[] = [];
  let wordBuffer = '';

  for (const token of message.split(/(\s+)/).filter((part) => part.length)) {
    if ((wordBuffer + token).length > 80 && wordBuffer.length > 0) {
      wordChunks.push(wordBuffer);
      wordBuffer = token;
      continue;
    }

    wordBuffer += token;
  }

  if (wordBuffer.length > 0) {
    wordChunks.push(wordBuffer);
  }

  return wordChunks;
}

export class MockModelGateway implements ModelGateway {
  constructor(private readonly response: MockModelGatewayResponse) {}

  async *streamTurn(
    input: ModelGatewayTurnInput
  ): AsyncGenerator<ModelGatewayStreamEvent> {
    const result =
      typeof this.response === 'function'
        ? await this.response(input)
        : this.response;

    for (const chunk of chunkAssistantMessage(result.assistantMessage)) {
      if (!chunk) {
        continue;
      }

      yield {
        type: 'message_delta',
        delta: chunk
      };
    }

    for (const proposal of result.proposals) {
      yield {
        type: 'proposal',
        proposal
      };
    }
  }
}

export class OpenAIModelGateway implements ModelGateway {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly defaultProposals: ActionProposalDraft[];

  constructor(options: OpenAIModelGatewayOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey
    });
    this.model = options.model ?? 'gpt-5-mini';
    this.defaultProposals = options.defaultProposals ?? [];
  }

  async *streamTurn(
    input: ModelGatewayTurnInput
  ): AsyncGenerator<ModelGatewayStreamEvent> {
    const stream = this.client.responses.stream({
      model: this.model,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: [
                'You are Riv, a browser-side assistant.',
                'Reply with concise, well-structured markdown.',
                'Use short headings and bullets when the answer has multiple parts.',
                'Do not wrap the full reply in code fences.',
                'Do not invent browser actions unless the server provides them separately.'
              ].join(' ')
            }
          ]
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: JSON.stringify({
                thread: input.thread,
                userMessage: input.userMessage,
                recentMessages: input.messages.slice(-6),
                memories: input.memories,
                transientAttachments: input.transientAttachments
              })
            }
          ]
        }
      ]
    });

    let emittedText = false;

    for await (const event of stream) {
      if (event.type !== 'response.output_text.delta' || !event.delta) {
        continue;
      }

      emittedText = true;
      yield {
        type: 'message_delta',
        delta: event.delta
      };
    }

    if (!emittedText) {
      yield {
        type: 'message_delta',
        delta: 'I reviewed the available context.'
      };
    }

    for (const proposal of this.defaultProposals) {
      yield {
        type: 'proposal',
        proposal
      };
    }
  }
}
