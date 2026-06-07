import * as Cause from 'effect/Cause';
import * as Channel from 'effect/Channel';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Pull from 'effect/Pull';
import * as Queue from 'effect/Queue';
import * as Result from 'effect/Result';
import type * as Scope from 'effect/Scope';

import type { LaikaError } from 'laikacms/core';

import { attachAsyncIterator } from './laika-iterator.js';
import type { LaikaMetadata, LaikaMetadataChunk, LaikaProgress } from './laika-types.js';

/**
 * `LaikaTask<A, R>` — a single-result sibling to {@link LaikaStream.LaikaStream}.
 *
 *   • metadata   — many progress events + recoverable errors, interleaved
 *   • result     — exactly ONE `A` at the end (Channel's OutDone) — the result
 *                  IS the data; no separate done value
 *
 * Fatal errors are `LaikaError` raised through the Channel's OutErr; they
 * terminate the task without yielding a value. Use LaikaTask for operations
 * that return one item (`getObject`, `createFolder`, etc.); use LaikaStream
 * for operations that return many.
 */
export interface LaikaTask<A, R = never>
  extends
    Channel.Channel<LaikaMetadataChunk, LaikaError, A, unknown, unknown, unknown, R>,
    AsyncIterable<LaikaMetadataChunk, A>
{}

const recoverableErrorTag = 'RecoverableError' as const;
const progressTag = 'Progress' as const;

const recoverableErrorMetadata = (error: LaikaError): LaikaMetadata => ({
  _tag: recoverableErrorTag,
  error,
});
const progressMetadata = (progress: LaikaProgress): LaikaMetadata => ({
  _tag: progressTag,
  progress,
});

/** Emits no metadata; immediately resolves to the value. */
export const succeed = <A>(value: A): LaikaTask<A> =>
  attachAsyncIterator(Channel.end(value)) as unknown as LaikaTask<A>;

/** Fails fatally without yielding a value. */
export const fail = (error: LaikaError): LaikaTask<never> =>
  attachAsyncIterator(Channel.fail(error)) as unknown as LaikaTask<never>;

/** Lift an Effect producing a value (and optional recoverable errors) into a LaikaTask. */
export const fromEffect = <A, R = never>(
  eff: Effect.Effect<
    { readonly value: A, readonly recoverableErrors?: ReadonlyArray<LaikaError> },
    LaikaError,
    R
  >,
): LaikaTask<A, R> =>
  make<A, R>(emit =>
    Effect.gen(function*() {
      const { value, recoverableErrors } = yield* eff;
      if (recoverableErrors) {
        for (const e of recoverableErrors) yield* emit.recoverableError(e);
      }
      return value;
    })
  );

/**
 * Structural shape shared by {@link LaikaTaskEmit} and `LaikaStreamEmit` for
 * the metadata channel (recoverable errors + progress). Helpers that forward
 * metadata between LaikaTask and LaikaStream accept this minimal interface
 * so either emit shape can be plugged in.
 */
export interface LaikaMetadataEmit {
  readonly recoverableError: (error: LaikaError) => Effect.Effect<void>;
  readonly progress: (progress: LaikaProgress) => Effect.Effect<void>;
}

/** Emit-API exposed to a `make` builder for tasks. Metadata events only. */
export type LaikaTaskEmit = LaikaMetadataEmit;

/**
 * Generator-style builder for arbitrary LaikaTasks. The builder receives a
 * metadata-only `emit` API and returns an Effect that resolves to the value
 * (which becomes the task's terminal return value).
 */
export const make = <A, R = never>(
  build: (emit: LaikaTaskEmit) => Effect.Effect<A, LaikaError, R>,
  options?: { readonly capacity?: number },
): LaikaTask<A, R> => {
  const capacity = options?.capacity ?? 16;
  return attachAsyncIterator(
    Channel.fromTransform<
      LaikaMetadataChunk,
      LaikaError | Cause.Done<A>,
      A,
      unknown,
      unknown,
      unknown,
      never,
      R,
      R
    >((_upstream: unknown, scope: Scope.Scope) =>
      Effect.gen(function*() {
        const queue: Queue.Queue<LaikaMetadata, LaikaError | Cause.Done<A>> = yield* Queue.bounded<
          LaikaMetadata,
          LaikaError | Cause.Done<A>
        >(capacity);

        const emit: LaikaTaskEmit = {
          recoverableError: error => Effect.asVoid(Queue.offer(queue, recoverableErrorMetadata(error))),
          progress: progress => Effect.asVoid(Queue.offer(queue, progressMetadata(progress))),
        };

        const builder = build(emit).pipe(
          Effect.matchEffect({
            onSuccess: value => Queue.fail(queue, Cause.Done(value)),
            onFailure: error => Queue.fail(queue, error),
          }),
        );
        yield* Effect.forkIn(builder, scope);

        return Queue.takeAll(queue) as never;
      })
    ),
  ) as unknown as LaikaTask<A, R>;
};

/**
 * Drain a LaikaTask collecting all recoverable errors and progress events, and
 * return the resolved value.
 *
 * When the caller is itself the body of a `LaikaTask.make` (i.e. it's
 * forwarding through a delegation chain), prefer {@link runValueForwarding}
 * — it pipes the inner task's warnings into the outer task's `emit` instead
 * of leaving the caller to manually re-emit them.
 */
export const runCollect = <A, R>(
  self: LaikaTask<A, R>,
): Effect.Effect<
  {
    readonly recoverableErrors: ReadonlyArray<LaikaError>,
    readonly progress: ReadonlyArray<LaikaProgress>,
    readonly value: A,
  },
  LaikaError,
  R
