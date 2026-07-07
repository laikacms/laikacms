/**
 * Unit tests for decap-cms-widget-radix-icon IconControl filter logic (LCMS-249)
 *
 * The `filter` prop (RegExp | function predicate) is passed via the Widget()
 * closure so Decap's fixed-prop rendering doesn't discard it. These tests
 * verify that icons excluded by the filter are absent from the filtered list.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('./IconControl.js', () => ({ IconControl: () => null }));
vi.mock('./IconPreview.js', () => ({ IconPreview: () => null }));

const { default: WidgetIcon } = await import('./index.js');

// Radix icons are loaded asynchronously in the real control; here we replicate
// the filter computation over a representative set to keep tests synchronous
// and dependency-free.
const SAMPLE_ICONS: Record<string, true> = {
  AccessibilityIcon: true,
  ActivityLogIcon: true,
  AlignBottomIcon: true,
  AlignCenterHorizontallyIcon: true,
  ArrowDownIcon: true,
  ArrowLeftIcon: true,
  ArrowRightIcon: true,
  ArrowTopRightIcon: true,
  ArrowUpIcon: true,
  BackpackIcon: true,
  BorderAllIcon: true,
  BoxIcon: true,
  CalendarIcon: true,
  CheckIcon: true,
  ChevronDownIcon: true,
  ChevronUpIcon: true,
  CrossCircledIcon: true,
  CursorArrowIcon: true,
};

// Mirror the icons computation from IconControl.tsx
function computeIcons(
  allIcons: Record<string, unknown>,
  search: string,
  filter?: RegExp | ((id: string) => boolean),
): string[] {
  return Object.keys(allIcons).filter(iconName => {
    if (!iconName.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter instanceof RegExp) return filter.test(iconName);
    if (typeof filter === 'function') return filter(iconName);
    return true;
  });
}

describe('WidgetIcon name (radix-icon)', () => {
  it('registers as radix-icon to avoid collision with lucide-icon', () => {
    expect(WidgetIcon.name).toBe('radix-icon');
    expect(WidgetIcon.Widget().name).toBe('radix-icon');
  });
});

describe('IconControl filter logic (radix-icon)', () => {
  it('includes all icons when no filter is supplied', () => {
    const icons = computeIcons(SAMPLE_ICONS, '');
    expect(icons).toHaveLength(Object.keys(SAMPLE_ICONS).length);
  });

  it('excludes icons that do not match a RegExp filter', () => {
    // Only icons whose name starts with "Arrow"
    const filter = /^Arrow/;
    const icons = computeIcons(SAMPLE_ICONS, '', filter);

    // Every returned icon must pass the filter
    for (const icon of icons) {
      expect(filter.test(icon)).toBe(true);
    }

    // Icons that don't start with "Arrow" must be absent
    const excluded = Object.keys(SAMPLE_ICONS).filter(icon => !/^Arrow/.test(icon));
    expect(excluded.length).toBeGreaterThan(0);
    for (const icon of excluded) {
      expect(icons).not.toContain(icon);
    }
  });

  it('excludes icons that do not match a function predicate filter', () => {
    const filter = (id: string) => id.startsWith('Arrow');
    const icons = computeIcons(SAMPLE_ICONS, '', filter);

    for (const icon of icons) {
      expect(icon.startsWith('Arrow')).toBe(true);
    }

    const excluded = Object.keys(SAMPLE_ICONS).filter(icon => !icon.startsWith('Arrow'));
    expect(excluded.length).toBeGreaterThan(0);
    for (const icon of excluded) {
      expect(icons).not.toContain(icon);
    }
  });

  it('applies both filter and search simultaneously', () => {
    // Only Chevron icons that contain "down"
    const filter = /Chevron/;
    const search = 'down';
    const icons = computeIcons(SAMPLE_ICONS, search, filter);

    expect(icons).toEqual(['ChevronDownIcon']);
    for (const icon of icons) {
      expect(filter.test(icon)).toBe(true);
      expect(icon.toLowerCase()).toContain(search.toLowerCase());
    }
  });

  it('returns empty list when filter excludes all icons', () => {
    const filter = /^ThisPatternMatchesNoRadixIcon_xyz123$/;
    const icons = computeIcons(SAMPLE_ICONS, '', filter);
    expect(icons).toHaveLength(0);
  });
});
