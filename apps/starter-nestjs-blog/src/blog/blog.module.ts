import { Module } from '@nestjs/common';

import { DecapModule } from '../decap/decap.module.js';
import { BlogController } from './blog.controller.js';

@Module({
  imports: [DecapModule],
  controllers: [BlogController],
})
export class BlogModule {}
