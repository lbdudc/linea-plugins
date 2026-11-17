class IncorrectCredentialsError extends Error {
    constructor(message) {
      super(message);
    }
  }

  class UserNotFoundError extends Error {
    constructor(message) {
      super(message);
    }
  }

  class LineNotFoundError extends Error {
    constructor(message) {
      super(message);
    }
  }

  class AlreadyExistentUserError extends Error {
    constructor(message) {
      super(message);
    }
  }

  class AlreadyExistentLineError extends Error {
    constructor(message) {
      super(message);
    }
  }

  class AlreadyExistentProductError extends Error {
    constructor(message) {
      super(message);
    }
  }

  class PermissionError extends Error {
    constructor(message) {
      super(message);
    }
  }

  class LinePlatformNotFoundError extends Error {
    constructor(message) {
      super(message);
    }
  }

  class UVLValidationError extends Error {
    constructor(message) {
      super(message);
    }
  }

  class UnsupportedConversionError extends Error {
    constructor(message) {
      super(message);
    }
  }

export { IncorrectCredentialsError, UserNotFoundError, LineNotFoundError, AlreadyExistentUserError, AlreadyExistentLineError, AlreadyExistentProductError, PermissionError, LinePlatformNotFoundError, UVLValidationError, UnsupportedConversionError };
  