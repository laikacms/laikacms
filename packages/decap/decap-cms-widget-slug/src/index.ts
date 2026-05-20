import { SlugControl } from './SlugControl.js';
import { SlugPreview } from './SlugPreview.js';
import type { SlugWidgetOptions } from './types.js';

function Widget(opts: SlugWidgetOptions = {}) {
  return {
    name: 'slug',
    controlComponent: SlugControl,
    previewComponent: SlugPreview,
    ...opts,
  };
}

export const WidgetSlug = {
  name: 'slug',
  Widget,
  controlComponent: SlugControl,
  previewComponent: SlugPreview,
};

export default WidgetSlug;
