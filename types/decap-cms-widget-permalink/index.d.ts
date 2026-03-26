import * as React from "react";

export interface ControlProps {
  field: {
    get: (key: string, defaultValue?: any) => any;
  };
  forID?: string;
  value?: string;
  classNameWrapper?: string;
  onChange: (value: string) => void;
}

/**
 * Permalink control component for Decap CMS.
 * Allows editing and validating URL slugs with optional prefix handling.
 */
export const Control: React.FC<ControlProps>

/**
 * Widget registration object for Decap CMS.
 */
export const Widget: {
  /** Widget name used in `config.yml` */
  name: string;
  /** Control component to render in the CMS editor */
  controlComponent: typeof Control;
};

export default Widget;
