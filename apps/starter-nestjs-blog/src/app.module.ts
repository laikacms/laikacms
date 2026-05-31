import { Module } from '@nestjs/common';

import { BlogModule } from './blog/blog.module.js';
import { DecapModule } from './decap/decap.module.js';

@Module({
  imports: [DecapModule, BlogModule],
})
export class AppModule {}
