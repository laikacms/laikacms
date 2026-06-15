import type { Decorator, Preview } from '@storybook/react-vite';
import * as React from 'react';

// Imported through the package's public subpath; aliased to source in `main.ts`.
import { EditorGlobalStyles } from '@laikacms/lexical-editor/editor/themes/global-styles';

/**
 * Every story is wrapped in the editor's emotion global styles (the design
 * tokens the components read via `var(--...)`) and a surface that flips between
 * the light `:root` palette and the `.dark` palette based on the Theme toolbar.
 */
const withTheme: Decorator = (Story, context) => {
  const dark = context.globals.theme === 'dark';
  return (
    <>
      <EditorGlobalStyles />
      <div
        className={dark ? 'dark' : undefined}
        style={{
          background: 'var(--background)',
          color: 'var(--foreground)',
          minHeight: '100vh',
          padding: '2rem',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <Story />
      </div>
    </>
  );
};

const preview: Preview = {
  decorators: [withTheme],
  parameters: {
    layout: 'fullscreen',
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  globalTypes: {
    theme: {
      description: 'Editor color palette',
      defaultValue: 'light',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
};

export default preview;
