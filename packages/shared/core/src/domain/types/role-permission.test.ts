import { describe, expect, it } from 'vitest';
import { Permission, permissionDescriptions, rolePermissions } from './role-permission.js';
import { Role } from './role.js';

describe('rolePermissions', () => {
  it('defines a permission set for every role', () => {
    expect(rolePermissions[Role.Owner]).toBeDefined();
    expect(rolePermissions[Role.Admin]).toBeDefined();
    expect(rolePermissions[Role.Editor]).toBeDefined();
    expect(rolePermissions[Role.Author]).toBeDefined();
    expect(rolePermissions[Role.Guest]).toBeDefined();
  });

  it('Guest only has read permissions', () => {
    expect(rolePermissions[Role.Guest]).toEqual([Permission.ViewDocument, Permission.ViewCollection]);
  });

  it('Author extends Guest with content creation permissions', () => {
    const author = rolePermissions[Role.Author];
    for (const p of rolePermissions[Role.Guest]) expect(author).toContain(p);
    expect(author).toContain(Permission.CreateDocument);
    expect(author).toContain(Permission.EditDocument);
    expect(author).toContain(Permission.PublishDocument);
    expect(author).not.toContain(Permission.DeleteDocument);
    expect(author).not.toContain(Permission.ManageSettings);
  });

  it('Editor extends Author with delete + collection management', () => {
    const editor = rolePermissions[Role.Editor];
    for (const p of rolePermissions[Role.Author]) expect(editor).toContain(p);
    expect(editor).toContain(Permission.DeleteDocument);
    expect(editor).toContain(Permission.ManageCollections);
    expect(editor).not.toContain(Permission.ManageSettings);
    expect(editor).not.toContain(Permission.ManageUsers);
  });

  it('Admin extends Editor with settings + user management', () => {
    const admin = rolePermissions[Role.Admin];
    for (const p of rolePermissions[Role.Editor]) expect(admin).toContain(p);
    expect(admin).toContain(Permission.ManageSettings);
    expect(admin).toContain(Permission.ManageUsers);
  });

  it('Owner has every permission Admin has', () => {
    const owner = rolePermissions[Role.Owner];
    for (const p of rolePermissions[Role.Admin]) expect(owner).toContain(p);
  });
});

describe('permissionDescriptions', () => {
  it('describes every Permission enum value', () => {
    for (const p of Object.values(Permission)) {
      expect(permissionDescriptions[p]).toBeTruthy();
      expect(typeof permissionDescriptions[p]).toBe('string');
    }
  });
});
