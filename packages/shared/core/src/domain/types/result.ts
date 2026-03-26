import { ZodError } from "zod";
import { ErrorCode, InternalError, LaikaError, ValidationError } from "../entities/errors.js";

export interface IErrorResult {
    messages: string[]
    success: false
    code: ErrorCode,

    orThrow(): never
    orUndefined(): undefined
    orDefault<T>(defaultData: T): T
}

export class ErrorResult implements IErrorResult {
    public readonly success = false;

    constructor(public messages: string[], public code: ErrorCode) {
    }

    public orThrow(): never {
        throw new Error(this.messages.join(', '));
    }
    public orUndefined(): undefined {
        return undefined;
    }
    public orDefault<T>(defaultData: T): T {
        return defaultData;
    }
    public static fromError<C extends ErrorCode = ErrorCode, S extends number = number>(result: LaikaError<C, S>) {
        return new ErrorResult([result.message], result.code)
    }
}

/**
 * @deprecated Use ErrorResult() instead
 */
export class ResultError {
    constructor(public errorResult: IErrorResult) {
    }
    public static fromResult(result: IErrorResult) {
        return new ResultError(result)
    }
    public static fromError(error: unknown) {
        if (error instanceof ResultError) return error;
        if (error instanceof ZodError) {
            return new ResultError({
                success: false,
                code: ValidationError.CODE,
                messages: [error.message],
                orThrow() { throw error; },
                orUndefined() { return undefined; },
                orDefault(defaultData) { return defaultData; }
            });
        }
        if (error instanceof Error) {
            return new ResultError({
                messages: [error.message],
                success: false,
                code: InternalError.CODE,
                orThrow() { throw error; },
                orUndefined() { return undefined; },
                orDefault(defaultData) { return defaultData; }
            })
        }
        else return new ResultError({
            messages: ['An unknown error occurred'],
            success: false,
            code: 'internal_error',
            orThrow() { throw error; },
            orUndefined() { return undefined; },
            orDefault(defaultData) { return defaultData; }
        })
    }
    public toResult(): IErrorResult {
        return this.errorResult;
    }
}

interface ISuccessResult<Data> {
    messages: string[]
    success: true,
    data: Data,

    orThrow(): Data
    orUndefined(): Data
    orDefault(defaultData: Data): Data
}

class SuccessResult<Data> implements ISuccessResult<Data> {
    public readonly success = true;

    constructor(public data: Data, public messages: string[] = []) {
    }

    public orThrow(): Data {
        return this.data;
    }
    public orUndefined(): Data {
        return this.data;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public orDefault(defaultData: Data): Data {
        return this.data;
    }
}

export const success = <Data>(data: Data, messages?: string[]): ISuccessResult<Data> => new SuccessResult(data, messages);

export const failure = (code: ErrorCode, messages?: string[]): IErrorResult => new ErrorResult(messages || ['An unknown error occurred'], code);

export type Result<Data> = IErrorResult | ISuccessResult<Data>

export type ExtractData<T> = T extends ISuccessResult<infer U> ? U : never;
export type ExtractFromPromise<T extends (...args: any) => any> = ExtractData<Awaited<ReturnType<T>>>;