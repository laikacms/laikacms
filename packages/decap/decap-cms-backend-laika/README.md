# @laikacms/decap-cms-backend-laika

[![npm](https://img.shields.io/npm/v/@laikacms/decap-cms-backend-laika)](https://www.npmjs.com/package/@laikacms/decap-cms-backend-laika)
[![npm](https://img.shields.io/npm/dm/@laikacms/decap-cms-backend-laika)](https://www.npmjs.com/package/@laikacms/decap-cms-backend-laika)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/@laikacms/decap-cms-backend-laika)](https://bundlephobia.com/result?p=@laikacms/decap-cms-backend-laika)

Custom Decap CMS backend for Laika CMS.

## Installation

```bash
pnpm add @laikacms/decap-cms-backend-laika decap-cms-app
```

## Usage

```typescript
import createLaikaBackend from '@laikacms/decap-cms-backend-laika';
import CMS from 'decap-cms-app';

const LaikaBackend = createLaikaBackend({
  documentsApiBaseUrl: '/api/documents',
  assetsApiBaseUrl: '/api/assets',
});

CMS.registerBackend('laika', LaikaBackend);
CMS.init();
```

## Config

```yaml
backend:
  name: laika
  base_url: https://api.example.com
  api_root: /api
```

## Features

- Editorial workflow (draft/review/publish)
- Media library integration
- i18n support (multiple folders)
- Custom repository injection
