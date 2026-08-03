import { describe, it, expect } from 'vitest';
import { isRetryableError } from '../src/retry';

describe('isRetryableError', () => {
  it('treats notionhq_client_request_timeout as retryable', () => {
    const error = { code: 'notionhq_client_request_timeout' };

    const result = isRetryableError(error);

    expect(result).toBe(true);
  });

  it('treats a 500 response as retryable', () => {
    const error = { code: 'notionhq_client_response_error', status: 500 };

    const result = isRetryableError(error);

    expect(result).toBe(true);
  });

  it('treats a 502 response as retryable', () => {
    const error = { code: 'notionhq_client_response_error', status: 502 };

    const result = isRetryableError(error);

    expect(result).toBe(true);
  });

  it('treats a 503 response as retryable', () => {
    const error = { code: 'notionhq_client_response_error', status: 503 };

    const result = isRetryableError(error);

    expect(result).toBe(true);
  });

  it('treats ECONNRESET as retryable', () => {
    const error = { code: 'ECONNRESET' };

    const result = isRetryableError(error);

    expect(result).toBe(true);
  });

  it('treats ETIMEDOUT as retryable', () => {
    const error = { code: 'ETIMEDOUT' };

    const result = isRetryableError(error);

    expect(result).toBe(true);
  });

  it('treats ENOTFOUND as retryable', () => {
    const error = { code: 'ENOTFOUND' };

    const result = isRetryableError(error);

    expect(result).toBe(true);
  });

  it('treats a 400 response as non-retryable', () => {
    const error = { code: 'notionhq_client_response_error', status: 400 };

    const result = isRetryableError(error);

    expect(result).toBe(false);
  });

  it('treats a 401 response as non-retryable', () => {
    const error = { code: 'notionhq_client_response_error', status: 401 };

    const result = isRetryableError(error);

    expect(result).toBe(false);
  });

  it('treats a 404 response as non-retryable', () => {
    const error = { code: 'notionhq_client_response_error', status: 404 };

    const result = isRetryableError(error);

    expect(result).toBe(false);
  });

  it('treats an unknown error code as non-retryable', () => {
    const error = { code: 'unknown_error' };

    const result = isRetryableError(error);

    expect(result).toBe(false);
  });

  it('treats a 504 wrapped in the p-retry error property as retryable', () => {
    const error = {
      error: {
        name: 'UnknownHTTPResponseError',
        code: 'notionhq_client_response_error',
        status: 504,
      },
      attemptNumber: 1,
      retriesLeft: 3,
    };

    const result = isRetryableError(error);

    expect(result).toBe(true);
  });

  it('treats a 502 wrapped in the p-retry error property as retryable', () => {
    const error = {
      error: {
        name: 'UnknownHTTPResponseError',
        code: 'notionhq_client_response_error',
        status: 502,
      },
      attemptNumber: 1,
      retriesLeft: 3,
    };

    const result = isRetryableError(error);

    expect(result).toBe(true);
  });

  it('treats a 400 wrapped in the p-retry error property as non-retryable', () => {
    const error = {
      error: {
        name: 'APIResponseError',
        code: 'notionhq_client_response_error',
        status: 400,
      },
      attemptNumber: 1,
      retriesLeft: 3,
    };

    const result = isRetryableError(error);

    expect(result).toBe(false);
  });

  it('treats a 429 response as retryable', () => {
    const error = { code: 'notionhq_client_response_error', status: 429 };

    const result = isRetryableError(error);

    expect(result).toBe(true);
  });

  it('treats the rate_limited code as retryable', () => {
    const error = { code: 'rate_limited' };

    const result = isRetryableError(error);

    expect(result).toBe(true);
  });

  it('treats a 429 wrapped in the p-retry error property as retryable', () => {
    const error = {
      error: {
        name: 'RateLimitedError',
        code: 'rate_limited',
        status: 429,
      },
      attemptNumber: 1,
      retriesLeft: 3,
    };

    const result = isRetryableError(error);

    expect(result).toBe(true);
  });
});
