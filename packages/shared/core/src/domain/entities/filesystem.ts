
export interface IFileSystemSerialized {
  _id: string;
  name: string;
  description?: string;

  basePath: string;
  projectId: string;
  ownerId: string;
  
  createdAt: Date;
  updatedAt: Date;
  archivedAt?: Date;
  deletedAt?: Date;
}