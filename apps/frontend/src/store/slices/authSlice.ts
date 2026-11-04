import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  roleId?: string;
  roleName?: string;
  restaurantId: string;
  restaurantName?: string;
  restaurantSlug?: string;
  restaurantLogoUrl?: string | null;
  permissions?: string[];
  supportMode?: boolean;
  impersonatedBy?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
}

const getInitialAuthState = (): AuthState => {
  if (typeof localStorage === 'undefined') {
    return { user: null, token: null, isAuthenticated: false, loading: false, error: null };
  }
  try {
    const token = localStorage.getItem('auth_token');
    const storedUser = localStorage.getItem('auth_user');
    const user = storedUser ? JSON.parse(storedUser) as User : null;
    if (token && user) {
      return { user, token, isAuthenticated: true, loading: false, error: null };
    }
  } catch {
    // Invalid cached auth is handled by the API session guards.
  }
  return { user: null, token: null, isAuthenticated: false, loading: false, error: null };
};

const initialState: AuthState = {
  ...getInitialAuthState(),
  loading: false,
  error: null,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    loginSuccess: (state, action: PayloadAction<{ user: User; token: string }>) => {
      state.user = action.payload.user;
      state.token = action.payload.token;
      state.isAuthenticated = true;
      state.loading = false;
      state.error = null;
    },
    loginFailure: (state, action: PayloadAction<string>) => {
      state.user = null;
      state.token = null;
      state.isAuthenticated = false;
      state.loading = false;
      state.error = action.payload;
    },
    logout: (state) => {
      state.user = null;
      state.token = null;
      state.isAuthenticated = false;
      state.error = null;
    },
    clearError: (state) => {
      state.error = null;
    },
  },
});

export const { loginSuccess, loginFailure, logout, clearError } = authSlice.actions;

export default authSlice.reducer;
