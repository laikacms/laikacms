import { contentBaseAssetsContractCase } from '../../../impl/assets-contentbase/testing.js';
import { jsonApiProxyAssetsContractCase } from '../../../impl/assets-jsonapi-proxy/testing.js';
import { obsidianAssetsContractCase } from '../../../impl/assets-obsidian/testing.js';
import { r2AssetsContractCase } from '../../../impl/assets-r2/testing.js';
import type { AssetsContractCase } from './contract.js';

export const assetsContractRegistry: AssetsContractCase[] = [
  contentBaseAssetsContractCase,
  obsidianAssetsContractCase,
  r2AssetsContractCase,
  jsonApiProxyAssetsContractCase,
];
