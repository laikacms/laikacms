/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

// Route map for the blog.
// Sails matches routes top-to-bottom; more specific routes first.
module.exports.routes = {
  // Decap JSON:API proxy — raw body is buffered by the rawDecapBody middleware
  // (see config/http.js) before Sails' router runs.
  'ALL /api/decap': { controller: 'BlogController', action: 'decapProxy' },
  'ALL /api/decap/*': { controller: 'BlogController', action: 'decapProxy' },

  // Decap admin SPA.
  'GET /admin': { controller: 'BlogController', action: 'admin' },

  // Blog post detail.
  'GET /blog/:slug': { controller: 'BlogController', action: 'post' },

  // Blog index.
  'GET /': { controller: 'BlogController', action: 'index' },
};
