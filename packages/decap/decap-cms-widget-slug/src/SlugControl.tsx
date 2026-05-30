import type { CmsWidgetControlProps } from 'decap-cms-core';
import React, { useEffect, useRef, useState } from 'react';
import { toSlug } from './slug-utils.js';

export type SlugControlProps = CmsWidgetControlProps<string>;

export const SlugControl: React.FC<SlugControlProps> = props => {
  const anyProps = props as unknown as {
    value: string,
    forID: string,
    onChange: (value: string) => void,
    classNameWrapper: string,
    setActiveStyle: () => void,
    setInactiveStyle: () => void,
    field: { get: (key: string) => unknown },
    entry: { getIn: (path: string[]) => unknown },
  };
  const { value, forID, onChange, classNameWrapper, setActiveStyle, setInactiveStyle, field, entry } = anyProps;
  const [isManual, setIsManual] = useState(!!value);
  const prevSourceValue = useRef<string>('');

  const sourceField = (field?.get?.('source_field') as string | undefined) || 'title';

  // Auto-populate from source field when not in manual mode
  useEffect(() => {
    if (isManual) return;
    const sourceValue = String(entry?.getIn?.([sourceField]) ?? '');
    if (sourceValue && sourceValue !== prevSourceValue.current) {
      prevSourceValue.current = sourceValue;
      const slug = toSlug(sourceValue);
      onChange(slug);
    }
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsManual(true);
    const slugified = toSlug(e.target.value);
    onChange(slugified);
  };

  const handleReset = () => {
    setIsManual(false);
  };

  return (
    <div
      className={classNameWrapper}
      style={{ display: 'flex', alignItems: 'center', gap: '0.5em', padding: '4px 8px' }}
    >
      <input
        id={forID}
        type="text"
        value={value || ''}
        onChange={handleChange}
        onFocus={setActiveStyle}
        onBlur={setInactiveStyle}
        placeholder={`Auto-generated from "${sourceField}"`}
        style={{ flex: 1, padding: '4px 8px', fontFamily: 'monospace' }}
      />
      {isManual && (
        <button
          type="button"
          onClick={handleReset}
          title="Reset to auto-generated slug"
          style={{ fontSize: '0.75em', padding: '2px 6px', cursor: 'pointer' }}
        >
          Auto
        </button>
      )}
    </div>
  );
};
