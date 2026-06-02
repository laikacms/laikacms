import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { defineCollection } from 'astro:content';

/**
 * Starlight requires this explicit collection definition in Astro v5.
 * The docsLoader() reads from src/content/docs/ on disk — the same
 * directory that LaikaCMS (via Decap) writes to.
 */
export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
