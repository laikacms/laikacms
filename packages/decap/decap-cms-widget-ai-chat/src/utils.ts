import type { DRAFT_CHANGE_FIELD } from 'decap-cms-core/actions/entries';
import { List, Map } from 'immutable';

export function changeDraftField({
  field,
  value,
  metadata,
  entries,
  i18n,
}: {
  field: Map<string, any>,
  value: string,
  metadata: Record<string, unknown>,
  entries: Map<string, any>[],
  i18n?:
    | {
      currentLocale: string,
      defaultLocale: string,
      locales: string[],
    }
    | undefined
    | {},
}) {
  return {
    type: 'DRAFT_CHANGE_FIELD' as typeof DRAFT_CHANGE_FIELD,
    payload: { field, value, metadata, entries, i18n },
  };
}

export const I18N = 'i18n';

export enum I18N_STRUCTURE {
  MULTIPLE_FOLDERS = 'multiple_folders',
  MULTIPLE_FILES = 'multiple_files',
  SINGLE_FILE = 'single_file',
}

export enum I18N_FIELD {
  TRANSLATE = 'translate',
  DUPLICATE = 'duplicate',
  NONE = 'none',
}

export function hasI18n(collection: Map<string, any>) {
  return collection.has(I18N);
}

export type I18nInfo = {
  locales: string[],
  defaultLocale: string,
  structure: I18N_STRUCTURE,
};

export function getI18nInfo(collection: Map<string, any>): I18nInfo | Record<string, any> {
  if (!hasI18n(collection)) {
    return {};
  }
  const { structure, locales, default_locale: defaultLocale } = collection.get(I18N).toJS();
  return { structure, locales, defaultLocale } as I18nInfo;
}

export const FILES = 'file_based_collection';
export const FOLDER = 'folder_based_collection';

const selectors = {
  [FOLDER]: {
    fields(collection: Map<string, any>) {
      return collection.get('fields');
    },
  },
  [FILES]: {
    fileForEntry(collection: Map<string, any>, slug: string) {
      const files = collection.get('files') as List<Map<string, any>> | undefined;
      return files && files.filter(f => f?.get('name') === slug).get(0);
    },
    fields(collection: Map<string, any>, slug: string) {
      const file = this.fileForEntry(collection, slug);
      return file && file.get('fields');
    },
  },
};

export function selectFields(collection: Map<string, any>, slug: string) {
  const type = collection.get('type') as typeof FILES | typeof FOLDER;
  return selectors[type].fields(collection, slug);
}
