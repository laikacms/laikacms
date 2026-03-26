import type { MediaLibraryAction } from '../actions/mediaLibrary';
import type { State, DisplayURLState, EntryField } from '../types/redux';
declare function mediaLibrary(state: any, action: MediaLibraryAction): any;
export declare function selectMediaFiles(state: State, field?: EntryField): any;
export declare function selectMediaFileByPath(state: State, path: string): any;
export declare function selectMediaDisplayURL(state: State, id: string): DisplayURLState;
export default mediaLibrary;
