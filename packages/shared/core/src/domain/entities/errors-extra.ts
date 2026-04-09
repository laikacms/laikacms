import * as errors from './errors.js';
import type { ErrorKey } from './errors.js';
import { errorCode, errorStatus } from './errors.js';

type ReverseMap<T extends Record<PropertyKey, any>> = {
  [K in keyof T as T[K]]: K;
};

export const ErrorCodeToKeyMap: ReverseMap<typeof errorCode> = Object.fromEntries(
  Object.entries(errorCode).map(([key, code]) => [code, key]),
) as ReverseMap<typeof errorCode>;

export const ErrorCodeToStatusMap = Object.fromEntries(
  Object.entries(errorCode).map(([key, code]) => [code, errorStatus[key as ErrorKey]]),
) as { [K in keyof typeof errorCode as typeof errorCode[K]]: (typeof errorStatus)[K]; };

const ErrorMap = {
  ...errors,
  LaikaError: undefined,
};

export const ErrorClasses = Object.fromEntries(
  Object.entries(ErrorMap).filter(([key, cls]) => key !== 'LaikaError' && cls && 'CODE' in cls),
) as {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  [K in keyof typeof ErrorMap]: (typeof ErrorMap)[K] extends Function & { CODE: errors.ErrorCode }
    ? Extract<typeof ErrorMap[K], { CODE: errors.ErrorCode }>
    : never;
};

export type ErrorClassesType = typeof ErrorClasses;

const allExportsFromErrorCodeToValue = Object.fromEntries(
  Object.entries(ErrorClasses).map(([_key, cls]) => [cls.CODE, cls]),
) as { [P in keyof typeof ErrorClasses as (typeof ErrorClasses)[P]['CODE']]: (typeof ErrorClasses)[P]; };

export const ErrorCodeToClassMap = allExportsFromErrorCodeToValue;
