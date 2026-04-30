import { useState, useEffect, useCallback, useRef } from 'react';

interface UseRequestOptions {
  /** 是否手动触发（默认 false，自动执行） */
  manual?: boolean;
  /** 依赖数组，变化时重新执行（仅 manual=false 时生效） */
  deps?: any[];
  /** 轮询间隔（毫秒），0 表示不轮询 */
  pollingInterval?: number;
}

interface UseRequestResult<T> {
  /** 请求返回的数据 */
  data: T | undefined;
  /** 是否正在加载 */
  loading: boolean;
  /** 错误信息 */
  error: Error | undefined;
  /** 手动触发/重新执行请求 */
  refresh: () => Promise<void>;
  /** 手动更新 data（不触发请求） */
  mutate: (data: T | undefined) => void;
}

/**
 * 轻量级通用数据请求 Hook
 * 管理异步数据获取的 loading/error 状态
 *
 * @param fetcher 异步数据获取函数
 * @param options 配置选项
 * @returns 请求结果（data、loading、error）及操作方法（refresh、mutate）
 */
export function useRequest<T>(
  fetcher: () => Promise<T>,
  options?: UseRequestOptions,
): UseRequestResult<T> {
  const { manual = false, deps = [], pollingInterval = 0 } = options || {};

  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(!manual);
  const [error, setError] = useState<Error | undefined>(undefined);

  // 使用 ref 保存 fetcher，避免闭包陈旧问题
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // 标记组件是否已卸载，防止卸载后 setState
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  // 核心执行函数
  const run = useCallback(async () => {
    if (unmountedRef.current) return;

    setLoading(true);
    setError(undefined);

    try {
      const result = await fetcherRef.current();
      if (!unmountedRef.current) {
        setData(result);
      }
    } catch (err) {
      if (!unmountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (!unmountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // 自动执行：非手动模式下，挂载时及 deps 变化时执行
  useEffect(() => {
    if (!manual) {
      run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manual, ...deps]);

  // 轮询：pollingInterval > 0 时启动定时器
  useEffect(() => {
    if (pollingInterval > 0) {
      const timer = setInterval(() => {
        run();
      }, pollingInterval);
      return () => clearInterval(timer);
    }
  }, [pollingInterval, run]);

  // 手动触发/刷新
  const refresh = useCallback(async () => {
    await run();
  }, [run]);

  // 手动更新 data（不触发请求）
  const mutate = useCallback((newData: T | undefined) => {
    setData(newData);
  }, []);

  return { data, loading, error, refresh, mutate };
}
