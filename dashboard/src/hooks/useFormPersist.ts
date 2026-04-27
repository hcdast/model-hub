import { useEffect, useCallback } from 'react';

/**
 * 表单数据持久化 Hook
 * 在发生错误或页面刷新时保留用户输入
 */
export function useFormPersist<T>(
  key: string,
  value: T,
  enabled: boolean = true,
): {
  restore: () => T | null;
  clear: () => void;
} {
  // 保存数据到 sessionStorage
  useEffect(() => {
    if (!enabled) return;

    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error('Failed to persist form data:', error);
    }
  }, [key, value, enabled]);

  // 恢复数据
  const restore = useCallback((): T | null => {
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) {
        return JSON.parse(stored) as T;
      }
    } catch (error) {
      console.error('Failed to restore form data:', error);
    }
    return null;
  }, [key]);

  // 清除数据
  const clear = useCallback(() => {
    try {
      sessionStorage.removeItem(key);
    } catch (error) {
      console.error('Failed to clear form data:', error);
    }
  }, [key]);

  return { restore, clear };
}

/**
 * 自动恢复表单数据 Hook
 * 在组件挂载时自动恢复数据
 */
export function useFormAutoRestore<T>(
  key: string,
  defaultValue: T,
): [T, (value: T) => void, () => void] {
  const [value, setValue] = React.useState<T>(() => {
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) {
        return JSON.parse(stored) as T;
      }
    } catch (error) {
      console.error('Failed to restore form data:', error);
    }
    return defaultValue;
  });

  // 保存数据
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error('Failed to persist form data:', error);
    }
  }, [key, value]);

  // 清除数据
  const clear = useCallback(() => {
    try {
      sessionStorage.removeItem(key);
      setValue(defaultValue);
    } catch (error) {
      console.error('Failed to clear form data:', error);
    }
  }, [key, defaultValue]);

  return [value, setValue, clear];
}

// 导入 React（用于 useState）
import React from 'react';
