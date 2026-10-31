import axios from 'axios';
import { useAuthStore } from '../stores/useAuthStore';

/**
 * 统一HTTP请求封装
 * - 自动注入Bearer Token
 * - 401自动跳转登录
 * - 统一错误处理
 */
const request = axios.create({
  baseURL: '/api/v1',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor: inject JWT
request.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: unwrap data + handle errors
request.interceptors.response.use(
  (response) => {
    const body = response.data;
    // 统一响应格式: { code: 0, data: T, message: string, meta?: object }
    if (body.code === 0) {
      return body.data !== undefined ? body.data : body;
    }
    return Promise.reject(new Error(body.message || '请求失败'));
  },
  (error) => {
    const status = error.response?.status;
    const body = error.response?.data;

    if (status === 401) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
      return Promise.reject(error);
    }

    const message = body?.message || error.message || '网络异常';
    return Promise.reject({ ...error, message, code: body?.code, data: body?.data });
  },
);

export default request;
