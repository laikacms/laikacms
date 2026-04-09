import { ErrorClasses } from '@laikacms/core';
import type { JsonApiError } from './types.js';
import { errorToJsonApiMapper } from './utilities.js';

export const JsonApiErrors = Object.entries(ErrorClasses).reduce(
  (acc, [key, ErrorClass]) => {
    function createJsonApiErrorInstance(...args: ConstructorParameters<typeof ErrorClass>) {
      const errorInstance = new ErrorClass(...args);
      return errorToJsonApiMapper(errorInstance);
    }

    acc[key as keyof typeof ErrorClasses] = createJsonApiErrorInstance;
    return acc;
  },
  {} as {
    [K in keyof typeof ErrorClasses]: (...args: ConstructorParameters<typeof ErrorClasses[K]>) => JsonApiError;
  },
);
