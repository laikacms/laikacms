import { AsyncPipe, DatePipe, NgFor, NgIf } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

interface PostSummary {
  slug: string;
  title: string;
  date: string;
  description: string;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, AsyncPipe, NgFor, NgIf, DatePipe],
  template: `
    <h1>Blog</h1>
    <ng-container *ngIf="posts$ | async as posts; else loading">
      <p *ngIf="posts.length === 0">
        No posts yet. <a href="/admin">Open the CMS</a> to write your first post.
      </p>
      <ul *ngIf="posts.length > 0">
        <li *ngFor="let post of posts">
          <a [routerLink]="['/blog', post.slug]">{{ post.title || post.slug }}</a>
          <time *ngIf="post.date">{{ post.date | date }}</time>
        </li>
      </ul>
    </ng-container>
    <ng-template #loading><p>Loading…</p></ng-template>
  `,
})
export class HomeComponent {
  private http = inject(HttpClient);
  posts$ = this.http.get<PostSummary[]>('/api/posts');
}
