/**
 * Unit tests for decap-cms-widget-lucide-icon IconControl filter logic (LCMS-249)
 *
 * The `filter` prop (RegExp | function predicate) is passed via the Widget()
 * closure so Decap's fixed-prop rendering doesn't discard it. These tests
 * verify that icons excluded by the filter are absent from the filtered list.
 */

import * as lucideReact from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./IconControl.js', () => ({ IconControl: () => null }));
vi.mock('./IconPreview.js', () => ({ IconPreview: () => null }));

const { default: WidgetIcon } = await import('./index.js');

// Mirror the allIcons computation from IconControl.tsx
const allIcons = Object.fromEntries(Object.entries(lucideReact.icons));

// Mirror the filteredIcons computation from IconControl.tsx
function computeFilteredIcons(search: string, filter?: RegExp | ((id: string) => boolean)): string[] {
  return Object.keys(allIcons).filter(icon => {
    if (!icon.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter instanceof RegExp) return filter.test(icon);
    if (typeof filter === 'function') return filter(icon);
    return true;
  });
}

describe('WidgetIcon name (lucide-icon)', () => {
  it('registers as lucide-icon to avoid collision with radix-icon', () => {
    expect(WidgetIcon.name).toBe('lucide-icon');
    expect(WidgetIcon.Widget().name).toBe('lucide-icon');
  });
});

describe('IconControl filter logic (lucide-icon)', () => {
  it('includes all icons when no filter is supplied', () => {
    const icons = computeFilteredIcons('');
    expect(icons.length).toBe(Object.keys(allIcons).length);
  });

  it('excludes icons that do not match a RegExp filter', () => {
    // Only icons whose name starts with "A"
    const filter = /^A/;
    const icons = computeFilteredIcons('', filter);

    // Every returned icon must pass the filter
    for (const icon of icons) {
      expect(filter.test(icon)).toBe(true);
    }

    // At least one icon from the full set does NOT start with "A" — confirm it's absent
    const excluded = Object.keys(allIcons).filter(icon => !/^A/.test(icon));
    expect(excluded.length).toBeGreaterThan(0);
    for (const icon of excluded) {
      expect(icons).not.toContain(icon);
    }
  });

  it('excludes icons that do not match a function predicate filter', () => {
    const filter = (id: string) => id.startsWith('A');
    const icons = computeFilteredIcons('', filter);

    for (const icon of icons) {
      expect(icon.startsWith('A')).toBe(true);
    }

    const excluded = Object.keys(allIcons).filter(icon => !icon.startsWith('A'));
    expect(excluded.length).toBeGreaterThan(0);
    for (const icon of excluded) {
      expect(icons).not.toContain(icon);
    }
  });

  it('applies both filter and search simultaneously', () => {
    // Only arrow icons containing "up"
    const filter = /Arrow/;
    const search = 'up';
    const icons = computeFilteredIcons(search, filter);

    for (const icon of icons) {
      expect(filter.test(icon)).toBe(true);
      expect(icon.toLowerCase()).toContain(search.toLowerCase());
    }
  });

  it('returns empty list when filter excludes all icons', () => {
    const filter = /^ThisPatternMatchesNoLucideIcon_xyz123$/;
    const icons = computeFilteredIcons('', filter);
    expect(icons).toHaveLength(0);
  });
});
