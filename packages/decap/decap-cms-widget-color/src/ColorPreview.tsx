import React from 'react';

export interface ColorPreviewProps {
  value: string;
}

export const ColorPreview: React.FC<ColorPreviewProps> = ({ value }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em' }}>
    <div
      style={{
        width: 24,
        height: 24,
        backgroundColor: value || '#000',
        border: '1px solid #ccc',
        borderRadius: 3,
        display: 'inline-block',
      }}
    />
    <span style={{ fontFamily: 'monospace' }}>{value}</span>
  </div>
);
