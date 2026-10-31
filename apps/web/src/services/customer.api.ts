import request from './request';

export interface CustomerQuery {
  page?: number; pageSize?: number; pool_type?: string; industry?: string;
  level?: string; owner_id?: number; status?: string; keyword?: string;
  tag?: string; sort?: string; order?: 'asc' | 'desc';
}

export const customerApi = {
  list: (params: CustomerQuery) => request.get('/customers', { params }),
  detail: (id: number) => request.get(`/customers/${id}`),
  create: (data: any) => request.post('/customers', data),
  update: (id: number, data: any) => request.put(`/customers/${id}`, data),
  remove: (id: number) => request.delete(`/customers/${id}`),
  checkDuplicate: (data: { name?: string; creditCode?: string }) => request.post('/customers/check-duplicate', data),
  groupTree: () => request.get('/customers/group-tree'),
  statistics: (id: number) => request.get(`/customers/${id}/statistics`),
  // 联系人
  contacts: (customerId: number) => request.get(`/customers/${customerId}/contacts`),
  createContact: (customerId: number, data: any) => request.post(`/customers/${customerId}/contacts`, data),
  updateContact: (id: number, data: any) => request.put(`/contacts/${id}`, data),
  removeContact: (id: number) => request.delete(`/contacts/${id}`),
};
