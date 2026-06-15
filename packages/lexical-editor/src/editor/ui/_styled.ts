/**
 * Styling helpers for the emotion-ported UI components.
 *
 * Replaces shadcn-editor's `cn` (clsx + tailwind-merge) and `cva`:
 *  - `cx` / `css` come straight from `@emotion/css`
 *  - `variants` is a small `cva`-style helper whose variant values are emotion
 *    class names produced by `css`.
 */
export { css, cx, keyframes } from '@emotion/css';
import { cx } from '@emotion/css';

type VariantMap = Record<string, Record<string, string>>;

/** Props selecting one option per variant group, plus an extra class name. */
export type VariantProps<V extends VariantMap> =
  & {
    [K in keyof V]?: keyof V[K];
  }
  & { className?: string };

interface VariantConfig<V extends VariantMap> {
  variants: V;
  defaultVariants?: { [K in keyof V]?: keyof V[K]; };
}

/**
 * Build a class-name function from a base class and a set of variant groups.
 * Mirrors `class-variance-authority` closely enough for the ported components.
 */
export function variants<V extends VariantMap>(base: string, config: VariantConfig<V>) {
  return (props: VariantProps<V> = {}): string => {
    const classes: string[] = [base];
    for (const group of Object.keys(config.variants) as Array<keyof V>) {
      const selected = props[group] ?? config.defaultVariants?.[group];
      if (selected != null) {
        const variantClass = config.variants[group][selected as string];
        if (variantClass) classes.push(variantClass);
      }
    }
    if (props.className) classes.push(props.className);
    return cx(...classes);
  };
}
