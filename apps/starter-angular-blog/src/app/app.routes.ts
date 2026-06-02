import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/home/home.component.js').then(m => m.HomeComponent),
  },
  {
    path: 'blog/:slug',
    loadComponent: () =>
      import('./pages/post/post.component.js').then(m => m.PostComponent),
  },
];
