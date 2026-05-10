export interface DirSubDir {
  type: 'dir';
  path: string;
}

export interface DirSubFile {
  type: 'file';
  path: string;
}

export type DirSub = DirSubDir | DirSubFile;

export interface File {
  type: 'file';
  path: string;
  content: string;
}

export interface Dir {
  type: 'dir';
  path: string;
  content: DirSub[];
}

export type FileOrDir = File | Dir;
