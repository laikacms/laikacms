import { type EditorComponentOptions } from 'decap-cms-core';
import React from 'react';

export interface EmbeddedEntryMetadata {
  title?: string;
  summary?: string;
  status?: 'draft' | 'published' | 'archived';
  lastModified?: string;
  contentType?: string;
  thumbnail?: string;
  author?: string;
  publishDate?: string;
  tags?: string[];
  category?: string;
  [key: string]: any;
}

export interface EmbeddedEntryData {
  collection: string;
  entry: string;
  display_fields?: string[];
  // Enhanced metadata for rich previews
  metadata?: EmbeddedEntryMetadata;
  // Display mode for the embedded entry
  displayMode?: 'inline' | 'card' | 'reference';
  // Fallback data for when entry is deleted/inaccessible
  fallback?: {
    title: string,
    reason: 'deleted' | 'inaccessible' | 'not_found',
  };
}

export interface EmbeddedEntryField {
  collection?: string;
  collections?: string[];
  value_field?: string;
  display_fields?: string[];
  search_fields?: string[];
  // Enhanced configuration options
  preview_fields?: string[];
  status_field?: string;
  content_type_field?: string;
  thumbnail_field?: string;
  default_display_mode?: 'inline' | 'card' | 'reference';
  show_status_indicators?: boolean;
  enable_rich_previews?: boolean;
  filters?: Array<{
    field: string,
    values: string[],
  }>;
}

const isEmbeddedEntryData = (data: any): data is EmbeddedEntryData => {
  return (
    data
    && typeof data === 'object'
    && typeof data.collection === 'string'
    && typeof data.entry === 'string'
  );
};

const embeddedEntry: EditorComponentOptions = {
  label: 'Embedded Entry',
  id: 'embedded-entry',
  fromBlock: (match: RegExpMatchArray | null) =>
    match && {
      collection: match[1],
      entry: match[2],
    },
  toBlock: ({ collection, entry }: EmbeddedEntryData) => `{{< embedded-entry "${collection}" "${entry}" >}}`,
  toPreview: (data: any) => {
    if (!isEmbeddedEntryData(data)) throw new Error('Invalid data for Embedded Entry component');
    const { collection, entry } = data;

    // In preview mode, show a placeholder with entry info
    return React.createElement('div', {
      style: {
        border: '2px dashed #ccc',
        padding: '16px',
        margin: '8px 0',
        borderRadius: '4px',
        backgroundColor: '#f9f9f9',
        textAlign: 'center' as const,
      },
    }, [
      React.createElement('strong', { key: 'label' }, 'Embedded Entry'),
      React.createElement('br', { key: 'br1' }),
      React.createElement('span', { key: 'collection' }, `Collection: ${collection}`),
      React.createElement('br', { key: 'br2' }),
      React.createElement('span', { key: 'entry' }, `Entry: ${entry}`),
    ]);
  },
  pattern: /^{{<\s*embedded-entry\s+"([^"]+)"\s+"([^"]+)"\s*>}}/,
  fields: [
    {
      name: 'relation',
      widget: 'relation',
      label: 'Select Entry',
    },
  ],
  allow_add: true,
};

export const DecapCmsEditorComponentEmbeddedEntry = embeddedEntry;
export default embeddedEntry;
