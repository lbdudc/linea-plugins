/** LINEA answered with an error. `status` is its HTTP status and `body` what it said. */
export class LineaApiError extends Error {
  constructor(message, { status, body, path } = {}) {
    super(message);
    this.name = 'LineaApiError';
    this.status = status;
    this.body = body;
    this.path = path;
  }
}

/** LINEA could not be reached at all (down, DNS, timeout): not an answer, so not a verdict about the data. */
export class LineaUnreachableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'LineaUnreachableError';
    this.code = options?.cause?.code;
  }
}

/** Nobody to act for: the call was made outside a request or a run, and no user id was given. */
export class NoActingUserError extends Error {
  constructor() {
    super('No acting user: a call to LINEA needs the user it is made for');
    this.name = 'NoActingUserError';
  }
}
