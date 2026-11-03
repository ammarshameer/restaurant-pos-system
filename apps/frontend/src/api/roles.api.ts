import { api } from '../lib/api';
import { Permission, PermissionModule } from '../types/permissions';

export interface RoleItem {
  id: string;
  restaurantId: string;
  key: string;
  name: string;
  description?: string;
  isSystem: boolean;
  isOwnerRole: boolean;
  employeeCount: number;
  permissions: Permission[];
  createdAt: string;
  updatedAt: string;
}

export const rolesApi = {
  getPermissionsCatalogue: async (): Promise<{ modules: PermissionModule[]; permissions: Permission[] }> => {
    return api.get('/permissions');
  },

  getRoles: async (): Promise<RoleItem[]> => {
    return api.get('/roles');
  },

  createRole: async (data: {
    name: string;
    description?: string;
    permissions: Permission[];
    key?: string;
  }): Promise<RoleItem> => {
    return api.post('/roles', data);
  },

  updateRole: async (
    id: string,
    data: {
      name?: string;
      description?: string;
      permissions?: Permission[];
    }
  ): Promise<RoleItem> => {
    return api.patch(`/roles/${id}`, data);
  },

  deleteRole: async (id: string): Promise<void> => {
    return api.delete(`/roles/${id}`);
  },
};

