import React from 'react';

import { IconControl } from './IconControl.js';
import { IconPreview } from './IconPreview.js';
import type { IconWidgetOptions } from './types.js';

function Widget(opts: IconWidgetOptions = {}) {
  return {
    name: 'icon',
    controlComponent: (props: React.ComponentProps<typeof IconControl>) =>
      React.createElement(IconControl, { ...props, filter: opts.filter }),
    previewComponent: IconPreview,
  };
}

export const WidgetIcon = {
  name: 'icon',
  Widget,
  controlComponent: IconControl,
  previewComponent: IconPreview,
};

export default WidgetIcon;
