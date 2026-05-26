import type * as Arr from 'effect/Array';
import * as Cause from 'effect/Cause';
import * as Channel from 'effect/Channel';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Pull from 'effect/Pull';
import * as Queue from 'effect/Queue';
import * as Result from 'effect/Result';
import type * as Scope from 'effect/Scope';

import type { LaikaError } from 'laikacms/core';

import * as Element from './laika-element.js';
import type { LaikaElement } from './laika-element.js';
import { attachAsyncIterator } from './laika-iterator.js';
import type { LaikaDone, LaikaProgress } from './laika-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Non-empty chunks of elements emitted by a {@link LaikaStream}. */
export type LaikaChunk<A> = Arr.NonEmptyReadonlyArray<LaikaElement<A>>;

/**
 * `LaikaStream<A, D, R>` — three logical channels in one construct:
 *
 *   • data       — many `A` values
 *   • metadata   — many progress events + recoverable errors, interleaved
 *   • done       — exactly ONE typed value at the end (Channel's OutDone), the
 *                  stream's closing return value
 *
 * Fatal errors are `LaikaError` raised through the Channel's OutErr; they
 * terminate the stream without emitting a done value.
 */
export interface LaikaStream<A, D extends LaikaDone = LaikaDone, R = never>
  extends Channel.Channel<LaikaChunk<A>, LaikaError, D, unknown, unknown, unknown, R>, AsyncIterable<LaikaChunk<A>, D>
{}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

/** Emits no data, ends immediately with the done value. */
export const empty = <D extends LaikaDone>(done: D): LaikaStream<never, D> =>
  attachAsyncIterator(Channel.end(done) as never);

/** Emits one data element then ends with the done value. */
export const succeed = <A, D extends LaikaDone>(value: A, done: D): LaikaStream<A, D> =>
  attachAsyncIterator(
    Channel.concat(
      Channel.succeed([Element.data(value)] as LaikaChunk<A>),
      Channel.end(done),
    ) as never,
  );

/**
 * Emits the given data elements (in one chunk) then ends with the done value.
 * An empty `values` array produces no chunks, just the done value.
 */
export const succeedMany = <A, D extends LaikaDone>(
  values: ReadonlyArray<A>,
  done: D,
): LaikaStream<A, D> => {
  if (values.length === 0) return empty(done);
  return attachAsyncIterator(
    Channel.concat(
      Channel.succeed(values.map(Element.data) as unknown as LaikaChunk<A>),
      Channel.end(done),
    ) as never,
  );
};

/** Fails immediately with a fatal LaikaError, never emitting a done value. */
export const fail = (error: LaikaError): LaikaStream<never, never> => attachAsyncIterator(Channel.fail(error) as never);

/**
 * Lift an Effect producing a single value, optional warnings, and a done value
 * into a LaikaStream.
 */
export const fromEffect = <A, D extends LaikaDone, R = never>(
  eff: Effect.Effect<
    {
      readonly value: A,
      readonly done: D,
      readonly recoverableErrors?: ReadonlyArray<LaikaError>,
    },
    LaikaError,
    R
  >,
): LaikaStream<A, D, R> =>
  make<A, D, R>(emit =>
    Effect.gen(function*() {
      const { value, done, recoverableErrors } = yield* eff;
      if (recoverableErrors) {
        for (const e of recoverableErrors) yield* emit.recoverableError(e);
      }
      yield* emit.data(value);
      return done;
    })
  );

/**
 * Emit-API exposed to a `make` builder. Each method offers one element into
 * the underlying queue and returns a void Effect.
 */
export interface LaikaStreamEmit<A> {
  readonly data: (value: A) => Effect.Effect<void>;
  readonly recoverableError: (error: LaikaError) => Effect.Effect<void>;
  readonly progress: (progress: LaikaProgress) => Effect.Effect<void>;
  readonly dataMany: (values: ReadonlyArray<A>) => Effect.Effect<void>;
}

/**
 * Generator-style builder for arbitrary LaikaStreams. The builder receives an
 * `emit` API and returns an Effect that resolves to the typed done value.
 *
 * The builder's Effect runs concurrently with the consumer: emissions land in
 * a bounded queue, the consumer pulls chunks as they're ready, and when the
 * builder completes the queue terminates with the done value as its Done leftover.
 */
