import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home.component.js').then(m => m.HomeComponent),
  },
  {
    path: 'blog/:slug',
    loadComponent: () => import('./pages/blog.component.js').then(m => m.BlogComponent),
  },
  {
    path: 'admin',
    loadComponent: () => import('./pages/admin.component.js').then(m => m.AdminComponent),
  },
];
