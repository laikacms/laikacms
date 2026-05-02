import { describe, expect, it } from 'vitest';
import type { AssetVariation } from './domain/index.js';
import { buildUrl, variationScore } from './utils.js';

const v = (overrides: Partial<AssetVariation> & { url: string }): AssetVariation => ({
  variant: overrides.variant ?? 'x',
  url: overrides.url,
  width: overrides.width,
  height: overrides.height,
  mimeType: overrides.mimeType,
  size: overrides.size,
});

describe('buildUrl', () => {
  it('returns undefined when there are no variations', () => {
    expect(buildUrl([], { width: 200 })).toBeUndefined();
  });

  it('returns the lone variation URL when only one is available', () => {
    const url = buildUrl([v({ url: '/assets/only.png', width: 100 })], { width: 100 });
    expect(url).toBe('/assets/only.png');
  });

  it('substitutes {width} and {height} template tokens', () => {
    const url = buildUrl(
      [v({ url: '/img/{width}x{height}.png' })],
      { width: 320, height: 240 },
    );
    expect(url).toBe('/img/320x240.png');
  });

  it('falls back to defaults (1024) when tokens are present but options omit dimensions', () => {
    const url = buildUrl([v({ url: '/img/{width}x{height}.png' })], {});
    expect(url).toBe('/img/1024x1024.png');
  });

  it('prefers a templated variation over a fixed-size one when width is requested', () => {
    const variations = [
      v({ variant: 'fixed', url: '/img/100.png', width: 100 }),
      v({ variant: 'tpl', url: '/img/{width}.png' }),
    ];
    expect(buildUrl(variations, { width: 200 })).toBe('/img/200.png');
  });

  it('prefers the smallest oversized variation when only oversized options exist', () => {
    const variations = [
      v({ variant: 'mid', url: '/img/300.png', width: 300 }),
      v({ variant: 'big', url: '/img/1000.png', width: 1000 }),
    ];
    // Both have undersize=0; lower oversize wins, so 300 beats 1000.
    expect(buildUrl(variations, { width: 250 })).toBe('/img/300.png');
  });

  it('falls back to the closest undersized variation when none is large enough', () => {
    const variations = [
      v({ variant: 'small', url: '/img/100.png', width: 100 }),
      v({ variant: 'mid', url: '/img/200.png', width: 200 }),
    ];
    expect(buildUrl(variations, { width: 500 })).toBe('/img/200.png');
  });
});

describe('variationScore', () => {
  it('rewards templated dimensions when the option is supplied', () => {
    const score = variationScore(v({ url: '/img/{width}.png' }), { width: 200 });
    expect(score.major).toBe(1);
  });

  it('penalises templated dimensions when the option is not supplied', () => {
    const score = variationScore(v({ url: '/img/{width}.png' }), {});
    expect(score.major).toBeLessThan(0);
  });

  it('records oversize when a fixed variation exceeds the requested width', () => {
    const score = variationScore(v({ url: '/img/300.png', width: 300 }), { width: 100 });
    expect(score.pixelOversize).toBe(200);
    expect(score.pixelUndersize).toBe(0);
  });

  it('records undersize when a fixed variation is smaller than requested', () => {
    const score = variationScore(v({ url: '/img/100.png', width: 100 }), { width: 300 });
    expect(score.pixelUndersize).toBe(200);
    expect(score.pixelOversize).toBe(0);
  });

  it('combines width and height contributions', () => {
    const score = variationScore(
      v({ url: '/img/{width}x{height}.png' }),
      { width: 100, height: 100 },
    );
    expect(score.major).toBe(2);
  });
});
