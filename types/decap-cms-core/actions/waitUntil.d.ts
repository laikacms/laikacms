import type { WaitActionArgs } from '../redux/middleware/waitUntilAction';
import type { ThunkDispatch } from 'redux-thunk';
import type { AnyAction } from 'redux';
import type { State } from '../types/redux';
export declare function waitUntil({ predicate, run }: WaitActionArgs): {
    type: string;
    predicate: (action: AnyAction) => boolean;
    run: (dispatch: ThunkDispatch, getState: () => State, action: AnyAction) => void;
};
export declare function waitUntilWithTimeout<T>(dispatch: ThunkDispatch<State, ThunkContext, AnyAction>, waitActionArgs: (resolve: (value?: T) => void) => WaitActionArgs, timeout?: number): Promise<T | null | void>;
