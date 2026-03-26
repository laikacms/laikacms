export const Role = {
    Owner: 'owner',
    Admin: 'admin',
    Editor: 'editor',
    Author: 'author',
    Guest: 'guest',
}

export type Role = typeof Role[keyof typeof Role];

export const RoleDescriptions: Record<Role, string> = {
    [Role.Owner]: "Is the owner of the project. Can manage all settings and content.",
    [Role.Admin]: "Full access to all project settings and content. Can manage users and their roles.",
    [Role.Editor]: "Can create, edit, and publish all types of content. Cannot modify project settings or manage users.",
    [Role.Author]: "Can create and edit their own content, but cannot publish without approval from an Editor or Admin.",
    [Role.Guest]: "Read-only access to published content. Cannot create, edit, or publish any content.",
};