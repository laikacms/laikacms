/**
 * Stub for the shadcn-editor demo site's `useBlockViewer` hook.
 *
 * In the upstream demo this lets users toggle which toolbar / footer / plugin
 * pieces are mounted by reading boolean flags off keyed records. The Decap
 * widget enables everything, so we return Proxy objects whose every property
 * access returns `true`.
 */
type AllTrueRecord = Record<string, boolean>;

const ALL_ENABLED: AllTrueRecord = new Proxy(
  {},
  { get: () => true },
) as AllTrueRecord;

export function useBlockViewer(): {
  view: 'preview' | 'code',
  setView: (view: 'preview' | 'code') => void,
  isLoading: boolean,
  toolbarItems: AllTrueRecord,
  footerItems: AllTrueRecord,
  pluginItems: AllTrueRecord,
  blockFormatItems: AllTrueRecord,
  blockInsertItems: AllTrueRecord,
  componentPickerItems: AllTrueRecord,
} {
  return {
    view: 'preview',
    setView: () => {
      /* no-op */
    },
    isLoading: false,
    toolbarItems: ALL_ENABLED,
    footerItems: ALL_ENABLED,
    pluginItems: ALL_ENABLED,
    blockFormatItems: ALL_ENABLED,
    blockInsertItems: ALL_ENABLED,
    componentPickerItems: ALL_ENABLED,
  };
}
