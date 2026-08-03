import pRetry from 'p-retry';

// Errors are observed not only as Notion SDK error classes but also as plain objects
// wrapped in p-retry's `error` property, so probe structurally via Record<string, unknown>
// instead of instanceof
const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;

const extractErrorInfo = (error: unknown): { code: unknown; status: unknown; causeCode: unknown } => {
  const err = asRecord(error);
  const originalError = asRecord(err?.originalError);
  const wrappedError = asRecord(err?.error);
  const cause = asRecord(err?.cause);

  return {
    code: err?.code ?? originalError?.code ?? wrappedError?.code,
    status: err?.status ?? originalError?.status ?? wrappedError?.status,
    causeCode: cause?.code,
  };
};

const isKnownRetryableCode = (code: unknown): boolean =>
  typeof code === 'string' && ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(code);

export const isRetryableError = (error: unknown): boolean => {
  const { code, status, causeCode } = extractErrorInfo(error);

  return (
    code === 'notionhq_client_request_timeout' ||
    // Notion rate limiting (429 / rate_limited) resolves by waiting, so retry it
    code === 'rate_limited' ||
    status === 429 ||
    (code === 'notionhq_client_response_error' && (status === undefined || (typeof status === 'number' && status >= 500))) ||
    isKnownRetryableCode(code) ||
    isKnownRetryableCode(causeCode)
  );
};

const formatError = (error: unknown): string => {
  const message = asRecord(error)?.message;
  if (typeof message === 'string' && message) return message;
  if (typeof error === 'string') return error;
  return JSON.stringify(error, null, 2);
};

export const withRetry = <T>(fn: () => Promise<T>): Promise<T> =>
  pRetry(fn, {
    retries: 3,
    minTimeout: 5000,
    // Aborting via shouldRetry instead of throwing AbortError lets the original error
    // propagate with its structure and stack intact (nothing is lost to stringification)
    shouldRetry: ({ error }) => isRetryableError(error),
    onFailedAttempt: ({ error, attemptNumber, retriesLeft, retryDelay }) => {
      const { code, status } = extractErrorInfo(error);
      const retryable = isRetryableError(error);

      console.log(`Notion API call failed (attempt ${attemptNumber}/${retriesLeft + attemptNumber}):`, {
        code,
        status,
        message: error.message,
        isRetryable: retryable
      });

      if (!retryable) {
        console.error('Non-retryable error encountered:', formatError(error));
      } else if (retriesLeft > 0) {
        console.log(`Retrying in ${retryDelay / 1000}s...`);
      }
    }
  });
