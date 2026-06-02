import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { PostsService, Post } from '../../services/posts.service.js';

@Component({
  selector: 'app-post',
  standalone: true,
  imports: [RouterLink, DatePipe],
  template: `
    <main>
      @if (loading()) {
        <p>Loading…</p>
      } @else if (!post()) {
        <h1>Post not found</h1>
        <p><a routerLink="/">&#8592; Back to blog</a></p>
      } @else {
        <article>
          <h1>{{ post()!.title ?? post()!.slug }}</h1>
          @if (post()!.date) {
            <time>{{ post()!.date | date }}</time>
          }
          @if (post()!.description) {
            <p><em>{{ post()!.description }}</em></p>
          }
          <pre style="white-space:pre-wrap;font-family:inherit">{{ post()!.body }}</pre>
        </article>
        <p><a routerLink="/">&#8592; Back</a></p>
      }
    </main>
  `,
})
export class PostComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly postsService = inject(PostsService);

  readonly post = signal<Post | null>(null);
  readonly loading = signal(true);

  ngOnInit() {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.postsService.getPost(slug).subscribe({
      next: post => {
        this.post.set(post);
        this.loading.set(false);
      },
      error: () => {
        this.post.set(null);
        this.loading.set(false);
      },
    });
  }
}
