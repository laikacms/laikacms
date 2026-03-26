import * as React from "react";

/** Inline style objects used by the control component. */
export const wrapper: React.CSSProperties;
export const button: React.CSSProperties;

export interface ControlProps {
  field: {
    get: (key: string) => any;
  };
  forID?: string;
  value?: string;
  onChange: (value: string) => void;
  classNameWrapper?: string;
}

/**
 * React control component for generating and displaying a unique ID.
 */
export const Control: React.FC<ControlProps>

/**
 * The Decap CMS widget definition object.
 */
export const Widget: {
  /** Name used in `config.yml` */
  name: string;
  /** The control component for this widget */
  controlComponent: typeof Control;
};

export default Widget;