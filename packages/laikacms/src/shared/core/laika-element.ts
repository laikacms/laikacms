import type { LaikaError } from 'laikacms/core';

import type { LaikaMetadata, LaikaProgress } from './laika-types.js';

/**
 * Elements carried in a {@link LaikaStream.LaikaStream}'s output channel:
 * metadata plus data values.
 */
export type LaikaElement<A> =
  | LaikaMetadata
  | { readonly _tag: 'Data', readonly value: A };

const dataTag = 'Data' as const;
const recoverableErrorTag = 'RecoverableError' as const;
const progressTag = 'Progress' as const;

export const data = <A>(value: A): LaikaElement<A> => ({ _tag: dataTag, value });

export const recoverableError = (error: LaikaError): LaikaElement<never> => ({
  _tag: recoverableErrorTag,
  error,
});

export const progress = (progress: LaikaProgress): LaikaElement<never> => ({
  _tag: progressTag,
  progress,
});

export const isData = <A>(
  el: LaikaElement<A>,
): el is { readonly _tag: 'Data', readonly value: A } => el._tag === dataTag;

export const isRecoverableError = <A>(
  el: LaikaElement<A>,
): el is { readonly _tag: 'RecoverableError', readonly error: LaikaError } => el._tag === recoverableErrorTag;

export const isProgress = <A>(
  el: LaikaElement<A>,
): el is { readonly _tag: 'Progress', readonly progress: LaikaProgress } => el._tag === progressTag;
