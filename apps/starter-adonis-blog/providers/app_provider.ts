import { ApplicationService } from '@adonisjs/core/types';

export default class AppProvider {
  constructor(protected app: ApplicationService) {}

  async boot() {}
  async start() {}
  async ready() {}
  async shutdown() {}
}
