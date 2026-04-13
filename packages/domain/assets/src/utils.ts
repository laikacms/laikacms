import type { AssetVariation } from './domain';

interface BuildUrlOptions {
  width?: number;
  height?: number;
}

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1024;

export const buildUrl = (variations: AssetVariation[], options: BuildUrlOptions): string | undefined => {
  const vars = variations.map(variation => ({ variation, score: variationScore(variation, options) }))
    .sort((a, b) => {
      // Sort by major score first, then by pixel oversize, then by pixel undersize
      if (b.score.major !== a.score.major) {
        return b.score.major - a.score.major;
      }
      if (a.score.pixelOversize !== b.score.pixelOversize) {
        return a.score.pixelOversize - b.score.pixelOversize;
      }
      return a.score.pixelUndersize - b.score.pixelUndersize;
    });
  return vars.length > 0
    ? vars[0].variation.url
      .replaceAll('{width}', (options.width || DEFAULT_WIDTH).toString())
      .replaceAll('{height}', (options.height || DEFAULT_HEIGHT).toString())
    : undefined;
};

export function variationScore(
  variation: AssetVariation,
  options: BuildUrlOptions,
): { major: number, pixelOversize: number, pixelUndersize: number } {
  let major = 0;
  let pixelOversize = 0;
  let pixelUndersize = 0;

  if (options.width && variation.url.includes('{width}')) {
    major++;
  } else if (options.width && variation.width) {
    if (variation.width >= options.width) {
      pixelOversize += variation.width - options.width;
    } else if (options.width < variation.width) {
      pixelUndersize += options.width - variation.width;
    }
  } else if (!options.width && variation.url.includes('{width}')) {
    // We need to infer width when we don't know it, so this is a negative signal
    major--;
  }
  if (options.height && variation.url.includes('{height}')) {
    major++;
  } else if (options.height && variation.height) {
    if (variation.height >= options.height) {
      pixelOversize += variation.height - options.height;
    } else if (options.height < variation.height) {
      pixelUndersize += options.height - variation.height;
    }
  } else if (!options.height && variation.url.includes('{height}')) {
    // We need to infer height when we don't know it, so this is a negative signal
    major--;
  }

  return { major, pixelOversize, pixelUndersize };
}