> => {
  const recoverableErrors: LaikaError[] = [];
  const progress: LaikaProgress[] = [];
  return Effect.map(
    drainWithValue(self, chunk => {
      for (const el of chunk) {
        if (el._tag === recoverableErrorTag) recoverableErrors.push(el.error);
        else progress.push(el.progress);
      }
      return Effect.void;
    }),
    value => ({ recoverableErrors, progress, value }),
  );
};

/**
 * Drain a LaikaTask ignoring metadata; return only the resolved value.
 *
 * Use in non-delegation contexts (test code, top-level runners) where the
 * caller genuinely doesn't care about recoverable warnings or progress. When
 * the caller is itself a `LaikaTask.make` body delegating to another task,
 * use {@link runValueForwarding} instead — otherwise the inner task's
 * recoverable warnings die at the delegation boundary.
 */
export const runValue = <A, R>(self: LaikaTask<A, R>): Effect.Effect<A, LaikaError, R> =>
  drainWithValue(self, () => Effect.void);

/**
 * Drain a child LaikaTask, forwarding every recoverableError and progress
 * event to the given outer `emit`, and return the resolved value. Use this
 * when a higher-level repository delegates to a lower-level one and wants
 * the inner repo's warnings to flow through its own outer task — otherwise
 * the lower-level's recoverableErrors die at the boundary because
 * {@link runValue} discards metadata.
 */
export const runValueForwarding = <A, R>(
  self: LaikaTask<A, R>,
  emit: LaikaMetadataEmit,
): Effect.Effect<A, LaikaError, R> =>
  drainWithValue(self, chunk =>
    Effect.gen(function*() {
      for (const el of chunk) {
        if (el._tag === recoverableErrorTag) yield* emit.recoverableError(el.error);
        else yield* emit.progress(el.progress);
      }
    }));

/**
 * Promise-shaped entry point for non-Effect consumers. Drops metadata; the
 * returned Promise resolves with the value or rejects with the fatal
 * `LaikaError` (no Effect runtime imports required at the call site).
 */
export const runPromise = <A>(self: LaikaTask<A>): Promise<A> => Effect.runPromise(runValue(self));

/**
 * Promise-shaped entry point that preserves recoverable metadata. Resolves
 * with `{ value, recoverableErrors, progress }`; rejects on fatal `LaikaError`.
 */
export const runPromiseCollect = <A>(
  self: LaikaTask<A>,
): Promise<{
  readonly value: A,
  readonly recoverableErrors: ReadonlyArray<LaikaError>,
  readonly progress: ReadonlyArray<LaikaProgress>,
}> => Effect.runPromise(runCollect(self));

/**
 * Promise-shaped entry point that captures fatal failures as a `LaikaResult`
 * instead of rejecting. Useful when the caller wants total recovery without
 * try/catch.
 */
export const runPromiseResult = <A>(
  self: LaikaTask<A>,
): Promise<Result.Result<A, LaikaError>> => Effect.runPromise(Effect.result(runValue(self)));

/**
 * Low-level: drain a LaikaTask invoking `onChunk` per chunk; return the
 * resolved value (Channel's OutDone).
 */
export const drainWithValue = <A, R>(
  self: LaikaTask<A, R>,
  onChunk: (chunk: LaikaMetadataChunk) => Effect.Effect<void>,
): Effect.Effect<A, LaikaError, R> =>
  Effect.scoped(
    Effect.gen(function*() {
      const pull = yield* Channel.toPull(self);
      while (true) {
        const exit = yield* Effect.exit(pull);
        if (Exit.isSuccess(exit)) {
          yield* onChunk(exit.value);
          continue;
        }
        const leftover = Pull.filterDoneLeftover(exit.cause);
        if (Result.isSuccess(leftover)) {
          return leftover.success as A;
        }
        return yield* Effect.failCause(
          leftover.failure as Cause.Cause<LaikaError>,
        );
      }
    }),
  );

/** Transform the resolved value (Channel's OutDone). */
export const map = <A, B, R>(
  self: LaikaTask<A, R>,
  f: (a: A) => B,
): LaikaTask<B, R> => attachAsyncIterator(Channel.mapDone(self, f)) as unknown as LaikaTask<B, R>;

/** Run a side-effect for every recoverable error. Returns the same task shape. */
export const tapRecoverableErrors = <A, R, R2 = never>(
  self: LaikaTask<A, R>,
  f: (error: LaikaError) => Effect.Effect<void, never, R2>,
): LaikaTask<A, R | R2> =>
  attachAsyncIterator(
    Channel.tap(self, (chunk: LaikaMetadataChunk) =>
      Effect.gen(function*() {
        for (const el of chunk) if (el._tag === recoverableErrorTag) yield* f(el.error);
      })),
  ) as unknown as LaikaTask<A, R | R2>;

/** Run a side-effect for every progress event. Returns the same task shape. */
export const tapProgress = <A, R, R2 = never>(
  self: LaikaTask<A, R>,
  f: (progress: LaikaProgress) => Effect.Effect<void, never, R2>,
): LaikaTask<A, R | R2> =>
  attachAsyncIterator(
    Channel.tap(self, (chunk: LaikaMetadataChunk) =>
      Effect.gen(function*() {
        for (const el of chunk) if (el._tag === progressTag) yield* f(el.progress);
      })),
  ) as unknown as LaikaTask<A, R | R2>;
