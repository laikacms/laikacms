import { ChevronDownIcon, ChevronUpIcon } from '@radix-ui/react-icons';
import type { IconProps } from '@radix-ui/react-icons/dist/types';
import { CmsWidgetControlProps } from 'decap-cms-core';
import { colors, shadows } from 'decap-cms-ui-default';
import React, { useEffect, useMemo, useState } from 'react';

export type IconControlProps = CmsWidgetControlProps<string>;

export const IconControl: React.FC<IconControlProps> = props => {
  const [isFocussed, setIsFocussed] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const [allIcons, setAllIcons] = useState(
    {} as Record<string, React.ForwardRefExoticComponent<IconProps & React.RefAttributes<SVGSVGElement>>>,
  );

  useEffect(() => {
    import('@radix-ui/react-icons').then(module => {
      const icons = Object.fromEntries(Object.entries(module).filter(([key]) => key.endsWith('Icon')));
      setAllIcons(
        icons as Record<string, React.ForwardRefExoticComponent<IconProps & React.RefAttributes<SVGSVGElement>>>,
      );
    });
  }, []);

  const {
    value,
    forID,
    classNameWrapper,
    setActiveStyle,
    setInactiveStyle,
    t,
  } = props;

  const [search, setSearch] = React.useState('');

  const icons = useMemo(() => {
    return Object.keys(allIcons).filter(iconName => iconName.toLowerCase().includes(search.toLowerCase()));
  }, [search, allIcons]);

  const onFocus = () => {
    setIsFocussed(true);
    setIsOpen(true);
    setActiveStyle();
  };

  const onBlur = () => {
    setIsFocussed(false);
    setInactiveStyle();
  };

  const SelectedIcon = allIcons[props.value as keyof typeof allIcons] || undefined;

  const isValid = () => {
    const required = props.field?.get('required') ?? true;
    if (required && !props.value) {
      return {
        error: { message: props.t('editor.editorWidgets.required') },
      };
    }
    return true;
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
        {SelectedIcon && (
          <SelectedIcon
            width={24}
            height={24}
            color={colors.text}
            style={{ margin: '8px 0 8px 8px' }}
          />
        )}
        <button
          type="button"
          aria-label={t('editor.editorWidgets.datetime.clear')}
          onClick={() => setIsOpen(isOpen => !isOpen)}
          className={shadows.inset}
          style={{
            boxShadow: shadows.inset,
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
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gridAutoRows: '46px',
              height: '300px',
              overflowY: 'auto',
              gap: '4px',
              fontSize: '1.2em',
              padding: '8px',
              background: colors.textFieldBorder,
            }}
          >
            {icons.map(iconName => {
              const Icon = allIcons[iconName as keyof typeof allIcons];
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
                  <Icon width={24} height={24} color={iconName === props.value ? colors.textLight : colors.text} />
                </div>
              );
            })}
            {icons.length === 0 && t('mediaLibrary.mediaLibraryModal.noResults')}
          </div>
        </div>
      )}
    </div>
  );
};
