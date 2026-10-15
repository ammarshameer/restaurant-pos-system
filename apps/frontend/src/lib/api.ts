import axios, { AxiosInstance, AxiosError } from 'axios';
import { network, isNetworkError } from './offline/network';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_URL,
      // Keep requests short so the POS can fall back to offline mode quickly
      // when the server is unreachable.
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor to add auth token
    this.client.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem('auth_token');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor for error handling + connectivity detection
    this.client.interceptors.response.use(
      (response) => {
        // Any successful round-trip means we have a working connection.
        network.set(true);
        return response;
      },
      (error: AxiosError) => {
        // A request that never reached the server means we are offline.
        if (isNetworkError(error)) {
          network.set(false);
        }
        if (error.response?.status === 401) {
          const hadToken = Boolean(localStorage.getItem('auth_token'));
          localStorage.removeItem('auth_token');
          localStorage.removeItem('auth_user');
          if (hadToken && window.location.pathname !== '/login') {
            window.location.replace('/login');
          }
        }
        return Promise.reject(error);
      }
    );
  }

  async get<T>(url: string, params?: any): Promise<T> {
    const response = await this.client.get<T>(url, { params });
    return response.data;
  }

  async post<T>(url: string, data?: any): Promise<T> {
    const response = await this.client.post<T>(url, data);
    return response.data;
  }

  async patch<T>(url: string, data?: any): Promise<T> {
    const response = await this.client.patch<T>(url, data);
    return response.data;
  }

  async delete<T>(url: string): Promise<T> {
    const response = await this.client.delete<T>(url);
    return response.data;
  }
}

export const api = new ApiClient();