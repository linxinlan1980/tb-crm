export function menuAccess(path: string, permissions: string[], administrator: boolean) {
  if (administrator) return true;
  const has = (point: string) => permissions.some((p) => [point, '*', point.split(':')[0] + ':*'].includes(p));
  if (path === '/calendar') return has('action:read') || ['approval:read','approval:create','approval:approve','approval:reject','approval:withdraw'].some(has);
  if (path === '/analytics') return has('opportunity:read') || (has('finance:read') && has('contract:read'));
  const map: Record<string, string> = {
    '/customers': 'customer:read',
    '/contacts': 'customer:read',
    '/pool/public': 'customer:read',
    '/pool/private': 'customer:read',
    '/customer-operations': 'customer:assign',
    '/customer-allocation': 'customer:assign',
    '/leads': 'lead:read',
    '/followups': 'follow_up:read',
    '/actions': 'action:read',
    '/opportunities': 'opportunity:read',
    '/opportunities/board': 'opportunity:read',
    '/products': 'product:read',
    '/contracts': 'contract:read',
    '/orders': 'order:read',
    '/projects': 'project:read',
    '/tasks': 'project:read',
    '/service-tickets': 'project:read',
    '/finance/ledger': 'finance:read',
    '/finance/payment-plans': 'finance:read',
    '/invoices': 'finance:read',
    '/receipts': 'finance:read',
    '/finance/aging': 'finance:read',
  };
  return !map[path] || has(map[path]);
}
