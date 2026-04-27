import { useAuthStore } from '../store/auth';

export function usePermission() {
  const permissions = useAuthStore((s) => s.permissions);
  const roles = useAuthStore((s) => s.roles);

  const isSuperAdmin = roles.includes('super_admin');

  const hasPermission = (code: string): boolean => {
    if (isSuperAdmin) return true;
    if (permissions.includes('*')) return true;
    return permissions.includes(code);
  };

  const hasAnyPermission = (codes: string[]): boolean => {
    if (isSuperAdmin) return true;
    if (permissions.includes('*')) return true;
    return codes.some((code) => permissions.includes(code));
  };

  return { hasPermission, hasAnyPermission, permissions };
}
