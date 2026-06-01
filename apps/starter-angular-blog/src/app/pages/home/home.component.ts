import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { BlogService, PostSummary } from '../../services/blog.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  styles: [`
    main { font-family: system-ui, sans-serif; max-width: 48rem; margin: 0 auto; padding: 1rem 1.5rem; }
    ul { list-style: none; padding: 0; }
    li { margin-bottom: 1rem; }
    time { color: #666; font-size: 0.9em; }
  `],
  template: `
    <main>
      <h1>My Blog</h1>
      @if (posts().length === 0) {
        <p>No posts yet. <a href="/admin">Open the CMS</a> to write your first post.</p>
      } @else {
        <ul>
          @for (post of posts(); track post.slug) {
            <li>
              <a [routerLink]="['/blog', post.slug]">{{ post.slug }}</a>
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
export class HomeComponent implements OnInit {
  private blog = inject(BlogService);
  posts = signal<PostSummary[]>([]);

  async ngOnInit(): Promise<void> {
    this.posts.set(await this.blog.getPosts());
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString();
  }
}
