import * as allIcons from '@radix-ui/react-icons';
import type { CmsWidgetPreviewProps } from 'decap-cms-core';
import React from 'react';

export const IconPreview: React.FC<CmsWidgetPreviewProps> = ({ value }) => {
  if (!value) return null;

  const SelectedIcon = allIcons[value as keyof typeof allIcons] || undefined;

  return (
    <div style={{ fontSize: '2em' }}>
      {SelectedIcon && React.createElement(SelectedIcon)}
    </div>
  );
};
