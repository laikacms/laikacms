import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component.js';
import { serverConfig } from './app/app.config.server.js';
import { mergeApplicationConfig } from '@angular/core';
import { appConfig } from './app/app.config.js';

const bootstrap = () => bootstrapApplication(AppComponent, mergeApplicationConfig(appConfig, serverConfig));

export default bootstrap;
