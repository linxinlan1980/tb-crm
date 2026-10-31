import type { Prisma } from '@prisma/client';
import type { Actor } from '../../common/types/actor';

/** Public customers are visible for claiming; private customers obey the caller's scope. */
export function customerVisibility(actor: Actor): Prisma.CustomerWhereInput {
  if (actor.roles.includes('super_admin') || actor.dataScope === 'all') return {};
  if (['team', 'dept'].includes(actor.dataScope) && actor.deptId !== null) {
    return { OR: [{ poolType: 'public' }, { ownerId: actor.userId }, { ownerDeptId: actor.deptId }] };
  }
  // Custom collaboration scopes are not implemented yet: fall back to own records.
  return { OR: [{ poolType: 'public' }, { ownerId: actor.userId }] };
}
