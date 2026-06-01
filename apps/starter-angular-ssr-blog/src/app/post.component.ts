import { AsyncPipe, NgIf } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { switchMap } from 'rxjs/operators';

interface Post {
  slug: string;
  title?: string;
  date?: string;
  description?: string;
  body?: string;
}

@Component({
  selector: 'app-post',
  standalone: true,
  imports: [RouterLink, AsyncPipe, NgIf],
  template: `
    <ng-container *ngIf="post$ | async as post; else loading">
      <article>
        <h1>{{ post.title || post.slug }}</h1>
        <p *ngIf="post.date"><time>{{ post.date }}</time></p>
        <p *ngIf="post.description"><em>{{ post.description }}</em></p>
        <pre style="white-space:pre-wrap;font-family:inherit">{{ post.body }}</pre>
      </article>
      <p><a routerLink="/">← Back</a></p>
    </ng-container>
    <ng-template #loading><p>Loading…</p></ng-template>
  `,
})
export class PostComponent {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);

  post$ = this.route.params.pipe(
    switchMap(params => this.http.get<Post>(`/api/posts/${params['slug']}`)),
  );
}
