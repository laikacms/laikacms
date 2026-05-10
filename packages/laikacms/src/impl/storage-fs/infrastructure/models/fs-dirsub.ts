export interface FsFileSummary {
  path: string;
  type: 'file';
}
export interface FsDirSummary {
  path: string;
  type: 'dir';
}

export type FsDirSub = FsFileSummary | FsDirSummary;

export interface FsFile {
  path: string;
  type: 'file';
  content: string;
}
export interface FsDir {
  path: string;
  type: 'dir';
  content: FsDirSub[];
}
