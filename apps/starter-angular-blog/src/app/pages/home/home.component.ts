import { Component, inject, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AsyncPipe, DatePipe } from '@angular/common';
import { PostsService, PostSummary } from '../../services/posts.service.js';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, AsyncPipe, DatePipe],
  template: `
    <main>
      <h1>My Blog</h1>
      @if (loading()) {
        <p>Loading…</p>
      } @else if (error()) {
        <p>Error loading posts.</p>
      } @else if (posts().length === 0) {
        <p>No posts yet. <a href="/admin">Open the CMS</a> to write your first post.</p>
      } @else {
        <ul style="list-style:none;padding:0">
          @for (post of posts(); track post.slug) {
            <li style="margin-bottom:1.5rem">
              <a [routerLink]="['/blog', post.slug]">{{ post.slug }}</a>
              @if (post.updatedAt) {
                &nbsp;·&nbsp;
                <time>{{ post.updatedAt | date }}</time>
              }
            </li>
          }
        </ul>
      }
      <p><a href="/admin">Admin →</a></p>
    </main>
  `,
})
export class HomeComponent implements OnInit {
  private readonly postsService = inject(PostsService);

  readonly posts = signal<PostSummary[]>([]);
  readonly loading = signal(true);
  readonly error = signal(false);

  ngOnInit() {
    this.postsService.getPosts().subscribe({
      next: posts => {
        this.posts.set(posts);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }
}
