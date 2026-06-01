import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface PostSummary {
  slug: string;
  updatedAt: string | null;
}

export interface Post {
  slug: string;
  title?: string;
  date?: string;
  body?: string;
}

/**
 * Thin wrapper over the Express blog data API (/api/posts, /api/posts/:slug).
 *
 * HttpClient is used so the same service works in both SSR and browser
 * contexts. During SSR the absoluteUrlInterceptor prepends the server origin
 * so Node.js fetch can resolve the relative URLs.
 */
@Injectable({ providedIn: 'root' })
export class BlogService {
  private http = inject(HttpClient);

  getPosts(): Promise<PostSummary[]> {
    return firstValueFrom(this.http.get<PostSummary[]>('/api/posts'));
  }

  getPost(slug: string): Promise<Post> {
    return firstValueFrom(this.http.get<Post>(`/api/posts/${slug}`));
  }
}
