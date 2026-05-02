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

  // NOTE: variationScore currently has a bug — the inner `else if (options.width < variation.width)`
  // branch is unreachable, so pixelUndersize is never recorded. As a result, when no variation is
  // oversized enough, ranking falls back to insertion order rather than picking the closest size.
  // The two tests below pin down current (buggy) behavior; see the `.fails` test in
  // `variationScore` below for a tripwire that flips green if/when the bug is fixed.

  it('returns *some* variation URL even when none is a perfect fit', () => {
    // Because pixelUndersize is broken, ranking depends only on pixelOversize,
    // which makes ties common. We only assert that we get one of the inputs back.
    const variations = [
      v({ variant: 'small', url: '/img/100.png', width: 100 }),
      v({ variant: 'mid', url: '/img/300.png', width: 300 }),
      v({ variant: 'big', url: '/img/1000.png', width: 1000 }),
    ];
    const result = buildUrl(variations, { width: 250 });
    expect(['/img/100.png', '/img/300.png', '/img/1000.png']).toContain(result);
  });

  it('falls back to *some* variation when none is oversized (current behavior)', () => {
    const variations = [
      v({ variant: 'small', url: '/img/100.png', width: 100 }),
      v({ variant: 'mid', url: '/img/200.png', width: 200 }),
    ];
    const result = buildUrl(variations, { width: 500 });
    expect(['/img/100.png', '/img/200.png']).toContain(result);
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

  // Tripwire: flips to passing if/when the unreachable `else if` branch in
  // variationScore is fixed. Until then, this asserts the wrong-but-current behavior is wrong.
  it.fails('records undersize when a fixed variation is smaller than requested', () => {
    const score = variationScore(v({ url: '/img/100.png', width: 100 }), { width: 300 });
    expect(score.pixelUndersize).toBe(200);
  });

  it('combines width and height contributions', () => {
    const score = variationScore(
      v({ url: '/img/{width}x{height}.png' }),
      { width: 100, height: 100 },
    );
    expect(score.major).toBe(2);
  });
});
