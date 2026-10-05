export class ActionServiceError extends Error {
  constructor(message: string, readonly code: string, readonly status: number = 409) {
    super(message)
    this.name = 'ActionServiceError'
  }
}
