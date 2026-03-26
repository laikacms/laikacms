/**
 * A middleware that provides the ability for actions to install a
 * function to be run once when a specific condition is met by an
 * action coming through the system. Think of it as a thunk that
 * blocks until the condition is met.
 */
import type { Middleware, Dispatch, AnyAction } from 'redux';
import type { State } from '../../types/redux';
export declare const WAIT_UNTIL_ACTION = "WAIT_UNTIL_ACTION";
export interface WaitActionArgs {
    predicate: (action: AnyAction) => boolean;
    run: (dispatch: Dispatch, getState: () => State, action: AnyAction) => void;
}
export declare const waitUntilAction: Middleware<{}, State, Dispatch>;
