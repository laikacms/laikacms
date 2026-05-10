export interface IconWidgetOptions {
  collection?: string;
  filter?: RegExp;
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
