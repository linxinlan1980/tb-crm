import type { Actor } from './actor';
export function roleAuthority(
  roles: readonly { code: string; permissions: unknown; dataScope: string }[],
): Pick<Actor, 'roles' | 'permissions' | 'dataScope'> {
  const scopes = ['all', 'dept', 'team', 'custom', 'self'] as const;
  return {
    roles: roles.map((role) => role.code),
    permissions: [
      ...new Set(
        roles.flatMap((role) =>
          Array.isArray(role.permissions)
            ? role.permissions.filter((value): value is string => typeof value === 'string')
            : [],
        ),
      ),
    ],
    dataScope: scopes.find((scope) => roles.some((role) => role.dataScope === scope)) ?? 'self',
  };
}
