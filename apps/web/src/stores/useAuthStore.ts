import { create } from 'zustand';

interface UserInfo {
  id: number;
  name: string;
  username: string;
  avatar?: string;
  dept?: { id: number; name: string } | null;
  roles: string[];
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: UserInfo | null;
  setAuth: (accessToken: string, refreshToken: string, user: UserInfo) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: sessionStorage.getItem('accessToken'),
  refreshToken: sessionStorage.getItem('refreshToken'),
  user: JSON.parse(sessionStorage.getItem('user') || 'null'),

  setAuth: (accessToken, refreshToken, user) => {
    sessionStorage.setItem('accessToken', accessToken);
    sessionStorage.setItem('refreshToken', refreshToken);
    sessionStorage.setItem('user', JSON.stringify(user));
    set({ accessToken, refreshToken, user });
  },

  logout: () => {
    sessionStorage.removeItem('accessToken');
    sessionStorage.removeItem('refreshToken');
    sessionStorage.removeItem('user');
    set({ accessToken: null, refreshToken: null, user: null });
  },

  isAuthenticated: () => !!get().accessToken,
}));
