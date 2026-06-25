import React from 'react';

import { IconControl } from './IconControl';
import { IconPreview } from './IconPreview';
import type { IconWidgetOptions } from './types';

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
