export class AgentRuntimeError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'AgentRuntimeError';
  }
}
