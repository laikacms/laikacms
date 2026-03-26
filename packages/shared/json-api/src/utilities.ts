import z, { ZodError } from "zod";
import * as errors from "@laikacms/core"
import {
  ErrorCodeToStatusMap,
  InternalError,
  LaikaError,
  ServiceUnavailableError,
  ValidationError,
} from "@laikacms/core";
import { JsonApiError } from "./types.js";
import { jsonApiErrorZ } from "./schemas.js";
import * as Result from 'effect/Result';

export const errorToJsonApiMapper = (
  err: unknown
): JsonApiError & { status: errors.ErrorStatus } => {
  console.error('errorToJsonApiMapper():', err)

  const errorObj = typeof err === 'string' ? new errors.UnknownError() /* explicitly do not show a message since we dont know if the message is internal or not */ : err

  if (err instanceof ZodError) {
    return {
      errors: err.issues.map(zodIssueFormatter),
      status: ValidationError.STATUS,
    };
  }

  if (err instanceof LaikaError) {
    return {
      errors: [
        {
          title: err.title,
          code: err.code,
          status: "" + err.status,
          detail: err.message,
        },
      ],
      status: err.status,
    };
  }

  // Handle IErrorResult objects (from Result<T> failure cases)
  if (Result.isResult(err) && Result.isFailure(err)) {
    return errorToJsonApiMapper(err.failure);
  }

  // Handle AWS SDK errors
  if (typeof errorObj === 'object' && errorObj !== null && ("name" in errorObj && errorObj.name === "NetworkingError" || "name" in errorObj && errorObj.name === "TimeoutError")) {
    return {
      errors: [
        {
          status: "" + ServiceUnavailableError.STATUS,
          code: ServiceUnavailableError.CODE,
          title: ServiceUnavailableError.TITLE,
          detail: `Cannot connect to a required service.`,
        },
      ],
      status: ServiceUnavailableError.STATUS,
    };
  }

  // Return JSON error response
  return {
    errors: [
      {
        status: "" + InternalError.STATUS,
        code: InternalError.CODE,
        title: InternalError.TITLE,
        detail: "Internal Server Error",
      },
    ],
    status: InternalError.STATUS,
  };
};

/**
 * Convert a Zod error to a JSON:API error response
 *
 * @param error - The Zod error to convert
 * @param status - HTTP status code (default: '400')
 * @returns JSON:API error object
 */
export function zodIssueFormatter(
  issue: z.core.$ZodIssue,
): JsonApiError['errors'][number] {
  const pointer = issue.path.length > 0
    ? '/' + issue.path.map(p => String(p)).join('/')
    : undefined;

  return {
    status: '400',
    title: 'Validation Error',
    code: 'validation_' + issue.code,
    detail: issue.message,
    source: pointer ? { pointer } : undefined,
  };
}

export const errorFromResponse = async (response: Response) => {
  let isJson = response.headers.get("Content-Type")?.includes("application/json");
  let error: JsonApiError['errors'][number] | undefined
  let detail: string | undefined;

  if (response.ok) {
    throw new errors.IllegalStateException("errorFromResponse called with ok response");
  }

  if (isJson) {
    try {
      const json = await response.json();
      const parseResult = jsonApiErrorZ.safeParse(json);
      if (parseResult.success) error = parseResult.data.errors[0];
      else {
        isJson = false;
        if (typeof json.error === 'string') detail = json.error;
        if (typeof json.message === 'string') detail = json.message;
        if (typeof json.detail === 'string') detail = json.detail;
      }
    } catch {
      isJson = false;
    }
  }

  if (!isJson || !error) {
    switch(response.status) {
      case 400:
        return new errors.NotFoundError(detail);
      case 401:
        return new errors.AuthorizationError(detail);
      case 403:
        return new errors.ForbiddenError(detail);
      case 404:
        return new errors.NotFoundError(detail);
      case 409:
        return new errors.ConflictError(detail);
      case 429:
        return new errors.TooManyRequestsError(detail);
      case 500:
        return new errors.InternalError(detail);
      case 503:
        return new errors.ServiceUnavailableError(detail);
      case 504:
        return new errors.GatewayTimeoutError(detail);
      default:
        return new errors.UnknownError(detail ?? response.statusText);
    }
  }

  const ErrorMap = {
    ...errors,
    LaikaError: undefined
  }

  const allFuncs = Object.values(ErrorMap).filter(cls => typeof cls === 'function');
  const ErrorClassesWIthCode = allFuncs.filter((cls) => 'CODE' in cls);
  const CorrectError = ErrorClassesWIthCode.find(cls => cls.CODE === error.code);

  if (!CorrectError) {
    return new errors.UnknownError(error.detail);
  }

  if (CorrectError === LaikaError) {
    return new errors.UnknownError(error.detail);
  }

  return new CorrectError(error.detail);
}

export const isLaikaError = (error: unknown): error is LaikaError<errors.ErrorCode, number> => {
  return error instanceof LaikaError;
}

export const toUserErrorMessage = (error: unknown): string => {
  if (isLaikaError(error)) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  // fallback
  if (error !== null && typeof error === 'object') {
    if ('message' in error) return '' + error.message;
    if ('detail' in error) return '' + error.detail;
    if ('error' in error) return '' + error.error;
  }

  return 'An unknown error occurred';
}
