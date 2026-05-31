import { All, Controller, Req, Res } from '@nestjs/common';
import type { Request as ExpressReq, Response as ExpressRes } from 'express';

import { sendLaikaResponse, toLaikaRequest } from '../laika-request.util.js';
import { LaikaService } from '../laika.service.js';

@Controller('api/decap')
export class DecapController {
  constructor(private readonly laika: LaikaService) {}

  @All('*')
  async proxy(@Req() req: ExpressReq, @Res() res: ExpressRes) {
    const webReq = await toLaikaRequest(req);
    const webRes = await this.laika.fetch(webReq);
    await sendLaikaResponse(webRes, res);
  }
}