export const make = <A, D extends LaikaDone, R = never>(
  build: (emit: LaikaStreamEmit<A>) => Effect.Effect<D, LaikaError, R>,
  options?: { readonly capacity?: number },
): LaikaStream<A, D, R> => {
  const capacity = options?.capacity ?? 16;
  return attachAsyncIterator(
    Channel.fromTransform<
      LaikaChunk<A>,
      LaikaError | Cause.Done<D>,
      D,
      unknown,
      unknown,
      unknown,
      never,
      R,
      R
    >((_upstream: unknown, scope: Scope.Scope) =>
      Effect.gen(function*() {
        const queue: Queue.Queue<LaikaElement<A>, LaikaError | Cause.Done<D>> = yield* Queue.bounded<
          LaikaElement<A>,
          LaikaError | Cause.Done<D>
        >(capacity);

        const emit: LaikaStreamEmit<A> = {
          data: value => Effect.asVoid(Queue.offer(queue, Element.data(value))),
          recoverableError: error => Effect.asVoid(Queue.offer(queue, Element.recoverableError(error))),
          progress: progress => Effect.asVoid(Queue.offer(queue, Element.progress(progress))),
          dataMany: values => Effect.asVoid(Queue.offerAll(queue, values.map(Element.data))),
        };

        const builder = build(emit).pipe(
          Effect.matchEffect({
            onSuccess: done => Queue.fail(queue, Cause.Done(done)),
            onFailure: error => Queue.fail(queue, error),
          }),
        );
        yield* Effect.forkIn(builder, scope);

        return Queue.takeAll(queue) as never;
      })
    ) as never,
  );
};

/**
 * Paginate through pages, flattening items into the LaikaStream's data channel.
 * The final done value is taken from the last page fetched ("last wins").
 */
export const paginate = <A, D extends LaikaDone, R = never>(
  initialCursor: string | undefined,
  fetchPage: (
    cursor: string | undefined,
  ) => Effect.Effect<
    {
      readonly items: ReadonlyArray<A>,
      readonly done: D,
      readonly nextCursor?: string,
    },
    LaikaError,
    R
  >,
): LaikaStream<A, D, R> =>
  make<A, D, R>(emit =>
    Effect.gen(function*() {
      let cursor = initialCursor;
      let pageNumber = 0;
      let finalDone: D | undefined;
      while (true) {
        yield* emit.progress({
          stage: 'paginate',
          current: pageNumber,
          message: cursor === undefined ? 'first page' : `cursor: ${cursor}`,
        });
        const page = yield* fetchPage(cursor);
        if (page.items.length > 0) yield* emit.dataMany(page.items);
        finalDone = page.done;
        pageNumber += 1;
        if (page.nextCursor === undefined) break;
        cursor = page.nextCursor;
      }
      return finalDone as D;
    })
  );

// ---------------------------------------------------------------------------
// Run helpers
// ---------------------------------------------------------------------------

/**
 * Drain a LaikaStream, invoking `onChunk` for every chunk, and return the
 * typed done value the stream terminates with.
 */
export const drainWithDone = <A, D extends LaikaDone, R>(
  self: LaikaStream<A, D, R>,
  onChunk: (chunk: LaikaChunk<A>) => Effect.Effect<void>,
): Effect.Effect<D, LaikaError, R> =>
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
          return leftover.success as D;
        }
        return yield* Effect.failCause(
          leftover.failure as Cause.Cause<LaikaError>,
        );
      }
    }),
  );

/** Collect a LaikaStream into its three buckets plus the done value. */
export const runCollect = <A, D extends LaikaDone, R>(
  self: LaikaStream<A, D, R>,
): Effect.Effect<
  {
    readonly data: ReadonlyArray<A>,
    readonly recoverableErrors: ReadonlyArray<LaikaError>,
    readonly progress: ReadonlyArray<LaikaProgress>,
    readonly done: D,
  },
  LaikaError,
  R
> => {
  const data: A[] = [];
  const recoverableErrors: LaikaError[] = [];
  const progress: LaikaProgress[] = [];
  return Effect.map(
    drainWithDone(self, chunk => {
      for (const el of chunk) {
        if (Element.isData(el)) data.push(el.value);
        else if (Element.isRecoverableError(el)) recoverableErrors.push(el.error);
        else progress.push(el.progress);
      }
      return Effect.void;
    }),
    done => ({ data, recoverableErrors, progress, done }),
  );
};

/** Drain a LaikaStream, ignoring all elements; return only the done value. */
export const runDone = <A, D extends LaikaDone, R>(
  self: LaikaStream<A, D, R>,
): Effect.Effect<D, LaikaError, R> => drainWithDone(self, () => Effect.void);

/**
 * Promise-shaped entry point for non-Effect consumers. Drops data and
 * metadata; resolves with the stream's done value or rejects with the fatal
 * `LaikaError`.
 */
export const runPromise = <A, D extends LaikaDone>(self: LaikaStream<A, D>): Promise<D> =>
  Effect.runPromise(runDone(self));

