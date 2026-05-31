import { injectLoad, type PageServerLoad, type RouteMeta } from '@analogjs/router';
import { Component } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { collectStream } from 'laikacms/compat';

import { laika } from '../../lib/laika.js';

export const routeMeta: RouteMeta = {
  title: 'Blog',
};

/**
 * Route load function — runs on the Nitro server during SSR. Analog transfers
 * the result via Angular transfer state; the client never re-executes it.
 *
 * The argument type is `PageServerLoad` (from `@analogjs/router`), which wraps
 * the underlying H3 event context: { params, req, res, fetch, event }.
 *
 * Doc gap: `injectLoad` returns an `Observable`, not an Angular Signal.
 * Use `toSignal()` from `@angular/core/rxjs-interop` to bridge for use with
 * Angular 19's `@for` / `@if` template control flow.
 *
 * Doc gap: `listRecordSummaries` items do NOT embed document content fields
 * (title, date, etc.). The summary items only carry metadata: key, type,
 * language, status, createdAt, updatedAt. To display a title, derive the slug
 * from `post.key` or call `getDocument(key)` for full content.
 */
export const load = async (_event: PageServerLoad) => {
  const { items } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );
  return items
    .filter(r => r.type === 'published-summary')
    .sort((a, b) => {
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      return b.key.localeCompare(a.key);
    });
};

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  template: `
    <main>
      <h1>Blog</h1>
      @if ((posts() ?? []).length === 0) {
        <p>No posts yet. <a href="/admin">Open the CMS</a> to write your first post.</p>
      } @else {
        <ul>
          @for (post of posts() ?? []; track post.key) {
            <li>
              <a [routerLink]="['/blog', slug(post.key)]">{{ slug(post.key) }}</a>
              @if (post.updatedAt) {
                · <time>{{ formatDate(post.updatedAt) }}</time>
              }
            </li>
          }
        </ul>
      }
      <p><a href="/admin">Edit in CMS →</a></p>
    </main>
  `,
})
export default class HomePageComponent {
  readonly posts = toSignal(injectLoad<typeof load>());

  slug(key: string): string {
    return key.replace(/^posts\//, '').replace(/\.md$/, '');
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString();
  }
}
