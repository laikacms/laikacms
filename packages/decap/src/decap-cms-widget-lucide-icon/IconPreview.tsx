import * as lucideReact from 'lucide-react';
import React from 'react';

const allIcons = Object.fromEntries(Object.entries(lucideReact.icons));

// v4.beta dropped the exported `CmsWidgetPreviewProps`; the preview only needs
// the resolved value. See PLAN S-05.
export interface IconPreviewProps {
  value?: string;
}

export const IconPreview: React.FC<IconPreviewProps> = ({ value }) => {
  if (!value) return null;

  const SelectedIcon = allIcons[value as keyof typeof allIcons] || undefined;

  return (
    <div style={{ fontSize: '2em' }}>
      {SelectedIcon && React.createElement(SelectedIcon)}
    </div>
  );
};
