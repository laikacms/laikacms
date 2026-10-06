/**
 * Renders `<pre class="mermaid">` blocks (emitted for ```mermaid fences by the markdown config in
 * ../config.ts). Mermaid is loaded only on pages that have a diagram, and diagrams re-render when
 * the light/dark toggle flips so they follow the site theme.
 */
const SOURCE = 'mermaidSource';

let renderCount = 0;

export async function renderMermaid(): Promise<void> {
  const blocks = [...document.querySelectorAll<HTMLElement>('.vp-doc pre.mermaid')];
  if (blocks.length === 0) return;

  const { default: mermaid } = await import('mermaid');
  const dark = document.documentElement.classList.contains('dark');
  mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'strict' });

  for (const block of blocks) {
    // Keep the source: rendering replaces the block's text with the SVG.
    const source = block.dataset[SOURCE] ??= block.textContent ?? '';
    try {
      const { svg } = await mermaid.render(`mermaid-${++renderCount}`, source);
      block.innerHTML = svg;
      block.dataset.rendered = 'true';
    } catch (error) {
      block.textContent = source;
      console.error('[mermaid] failed to render diagram', error);
    }
  }
}

/** Re-render when VitePress toggles the `dark` class on <html>. */
export function watchTheme(): void {
  let dark = document.documentElement.classList.contains('dark');
  new MutationObserver(() => {
    const next = document.documentElement.classList.contains('dark');
    if (next === dark) return;
    dark = next;
    void renderMermaid();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}
