import type * as Arr from 'effect/Array';
import * as Cause from 'effect/Cause';
import * as Channel from 'effect/Channel';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Pull from 'effect/Pull';
import * as Result from 'effect/Result';
import * as Scope from 'effect/Scope';

import { LaikaError, UnknownError } from 'laikacms/core';

/**
 * Mutate a Channel instance so it ALSO satisfies AsyncIterable.
 *
 * The iterator yields non-empty chunks of `Elem`; its terminal `return` value
 * carries the Channel's typed OutDone. Used by both {@link LaikaStream.LaikaStream}
 * and {@link LaikaTask.LaikaTask}.
 *
 * Fatal LaikaError surfaces as a thrown error from the `for await` block.
 * Non-LaikaError defects are wrapped in UnknownError so the contract
 * "thrown things are LaikaError" always holds.
 *
 * Auto-attach always, even if R != never. When a channel has unfilled service
 * requirements, iteration throws at first `next()`. Repositories instantiate
 * services at construction time, so method return types are R = never in practice.
 */
export const attachAsyncIterator = <C>(channel: C): C => {
  type AnyChannel = Channel.Channel<
    Arr.NonEmptyReadonlyArray<unknown>,
    LaikaError,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown
  >;
  const c = channel as unknown as AnyChannel;
  return attachAsyncIteratorInternal(c) as unknown as C;
};

const attachAsyncIteratorInternal = <Elem, Done, R>(
  channel: Channel.Channel<
    Arr.NonEmptyReadonlyArray<Elem>,
    LaikaError,
    Done,
    unknown,
    unknown,
    unknown,
    R
  >,
): typeof channel => {
  Object.defineProperty(channel, Symbol.asyncIterator, {
    value: (): AsyncIterator<Arr.NonEmptyReadonlyArray<Elem>, Done> => {
      const services = Context.empty() as Context.Context<R>;
      let scope: Scope.Closeable | undefined;
      let pull:
        | Effect.Effect<Arr.NonEmptyReadonlyArray<Elem>, LaikaError | Cause.Done<Done>, R>
        | undefined;
      let closed = false;

      const ensureScope = async (): Promise<Scope.Closeable> => {
        if (scope) return scope;
        scope = await Effect.runPromise(
          Effect.provideContext(Scope.make(), services),
        );
        return scope;
      };

      const ensurePull = async (): Promise<
        Effect.Effect<Arr.NonEmptyReadonlyArray<Elem>, LaikaError | Cause.Done<Done>, R>
      > => {
        if (pull) return pull;
        const s = await ensureScope();
        pull = await Effect.runPromise(
          Effect.provideContext(Channel.toPullScoped(channel, s), services),
        );
        return pull;
      };

      const closeScope = async (exit: Exit.Exit<unknown, unknown>): Promise<void> => {
        if (!scope) return;
        const s = scope;
        scope = undefined;
        try {
          await Effect.runPromise(Effect.provideContext(Scope.close(s, exit), services));
        } catch {
          // finalisers should not throw; if they do, swallow — we're already cleaning up.
        }
      };

      const iterator: AsyncIterator<Arr.NonEmptyReadonlyArray<Elem>, Done> & {
        [Symbol.asyncIterator]?: () => AsyncIterator<Arr.NonEmptyReadonlyArray<Elem>, Done>,
      } = {
        async next(): Promise<IteratorResult<Arr.NonEmptyReadonlyArray<Elem>, Done>> {
          if (closed) return { value: undefined as never, done: true };
          let exit: Exit.Exit<Arr.NonEmptyReadonlyArray<Elem>, LaikaError | Cause.Done<Done>>;
          try {
            const p = await ensurePull();
            exit = await Effect.runPromiseExit(Effect.provideContext(p, services));
          } catch (err) {
            closed = true;
            await closeScope(Exit.succeed(undefined));
            if (err instanceof LaikaError) throw err;
            throw new UnknownError(messageOf(err), { cause: err });
          }
          if (Exit.isSuccess(exit)) {
            return { value: exit.value, done: false };
          }
          const leftover = Pull.filterDoneLeftover(exit.cause);
          if (Result.isSuccess(leftover)) {
            closed = true;
            await closeScope(Exit.succeed(undefined));
            return { value: leftover.success as Done, done: true };
          }
          closed = true;
          await closeScope(exit);
          const fatal = firstFailError(leftover.failure);
          if (fatal instanceof LaikaError) throw fatal;
          throw new UnknownError(messageOf(fatal), { cause: fatal });
        },

        async return(value?: Done): Promise<IteratorResult<Arr.NonEmptyReadonlyArray<Elem>, Done>> {
          if (!closed) {
            closed = true;
            await closeScope(Exit.succeed(undefined));
          }
          return { value: value as Done, done: true };
        },

        async throw(err?: unknown): Promise<IteratorResult<Arr.NonEmptyReadonlyArray<Elem>, Done>> {
          if (!closed) {
            closed = true;
            await closeScope(Exit.failCause(Cause.die(err)));
          }
          throw err;
        },
      };
      iterator[Symbol.asyncIterator] = () => iterator;
      return iterator;
    },
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return channel;
};

const messageOf = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'LaikaStream iteration failed';
};

const firstFailError = (cause: Cause.Cause<unknown>): unknown => {
  for (const reason of cause.reasons) {
    if (reason._tag === 'Fail') return (reason as { error: unknown }).error;
  }
  for (const reason of cause.reasons) {
    if (reason._tag === 'Die') return (reason as { defect: unknown }).defect;
  }
  return cause;
};
