import { CmsWidgetPreviewProps } from 'decap-cms-core';
import * as lucideReact from 'lucide-react';
import React from 'react';

const allIcons = Object.fromEntries(Object.entries(lucideReact.icons));

export const IconPreview: React.FC<CmsWidgetPreviewProps> = ({ value }) => {
  if (!value) return null;

  const SelectedIcon = allIcons[value as keyof typeof allIcons] || undefined;

  return (
    <div style={{ fontSize: '2em' }}>
      {SelectedIcon && React.createElement(SelectedIcon)}
    </div>
  );
};
