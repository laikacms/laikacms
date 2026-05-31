import { injectLoad, type PageServerLoad, type RouteMeta } from '@analogjs/router';
import { Component } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { runTask } from 'laikacms/compat';

import { laika } from '../../../lib/laika.js';

export const routeMeta: RouteMeta = {
  title: 'Post',
};

type PostContent = {
  title?: string,
  date?: string,
  description?: string,
  body?: string,
};

/**
 * Route params in Analog come from `PageServerLoad.params` (H3/Nitro route
 * context), not Angular's ActivatedRouteSnapshot.
 *
 * `PageServerLoad.params` mirrors Nitro's route params: `{ slug: 'my-post' }`.
 * The param name must match the `[slug]` folder/file name convention.
 */
export const load = async ({ params }: PageServerLoad): Promise<PostContent | null> => {
  const slug = (params as Record<string, string> | undefined)?.['slug'] ?? '';
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    return doc.content as PostContent;
  } catch {
    return null;
  }
};

@Component({
  selector: 'app-blog-post',
  standalone: true,
  imports: [RouterLink],
  template: `
    @if (post(); as p) {
      <main>
        <article>
          <h1>{{ p.title }}</h1>
          @if (p.date) {
            <time>{{ formatDate(p.date) }}</time>
          }
          @if (p.description) {
            <p><em>{{ p.description }}</em></p>
          }
          <!-- body is raw markdown; pipe through remark/rehype in production -->
          <pre style="white-space:pre-wrap;font-family:inherit">{{ p.body }}</pre>
        </article>
        <p><a routerLink="/">← Back</a></p>
      </main>
    } @else {
      <p>Post not found. <a routerLink="/">← Back</a></p>
    }
  `,
})
export default class BlogPostComponent {
  readonly post = toSignal(injectLoad<typeof load>());

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString();
  }
}
