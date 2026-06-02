import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';

interface PostDoc {
  slug: string;
  content: {
    title?: string,
    date?: string,
    description?: string,
    body?: string,
  };
}

@Component({
  selector: 'app-blog',
  standalone: true,
  imports: [RouterLink],
  template: `
    @if (post() === undefined) {
      <p>Loading…</p>
    } @else if (post() === null) {
      <p>Post not found. <a routerLink="/">← Back</a></p>
    } @else {
      <article>
        <h1>{{ post()!.content.title ?? post()!.slug }}</h1>
        @if (post()!.content.date) {
          <time>{{ formatDate(post()!.content.date!) }}</time>
        }
        @if (post()!.content.description) {
          <p><em>{{ post()!.content.description }}</em></p>
        }
        <pre style="white-space:pre-wrap;font-family:inherit">{{ post()!.content.body }}</pre>
      </article>
    }
    <p><a routerLink="/">← Back</a></p>
  `,
})
export class BlogComponent {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);

  readonly post = toSignal<PostDoc | null>(
    this.route.paramMap.pipe(
      switchMap(params => this.http.get<PostDoc>(`/api/posts/${params.get('slug')}`)),
    ),
  );

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString();
  }
}