/**
 * Promise-shaped entry point that collects every channel into one bundle.
 * Resolves with `{ data, recoverableErrors, progress, done }`; rejects on
 * fatal `LaikaError`.
 */
export const runPromiseCollect = <A, D extends LaikaDone>(
  self: LaikaStream<A, D>,
): Promise<{
  readonly data: ReadonlyArray<A>,
  readonly recoverableErrors: ReadonlyArray<LaikaError>,
  readonly progress: ReadonlyArray<LaikaProgress>,
  readonly done: D,
}> => Effect.runPromise(runCollect(self));

/**
 * Promise-shaped entry point that captures fatal failures as a `LaikaResult`
 * instead of rejecting.
 */
export const runPromiseResult = <A, D extends LaikaDone>(
  self: LaikaStream<A, D>,
): Promise<
  Result.Result<
    {
      readonly data: ReadonlyArray<A>,
      readonly recoverableErrors: ReadonlyArray<LaikaError>,
      readonly progress: ReadonlyArray<LaikaProgress>,
      readonly done: D,
    },
    LaikaError
  >
> => Effect.runPromise(Effect.result(runCollect(self)));

/** Run a side-effect for every recoverable error. Returns the same stream shape. */
export const tapRecoverableErrors = <A, D extends LaikaDone, R, R2 = never>(
  self: LaikaStream<A, D, R>,
  f: (error: LaikaError) => Effect.Effect<void, never, R2>,
): LaikaStream<A, D, R | R2> =>
  Channel.tap(self, (chunk: LaikaChunk<A>) =>
    Effect.gen(function*() {
      for (const el of chunk) if (Element.isRecoverableError(el)) yield* f(el.error);
    })) as LaikaStream<A, D, R | R2>;

/** Run a side-effect for every progress event. Returns the same stream shape. */
export const tapProgress = <A, D extends LaikaDone, R, R2 = never>(
  self: LaikaStream<A, D, R>,
  f: (progress: LaikaProgress) => Effect.Effect<void, never, R2>,
): LaikaStream<A, D, R | R2> =>
  Channel.tap(self, (chunk: LaikaChunk<A>) =>
    Effect.gen(function*() {
      for (const el of chunk) if (Element.isProgress(el)) yield* f(el.progress);
    })) as LaikaStream<A, D, R | R2>;

// ---------------------------------------------------------------------------
// Combinators
// ---------------------------------------------------------------------------

/**
 * Transform every data value. Warnings, progress, and done value pass through
 * unchanged.
 */
export const mapData = <A, D extends LaikaDone, R, B>(
  self: LaikaStream<A, D, R>,
  f: (a: A) => B,
): LaikaStream<B, D, R> =>
  attachAsyncIterator(
    Channel.map(self, (chunk: LaikaChunk<A>): LaikaChunk<B> => {
      const out: LaikaElement<B>[] = new Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        const el = chunk[i]!;
        out[i] = Element.isData(el) ? Element.data(f(el.value)) : (el as LaikaElement<B>);
      }
      return out as unknown as LaikaChunk<B>;
    }) as never,
  );

/**
 * Transform every element regardless of tag. The mapping must preserve a
 * non-empty mapping per chunk, otherwise use {@link filter}.
 */
export const mapElements = <A, D extends LaikaDone, R, B>(
  self: LaikaStream<A, D, R>,
  f: (element: LaikaElement<A>) => LaikaElement<B>,
): LaikaStream<B, D, R> =>
  attachAsyncIterator(
    Channel.map(self, (chunk: LaikaChunk<A>): LaikaChunk<B> => {
      const out: LaikaElement<B>[] = new Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) out[i] = f(chunk[i]!);
      return out as unknown as LaikaChunk<B>;
    }) as never,
  );

/**
 * Filter on data only. Warnings and progress always pass through. Chunks that
 * would become empty after filtering are dropped entirely.
 */
export const filter = <A, D extends LaikaDone, R>(
  self: LaikaStream<A, D, R>,
  predicate: (a: A) => boolean,
): LaikaStream<A, D, R> =>
  attachAsyncIterator(
    Channel.filterArray(self, (el): el is LaikaElement<A> => {
      if (Element.isData(el)) return predicate(el.value);
      return true;
    }) as never,
  );

/** Transform the typed done value. */
export const mapDone = <A, D1 extends LaikaDone, D2 extends LaikaDone, R>(
  self: LaikaStream<A, D1, R>,
  f: (done: D1) => D2,
): LaikaStream<A, D2, R> => attachAsyncIterator(Channel.mapDone(self, f) as never);
