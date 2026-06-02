import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component.js';
import { appConfig } from './app/app.config.server.js';

const bootstrap = () => bootstrapApplication(AppComponent, appConfig);
export default bootstrap;
