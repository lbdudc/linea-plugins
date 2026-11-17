const pick = (table, key) =>
    (typeof key === 'string' && Object.hasOwn(table, key)) ? table[key] : undefined;

export const onError = (err, req, res, next) => {
    try {
        const errorHandler = pick(codeErrorHandlers, err?.code)
            || pick(errorHandlers, err?.constructor?.name)
            || errorHandlers.InternalServerError;
        errorHandler(res, err);
    } catch (error) {
        errorHandlers.InternalServerError(res);
    }
};

const codeErrorHandlers = {
    FEATURE_SELECTION_INVALID: (res) => {
      res.status(400).json({ error: 'error_messages.feature_selection_error' });
    },
    LINE_PLATFORM_NOT_FOUND: (res) => {
      res.status(404).json({ error: 'error_messages.line_platform_not_found' });
    },
    UNSUPPORTED_CONVERSION: (res) => {
      res.status(400).json({ error: 'error_messages.unsupported_conversion' });
    },
    UVL_PARSE_ERROR: (res) => {
      res.status(400).json({ error: 'error_messages.uvl_validation_error' });
    },
    INVALID_PRODUCT_SPEC: (res) => {
      res.status(400).json({ error: 'error_messages.invalid_product_spec' });
    },
    INVALID_ARGUMENT: (res) => {
      res.status(400).json({ error: 'error_messages.invalid_argument' });
    },
    PRODUCTS_INDEX_ERROR: (res) => {
      res.status(500).json({ error: 'error_messages.products_index_error' });
    },
    ANALYSIS_RUNTIME_ERROR: (res) => {
      res.status(500).json({ error: 'error_messages.analysis_runtime_error' });
    },
  };

const errorHandlers = {
    IncorrectCredentialsError: (res) => {
      res.status(401).json({ error: 'error_messages.incorrect_credentials' });
    },
    UserNotFoundError: (res) => {
      res.status(404).json({ error: 'error_messages.user_not_found' });
    },
    LineNotFoundError: (res) => {
      res.status(404).json({ error: 'error_messages.line_not_found' });
    },
    LinePlatformNotFoundError: (res) => {
      res.status(404).json({ error: 'error_messages.line_platform_not_found' });
    },
    PermissionError: (res) => {
      res.status(403).json({ error: 'error_messages.permission_error' });
    },
    AlreadyExistentUserError: (res) => {
      res.status(409).json({ error: 'error_messages.already_existent_user' });
    },
    AlreadyExistentLineError: (res) => {
      res.status(409).json({ error: 'error_messages.already_existent_line' });
    },
    AlreadyExistentProductError: (res) => {
      res.status(409).json({ error: 'error_messages.already_existent_product' });
    },
    FeatureSelectionError: (res) => {
      res.status(400).json({ error: 'error_messages.feature_selection_error' });
    },
    UVLValidationError: (res) => {
      res.status(400).json({ error: 'error_messages.uvl_validation_error' });
    },
    UnsupportedConversionError: (res) => {
      res.status(400).json({ error: 'error_messages.unsupported_conversion' });
    },
    ProductSpecUnavailableError: (res) => {
      res.status(503).json({ error: 'error_messages.product_spec_unavailable' });
    },
    ProductSpecFileError: (res) => {
      res.status(422).json({ error: 'error_messages.product_spec_invalid' });
    },
    // LINEA said no (or what the person asked for is not there): the person is told what LINEA said
    LineaApiError: (res, err) => {
      const status = err.status >= 400 && err.status < 600 ? err.status : 502;
      res.status(status).json(err.body && typeof err.body === 'object' ? err.body : { error: 'error_messages.linea_error' });
    },
    LineaUnreachableError: (res) => {
      res.status(502).json({ error: 'error_messages.linea_unreachable' });
    },
    NoActingUserError: (res) => {
      res.status(401).json({ error: 'error_messages.incorrect_credentials' });
    },
    InternalServerError: (res) => {
      res.status(500).json({ error: 'error_messages.internal_error' });
    },
  };