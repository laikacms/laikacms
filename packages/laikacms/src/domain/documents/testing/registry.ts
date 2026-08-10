import { catalogDocumentsContractCase } from '../../../impl/documents-catalog/testing.js';
import { drizzleDocumentsContractCase } from '../../../impl/documents-drizzle/testing.js';
import {
  jsonApiProxyChangesContractCase,
  jsonApiProxyDocumentsContractCase,
} from '../../../impl/documents-jsonapi-proxy/testing.js';
import { obsidianDocumentsContractCase } from '../../../impl/documents-obsidian/testing.js';
import type { DocumentsContractCase } from './contract.js';

export const documentsContractRegistry: DocumentsContractCase[] = [
  catalogDocumentsContractCase,
  drizzleDocumentsContractCase,
  obsidianDocumentsContractCase,
  jsonApiProxyDocumentsContractCase,
  jsonApiProxyChangesContractCase,
];
