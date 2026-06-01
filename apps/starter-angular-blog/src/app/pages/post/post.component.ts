import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { BlogService, Post } from '../../services/blog.service';

@Component({
  selector: 'app-post',
  standalone: true,
  imports: [RouterLink],
  styles: [`
    article { font-family: system-ui, sans-serif; max-width: 48rem; margin: 0 auto; padding: 1rem 1.5rem; }
    time { color: #666; display: block; margin-bottom: 1rem; }
    pre { white-space: pre-wrap; font-family: inherit; }
  `],
  template: `
    <article>
      @if (post()) {
        <h1>{{ post()!.title ?? slug() }}</h1>
        @if (post()!.date) {
          <time>{{ formatDate(post()!.date!) }}</time>
        }
        <pre>{{ post()!.body }}</pre>
      } @else if (notFound()) {
        <h1>Post not found</h1>
        <p>The post <em>{{ slug() }}</em> does not exist.</p>
      }
      <p><a routerLink="/">← Back</a></p>
    </article>
  `,
})
export class PostComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private blog = inject(BlogService);

  slug = signal('');
  post = signal<Post | null>(null);
  notFound = signal(false);

  async ngOnInit(): Promise<void> {
    const s = this.route.snapshot.paramMap.get('slug') ?? '';
    this.slug.set(s);
    try {
      this.post.set(await this.blog.getPost(s));
    } catch {
      this.notFound.set(true);
    }
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString();
  }
}
