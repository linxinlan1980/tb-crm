import type { Prisma } from '@prisma/client';
import type { Actor } from '../../common/types/actor';
/** Shared web/tool customer policy. Teams follow current owner membership, not stale stored department labels. */
export function customerVisibility(
  actor: Actor,
  teamUserIds?: number[],
  publicVisible = true,
): Prisma.CustomerWhereInput {
  if (actor.roles.includes('super_admin') || actor.roles.includes('gm')) return {};
  const own: Prisma.CustomerWhereInput =
    actor.roles.includes('sales_manager') && teamUserIds ? { ownerId: { in: teamUserIds } } : { ownerId: actor.userId };
  return publicVisible ? { OR: [{ poolType: 'public' }, own] } : own;
}
