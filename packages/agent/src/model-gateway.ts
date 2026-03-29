import OpenAI from 'openai';

import type {
  ActionProposalDraft,
  ModelGateway,
  ModelGatewayTurnInput,
  ModelGatewayTurnResult
} from './types';

export type MockModelGatewayResponse =
  | ModelGatewayTurnResult
  | ((input: ModelGatewayTurnInput) => Promise<ModelGatewayTurnResult> | ModelGatewayTurnResult);

export class MockModelGateway implements ModelGateway {
  constructor(private readonly response: MockModelGatewayResponse) {}

  async generateTurn(input: ModelGatewayTurnInput) {
    if (typeof this.response === 'function') {
      return await this.response(input);
    }

    return this.response;
  }
}

export type OpenAIModelGatewayOptions = {
  apiKey: string;
  model?: string;
  defaultProposals?: ActionProposalDraft[];
};

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

  async generateTurn(input: ModelGatewayTurnInput): Promise<ModelGatewayTurnResult> {
    const response = await this.client.responses.create({
      model: this.model,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: [
                'You are Riv, a browser-side assistant.',
                'Reply concisely.',
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

    return {
      assistantMessage:
        response.output_text?.trim() || 'I reviewed the available context.',
      proposals: this.defaultProposals
    };
  }
}
