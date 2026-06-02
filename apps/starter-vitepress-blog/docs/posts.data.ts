import { createContentLoader } from 'vitepress';

export interface Post {
  title: string;
  url: string;
  date?: string;
  description?: string;
}

declare const data: Post[];
export { data };

export default createContentLoader('posts/*.md', {
  transform(raw) {
    return raw
      .map(page => ({
        title: String(page.frontmatter['title'] ?? page.url.replace(/^\/posts\//, '').replace(/\.html$/, '')),
        url: page.url,
        date: page.frontmatter['date'] ? String(page.frontmatter['date']) : undefined,
        description: page.frontmatter['description'] ? String(page.frontmatter['description']) : undefined,
      }))
      .sort((a, b) => {
        const aDate = a.date ? new Date(a.date).getTime() : 0;
        const bDate = b.date ? new Date(b.date).getTime() : 0;
        return bDate - aDate;
      });
  },
});
