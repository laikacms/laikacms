import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./home.component.js').then(m => m.HomeComponent),
  },
  {
    path: 'blog/:slug',
    loadComponent: () => import('./post.component.js').then(m => m.PostComponent),
  },
];
