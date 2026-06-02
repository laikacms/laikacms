import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface PostSummary {
  slug: string;
  title?: string;
  date?: string;
  description?: string;
  updatedAt?: string;
}

export interface Post extends PostSummary {
  body?: string;
}

@Injectable({ providedIn: 'root' })
export class PostsService {
  private readonly http = inject(HttpClient);

  // SERVER_URL is injected by server.ts as `http://localhost:<port>` during SSR.
  // The global fetch() API (used by withFetch()) requires an absolute URL when
  // running inside Node.js — relative URLs only work in a browser context.
  // On the browser, this token is absent, so we fall back to '' (relative URL).
  private readonly serverUrl = inject<string>('SERVER_URL', { optional: true }) ?? '';

  getPosts() {
    return this.http.get<PostSummary[]>(`${this.serverUrl}/api/posts`);
  }

  getPost(slug: string) {
    return this.http.get<Post>(`${this.serverUrl}/api/posts/${slug}`);
  }
}
