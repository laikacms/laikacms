export interface ColorWidgetOptions {
  defaultColor?: string;
  allowAlpha?: boolean;
}

declare module 'decap-cms-core' {
  export interface CmsWidgetControlProps<T> {
    name: string;
    setActiveStyle: () => void;
    setInactiveStyle: () => void;
    t: (key: string, options?: Record<string, unknown>) => string;
    widget?: CmsWidget;
    value: T;
    forID: string;
    onChange: (value: T) => void;
  }
}
