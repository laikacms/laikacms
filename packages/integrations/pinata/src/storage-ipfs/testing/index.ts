import type { StorageObjectContent } from 'laikacms/storage';
import type { StorageContractCase } from 'laikacms/storage/testing';

import { type PinataPinRow } from '../pinata-datasource.js';
import { PinataStorageRepository } from '../pinata-storage-repository.js';

const API_URL = 'https://mock-api.pinata-contract-test.internal';
const GATEWAY_URL = 'https://mock-gw.pinata-contract-test.internal/ipfs';

interface Pin {
  id: string;
  cid: string;
  content: string;
  size: number;
  date_pinned: string;
  metadata: PinataPinRow['metadata'];
}

const createMockPinata = () => {
  const pins = new Map<string, Pin>();
  let cidCounter = 0;
  const newCid = (): string => `Qm${(++cidCounter).toString(16).padStart(44, 'a')}`;

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname;

    if (path === '/pinning/pinFileToIPFS' && method === 'POST') {
      const form = init?.body as FormData;
      const fileBlob = form.get('file') as Blob | null;
      const metaRaw = form.get('pinataMetadata') as string | null;
      const content = fileBlob ? await fileBlob.text() : '';
      const meta = metaRaw
        ? (JSON.parse(metaRaw) as { name: string, keyvalues: PinataPinRow['metadata']['keyvalues'] })
        : { name: '', keyvalues: {} as PinataPinRow['metadata']['keyvalues'] };
      const cid = newCid();
      const pin: Pin = {
        id: `id-${cid}`,
        cid,
        content,
        size: content.length,
        date_pinned: new Date().toISOString(),
        metadata: meta,
      };
      pins.set(cid, pin);
      return json({ IpfsHash: cid, PinSize: pin.size, Timestamp: pin.date_pinned });
    }

    const unpinMatch = path.match(/^\/pinning\/unpin\/(.+)$/);
    if (unpinMatch && method === 'DELETE') {
      const cid = decodeURIComponent(unpinMatch[1]);
      if (!pins.has(cid)) return new Response('Not pinned', { status: 404 });
      pins.delete(cid);
      return new Response('OK', { status: 200 });
    }

    if (path === '/data/pinList' && method === 'GET') {
      const nameFilter = url.searchParams.get('metadata[name]');
      const keyvaluesFilter = url.searchParams.get('metadata[keyvalues]');
      let kvParent: string | undefined;
      if (keyvaluesFilter) {
        const parsed = JSON.parse(keyvaluesFilter) as Record<string, { value: string, op: string }>;
        kvParent = parsed.parent?.value;
      }
      const rows = [...pins.values()].filter(p => {
        if (nameFilter !== null && p.metadata.name !== nameFilter) return false;
        if (kvParent !== undefined && p.metadata.keyvalues.parent !== kvParent) return false;
        return true;
      });
      return json({
        rows: rows.map(p => ({
          id: p.id,
          ipfs_pin_hash: p.cid,
          size: p.size,
          date_pinned: p.date_pinned,
          metadata: p.metadata,
        })),
        count: rows.length,
      });
    }

    if (url.toString().startsWith(GATEWAY_URL)) {
      const cid = decodeURIComponent(url.pathname.split('/').pop() ?? '');
      const pin = pins.get(cid);
      if (!pin) return new Response('Not pinned', { status: 404 });
      return new Response(pin.content, { status: 200 });
    }

    return new Response(`{"unhandled":"${method} ${url.toString()}"}`, { status: 501 });
  };

  return { pins, fetch: fetchImpl };
};

const makeSerializerRegistry = () => ({
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as StorageObjectContent,
  },
});

export const pinataContractCase: StorageContractCase = {
  name: 'PinataStorageRepository',
  async makeRepo() {
    const backend = createMockPinata();
    return new PinataStorageRepository({
      auth: { token: 'pinata-contract-jwt' },
      apiUrl: API_URL,
      gatewayUrl: GATEWAY_URL,
      fetch: backend.fetch,
      serializerRegistry: makeSerializerRegistry(),
      defaultFileExtension: 'json',
    });
  },
};
