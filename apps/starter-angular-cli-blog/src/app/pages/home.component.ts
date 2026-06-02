import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

interface PostSummary {
  key: string;
  type: string;
  updatedAt?: string;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  template: `
    <main>
      <h1>My Blog</h1>
      @if (posts() === undefined) {
        <p>Loading…</p>
      } @else if (posts()!.length === 0) {
        <p>No posts yet. <a href="/admin">Open the CMS</a> to write your first post.</p>
      } @else {
        <ul style="list-style:none;padding:0">
          @for (post of posts()!; track post.key) {
            <li style="margin-bottom:1rem">
              <a [routerLink]="['/blog', slug(post.key)]">{{ slug(post.key) }}</a>
              @if (post.updatedAt) {
                &nbsp;·&nbsp;<time>{{ formatDate(post.updatedAt) }}</time>
              }
            </li>
          }
        </ul>
      }
      <p><a href="/admin">Admin →</a></p>
    </main>
  `,
})
export class HomeComponent {
  private http = inject(HttpClient);

  /**
   * toSignal subscribes to the HttpClient observable and converts it to an
   * Angular signal. During SSR, Angular's Universal engine will make an HTTP
   * request to GET /api/posts on the same Express server and wait for the
   * response before rendering — this is why withFetch() is required in appConfig.
   */
  readonly posts = toSignal(
    this.http.get<PostSummary[]>('/api/posts'),
  );

  slug(key: string): string {
    return key.replace(/^posts\//, '').replace(/\.md$/, '');
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString();
  }
}
