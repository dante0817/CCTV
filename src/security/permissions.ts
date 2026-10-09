import type { UserRole } from '../types/cctv';

export type Permission =
  | 'camera:view'
  | 'camera:create'
  | 'camera:update'
  | 'camera:delete'
  | 'camera:restart'
  | 'recording:view'
  | 'recording:manage'
  | 'recording:download'
  | 'recording:delete'
  | 'event:view'
  | 'notification:view'
  | 'notification:manage'
  | 'user:view'
  | 'user:create'
  | 'user:update'
  | 'user:disable'
  | 'camera_access:manage'
  | 'system:view'
  | 'system:configure'
  | 'audit:view'
  | 'session:manage'
  | 'account:view'
  | 'ai:use';

const ADMIN_PERMISSIONS: readonly Permission[] = [
  'camera:view',
  'camera:create',
  'camera:update',
  'camera:delete',
  'camera:restart',
  'recording:view',
  'recording:manage',
  'recording:download',
  'recording:delete',
  'event:view',
  'notification:view',
  'notification:manage',
  'user:view',
  'user:create',
  'user:update',
  'user:disable',
  'camera_access:manage',
  'system:view',
  'system:configure',
  'audit:view',
  'session:manage',
  'account:view',
  'ai:use',
];

const VIEWER_PERMISSIONS: readonly Permission[] = [
  'camera:view',
  'recording:view',
  'account:view',
  'ai:use',
];

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  Admin: ADMIN_PERMISSIONS,
  Viewer: VIEWER_PERMISSIONS,
};

export function permissionsForRole(role: UserRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role] || [];
}

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}
