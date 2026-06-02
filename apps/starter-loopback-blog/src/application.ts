import 'reflect-metadata';

import { RestApplication } from '@loopback/rest';

import { BlogController } from './controllers/blog.controller.js';

export class BlogApplication extends RestApplication {
  constructor() {
    super({
      rest: {
        // Disable OpenAPI explorer and spec endpoints — this is a blog, not an API.
        openApiSpec: { disabled: true },
        apiExplorer: { disabled: true },
      },
    });
    this.controller(BlogController);
  }
}
