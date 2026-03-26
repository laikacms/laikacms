import { Role } from "./role.js";

export enum Permission {
    ManageSettings = 'manage_settings',

    ManageUsers = 'manage_users',

    CreateDocument = 'create_document',
    EditDocument = 'edit_document',
    PublishDocument = 'publish_document',
    DeleteDocument = 'delete_document',
    ViewDocument = 'view_document',

    ManageCollections = 'manage_collections',
    ViewCollection = 'view_collection',
}

export const permissionDescriptions: Record<Permission, string> = {
    [Permission.ManageSettings]: 'Allows users to modify and manage system or application settings, including configurations that affect the entire platform.',
    [Permission.ManageUsers]: 'Grants the ability to manage user accounts, including creating, editing, and deleting users, as well as assigning roles and permissions.',

    // Document Permissions
    [Permission.CreateDocument]: 'Allows users to create new documents in the system.',
    [Permission.EditDocument]: 'Grants the ability to edit or modify existing documents.',
    [Permission.PublishDocument]: 'Enables users to publish documents, making them publicly available or accessible to others.',
    [Permission.DeleteDocument]: 'Provides the ability to permanently delete documents from the system.',
    [Permission.ViewDocument]: 'Grants permission to view documents, but without the ability to edit, publish, or delete them.',

    // Collection Permissions
    [Permission.ManageCollections]: 'Allows users to create, edit, or delete collections of documents, as well as configure how collections are organized.',
    [Permission.ViewCollection]: 'Grants read-only access to view collections of documents, but without the ability to modify them.',
};

const guestPermissions = [
    Permission.ViewDocument,
    Permission.ViewCollection,
];

const authorPermissions = [
    ...guestPermissions,
    Permission.CreateDocument,
    Permission.EditDocument,
    Permission.PublishDocument,
];

const editorPermissions = [
    ...authorPermissions,
    Permission.DeleteDocument,
    Permission.ManageCollections,
];

const adminPermissions = [
    ...editorPermissions,
    Permission.ManageSettings,
    Permission.ManageUsers,
];

const ownerPermissions = [
    ...adminPermissions
]

export const rolePermissions = {
    [Role.Owner]: ownerPermissions,
    [Role.Admin]: adminPermissions,
    [Role.Editor]: editorPermissions,
    [Role.Author]: authorPermissions,
    [Role.Guest]: guestPermissions,
};
