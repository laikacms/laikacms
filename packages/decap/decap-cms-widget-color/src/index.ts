import { ColorControl } from './ColorControl';
import { ColorPreview } from './ColorPreview';
import type { ColorWidgetOptions } from './types';

function Widget(opts: ColorWidgetOptions = {}) {
  return {
    name: 'color',
    controlComponent: ColorControl,
    previewComponent: ColorPreview,
    ...opts,
  };
}

export const WidgetColor = {
  name: 'color',
  Widget,
  controlComponent: ColorControl,
  previewComponent: ColorPreview,
};

export default WidgetColor;
