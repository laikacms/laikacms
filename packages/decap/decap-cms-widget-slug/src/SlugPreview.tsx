import type { CmsWidgetPreviewProps } from 'decap-cms-core';
import React from 'react';

export const SlugPreview: React.FC<CmsWidgetPreviewProps<string>> = ({ value }) => (
  <code style={{ fontFamily: 'monospace', backgroundColor: '#f5f5f5', padding: '2px 4px', borderRadius: 3 }}>
    {value || '(empty)'}
  </code>
);
