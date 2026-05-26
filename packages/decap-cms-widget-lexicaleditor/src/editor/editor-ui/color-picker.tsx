/**
 * Stub for the full color-picker (the original is 1938 lines of custom HSL
 * picker UI). This minimal version preserves the same export surface so the
 * toolbar plugins compile; the real emotion-styled picker lands later.
 */
import * as React from 'react';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

interface ColorPickerStore {
  value: string;
  setValue: (value: string) => void;
}

const ColorPickerContext = createContext<ColorPickerStore | null>(null);

function useColorPickerStore(): ColorPickerStore {
  const store = useContext(ColorPickerContext);
  if (!store) throw new Error('useColorPicker must be used inside <ColorPicker>');
  return store;
}

interface RootProps {
  value?: string;
  defaultValue?: string;
  defaultFormat?: string;
  modal?: boolean;
  onValueChange?: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}

function ColorPickerRoot({ value, defaultValue = '#000000', onValueChange, children }: RootProps): ReactNode {
  const [internal, setInternal] = useState(defaultValue);
  const current = value ?? internal;
  const setValue = useCallback(
    (next: string) => {
      setInternal(next);
      onValueChange?.(next);
    },
    [onValueChange],
  );
  const store = useMemo(() => ({ value: current, setValue }), [current, setValue]);
  return <ColorPickerContext.Provider value={store}>{children}</ColorPickerContext.Provider>;
}

function passThrough({ children }: { children?: ReactNode }): ReactNode {
  return <>{children}</>;
}

function ColorPickerTrigger(props: { children?: ReactNode, asChild?: boolean }): ReactNode {
  return passThrough({ children: props.children });
}
function ColorPickerContent(props: { children?: ReactNode }): ReactNode {
  return passThrough(props);
}
function ColorPickerArea(): ReactNode {
  return null;
}
function ColorPickerHueSlider(): ReactNode {
  return null;
}
function ColorPickerAlphaSlider(): ReactNode {
  return null;
}
function ColorPickerSwatch(): ReactNode {
  return null;
}
function ColorPickerEyeDropper(): ReactNode {
  return null;
}
function ColorPickerFormatSelect(): ReactNode {
  return null;
}
function ColorPickerInput(): ReactNode {
  const { value, setValue } = useColorPickerStore();
  return <input type="color" value={value} onChange={event => setValue(event.target.value)} />;
}

export {
  ColorPickerAlphaSlider,
  ColorPickerAlphaSlider as AlphaSlider,
  ColorPickerArea,
  ColorPickerArea as Area,
  ColorPickerContent,
  ColorPickerContent as Content,
  ColorPickerEyeDropper,
  ColorPickerEyeDropper as EyeDropper,
  ColorPickerFormatSelect,
  ColorPickerFormatSelect as FormatSelect,
  ColorPickerHueSlider,
  ColorPickerHueSlider as HueSlider,
  ColorPickerInput,
  ColorPickerInput as Input,
  ColorPickerRoot as ColorPicker,
  ColorPickerRoot as Root,
  ColorPickerSwatch,
  ColorPickerSwatch as Swatch,
  ColorPickerTrigger,
  ColorPickerTrigger as Trigger,
  useColorPickerStore as useColorPicker,
};
