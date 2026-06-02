import { Module } from '@nestjs/common';

import { LaikaService } from '../laika.service.js';
import { DecapController } from './decap.controller.js';

@Module({
  controllers: [DecapController],
  providers: [LaikaService],
  exports: [LaikaService],
})
export class DecapModule {}
