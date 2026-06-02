import { Module } from '@nestjs/common';

import { LaikaService } from '../laika.service.js';
import { DecapController } from './decap.controller.js';

@Module({
  providers: [LaikaService],
  controllers: [DecapController],
  exports: [LaikaService],
})
export class DecapModule {}
