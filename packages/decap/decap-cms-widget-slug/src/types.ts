export interface SlugWidgetOptions {
  source_field?: string; // field name to auto-derive slug from (e.g. 'title')
  locked?: boolean; // if true, don't allow manual editing
}

// Extend decap-cms-core types with props we use
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
    // field-related props Decap passes
    entry?: { getIn: (path: string[]) => unknown };
    fieldsMetaData?: unknown;
  }
}
