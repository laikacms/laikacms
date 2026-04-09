import { css } from '@emotion/css';
import { CmsWidgetControlProps } from 'decap-cms-core';
import { colors, shadows } from 'decap-cms-ui-default';
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import * as lucideReact from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

const allIcons = Object.fromEntries(Object.entries(lucideReact.icons));

export type IconControlProps = CmsWidgetControlProps<string>;

export const IconControl: React.FC<IconControlProps> = props => {
  const [isFocussed, setIsFocussed] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const {
    value,
    forID,
    classNameWrapper,
    setActiveStyle,
    setInactiveStyle,
    t,
  } = props;

  const [search, setSearch] = React.useState('');

  const filteredIcons = useMemo(() => {
    return Object.keys(allIcons).filter(icon => icon.toLowerCase().includes(search.toLowerCase()));
  }, [search]);

  const onFocus = () => {
    setIsFocussed(true);
    setIsOpen(true);
    setActiveStyle();
  };

  const onBlur = () => {
    setIsFocussed(false);
    setInactiveStyle();
  };

  return (
    <div
      className={classNameWrapper}
      style={{ padding: '0' }}
    >
      <div
        title={value}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5em',
          position: 'relative',
          backgroundColor: colors.textFieldBorder,
        }}
      >
        {value && allIcons[value]
          && React.createElement(allIcons[value as keyof typeof allIcons], {
            width: 24,
            height: 24,
            style: { margin: 8 },
          })}
        <button
          type="button"
          aria-label={t('editor.editorWidgets.datetime.clear')}
          onClick={() => setIsOpen(isOpen => !isOpen)}
          style={{
            background: 'none',
            border: 'none',
            padding: '4px',
            cursor: 'pointer',
            color: colors.text,
            borderRadius: '3px',
            margin: '8px 8px 8px auto',
          }}
          onMouseDown={e => e.preventDefault()}
        >
          {isOpen ? <ChevronUpIcon width={24} height={24} /> : <ChevronDownIcon width={24} height={24} />}
        </button>
      </div>
      {isOpen && (
        <div>
          <input
            id={forID}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('mediaLibrary.mediaLibraryModal.search')}
            type="search"
            onFocus={onFocus}
            onBlur={onBlur}
            autoComplete="off"
            style={{
              width: '100%',
              backgroundColor: colors.inputBackground,
              border: 'none',
              borderRadius: '3px',
              padding: '16px 20px',
              fontSize: '1em',
              outline: 'none',
            }}
          />
          <div
            className={css(shadows.inset)}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gridAutoRows: '46px',
              height: '300px',
              overflowY: 'auto',
              gap: '4px',
              padding: '8px',
              background: colors.textFieldBorder,
            }}
          >
            {filteredIcons.map(iconName => {
              console.log('rendering icon', iconName);
              return (
                <div
                  key={iconName}
                  title={iconName}
                  style={{
                    cursor: 'pointer',
                    backgroundColor: iconName === props.value ? colors.active : colors.inputBackground,
                    borderRadius: '3px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => props.onChange(iconName)}
                >
                  {allIcons[iconName]
                    && React.createElement(allIcons[iconName as keyof typeof allIcons], {
                      width: 24,
                      height: 24,
                      color: iconName === props.value ? colors.textLight : colors.text,
                    })}
                </div>
              );
            })}
            {filteredIcons.length === 0 && t('mediaLibrary.mediaLibraryModal.noResults')}
          </div>
        </div>
      )}
    </div>
  );
};
