import { BackendGroup, type BackendGroupData } from './BackendGroup';

/* The catalogue's numbered groups are a list of content files rather than one
   page section, so they go through `import.meta.glob`. Order is key order:
   `01-native.yaml`, `02-sql.yaml`, … — the number prefix is the ordering, so
   reordering the page is a rename, not a code change. */
const groupModules = import.meta.glob<BackendGroupData>('laika:store/backends/*', {
  eager: true,
  import: 'default',
});

export const LAIKA_GROUPS: BackendGroupData[] = Object.keys(groupModules)
  .sort()
  .map(key => groupModules[key]!);

/* Two groups that don't come from `content/backends/*`: they describe the other
   contract (assets) and the on-disk formats (serializers), so they live with
   the component rather than as numbered content files. */
export const CATALOGUE_ASSETS: Omit<BackendGroupData, 'id'> = {
  label: 'Assets',
  via: 'a second contract · AssetsRepository',
  note:
    'Two contracts, same shape. Pair a content store with an asset store (bytes, transforms and URLs) on the backend you already use.',
  items: [
    { name: 'Cloudinary', sub: '@laikacms/cloudinary', icon: { si: 'cloudinary' } },
    { name: 'Cloudflare Images', sub: '@laikacms/cloudflare', icon: { si: 'cloudflare' } },
    { name: 'S3 assets', sub: '@laikacms/aws', icon: { img: 'aws' } },
    { name: 'R2 assets', sub: 'laikacms/storage-r2', icon: { si: 'cloudflare' } },
    { name: 'Obsidian vault', sub: '@laikacms/obsidian', icon: { si: 'obsidian' } },
  ],
};

export const CATALOGUE_SERIALIZERS: Omit<BackendGroupData, 'id'> = {
  label: 'Serializers',
  via: 'the on-disk format',
  note: 'Store content as whatever reads best in a diff, independent of the backend.',
  items: [
    { name: 'JSON', sub: 'storage-serializers-json', icon: { svg: 'braces' } },
    { name: 'YAML', sub: 'storage-serializers-yaml', icon: { svg: 'yaml' } },
    { name: 'Markdown', sub: 'storage-serializers-markdown', icon: { si: 'markdown' } },
    { name: 'Raw', sub: 'storage-serializers-raw', icon: { svg: 'file' } },
  ],
};

const FOOTNOTE = {
  text: 'Adapters are small.',
  linkLabel: 'Write one for your store ↗',
  href: 'https://github.com/laikacms/laikacms',
};

const groups: Omit<BackendGroupData, 'id'>[] = [...LAIKA_GROUPS, CATALOGUE_ASSETS, CATALOGUE_SERIALIZERS];

export function Backends() {
  return (
    <div className="mt-12 flex flex-col gap-11">
      {groups.map(g => <BackendGroup key={g.label} label={g.label} via={g.via} note={g.note} items={g.items} />)}

      <p className="mt-2 text-[13px] text-ink-3 font-mono">
        {FOOTNOTE.text}{' '}
        <a className="text-indigo" href={FOOTNOTE.href} target="_blank" rel="noreferrer">
          {FOOTNOTE.linkLabel}
        </a>
      </p>
    </div>
  );
}
