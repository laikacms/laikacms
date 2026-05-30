import type { CmsWidgetControlProps } from 'decap-cms-core';
import React, { useState } from 'react';

export type ColorControlProps = CmsWidgetControlProps<string>;

export const ColorControl: React.FC<ColorControlProps> = props => {
  const { value, forID, onChange, classNameWrapper, setActiveStyle, setInactiveStyle } = props;
  const [localHex, setLocalHex] = useState(value || '#000000');

  const handleColorChange = (hex: string) => {
    setLocalHex(hex);
    onChange(hex);
  };

  return (
    <div className={classNameWrapper} style={{ display: 'flex', alignItems: 'center', gap: '0.5em', padding: '8px' }}>
      <input
        id={forID}
        type="color"
        value={localHex}
        onChange={e =>
          handleColorChange(e.target.value)}
        onFocus={setActiveStyle}
        onBlur={setInactiveStyle}
        style={{ width: 40, height: 40, padding: 0, border: 'none', cursor: 'pointer', borderRadius: 4 }}
      />
      <input
        type="text"
        value={localHex}
        onChange={e => {
          const v = e.target.value;
          if (/^#[0-9a-fA-F]{0,6}$/.test(v)) {
            handleColorChange(v);
          }
        }}
        onFocus={setActiveStyle}
        onBlur={setInactiveStyle}
        style={{ flex: 1, padding: '4px 8px', fontFamily: 'monospace' }}
      />
    </div>
  );
};
