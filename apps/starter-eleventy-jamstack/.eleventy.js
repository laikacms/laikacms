/**
 * Eleventy config — renders markdown posts from content/posts/ to _site/.
 *
 * The same content/posts/ directory is the storage root for LaikaCMS in
 * server/admin.ts. Editing a post in the Decap admin writes to this directory;
 * Eleventy's --serve picks up the change and regenerates.
 */
export default function(eleventyConfig) {
  eleventyConfig.addCollection('posts', collectionApi => {
    return collectionApi
      .getFilteredByGlob('content/posts/**/*.md')
      .sort((a, b) => (b.data.date?.getTime?.() ?? 0) - (a.data.date?.getTime?.() ?? 0));
  });

  return {
    dir: {
      input: 'content',
      includes: '_includes',
      layouts: '_layouts',
      output: '_site',
    },
    markdownTemplateEngine: 'njk',
    htmlTemplateEngine: 'njk',
    templateFormats: ['md', 'njk', 'html'],
  };
}
