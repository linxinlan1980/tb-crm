import request from './request';

export interface LoginParams {
  tenantCode?: string;
  username: string;
  password: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: number;
    name: string;
    username: string;
    avatar?: string;
    dept?: { id: number; name: string } | null;
    roles: string[];
    company?: { code: string; name: string; purpose: 'test' | 'business' };
  };
}

export const authApi = {
  login: (params: LoginParams): Promise<LoginResult> =>
    request.post('/auth/login', params, { headers: { 'X-Company-Code': params.tenantCode ?? '' } }),

  dingtalkLogin: (authCode: string): Promise<LoginResult> =>
    request.post('/auth/dingtalk/login', { authCode }),

  refresh: (refreshToken: string): Promise<LoginResult> =>
    request.post('/auth/refresh', { refreshToken }),

  getMe: () => request.get('/auth/me'),

  logout: () => request.post('/auth/logout'),
};
