import type { CmsWidgetParam } from "decap-cms-core";
import { IconControl } from "./IconControl";
import { IconPreview } from "./IconPreview";
import { IconWidgetOptions } from "./types";

function Widget(opts: IconWidgetOptions = {}) {
  return {
    name: "icon",
    controlComponent: IconControl,
    previewComponent: IconPreview,
    ...opts,
  };
}

export const WidgetIcon = {
  name: "icon",
  Widget,
  controlComponent: IconControl,
  previewComponent: IconPreview,
};

export default WidgetIcon;
