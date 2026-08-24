import { useCallback, useEffect, useRef } from 'react';
import { useReactFlow } from 'reactflow';

interface Props {
  loading?: boolean;
  nodeCount: number;
  selectedNodeId?: string | null;
}

const FIT_OPTIONS = {
  padding: 0.18,
  duration: 320,
  maxZoom: 1.4,
  minZoom: 0.15,
};

/** 根据画布节点自动缩放视口 */
export default function AutoFitView({ loading, nodeCount, selectedNodeId }: Props) {
  const { fitView, setViewport, getNodes } = useReactFlow();
  const prevCountRef = useRef(nodeCount);
  const hasInitialFitRef = useRef(false);
  const prevSelectedRef = useRef<string | null>(null);

  const runFit = useCallback((nodeIds?: string[], padding = FIT_OPTIONS.padding) => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        const currentNodes = getNodes();
        if (currentNodes.length === 0) {
          setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 200 });
          return;
        }
        fitView({
          ...FIT_OPTIONS,
          padding,
          nodes: nodeIds?.map((id) => ({ id })),
        });
      }, 100);
    });
  }, [fitView, setViewport, getNodes]);

  // 工作流加载完成 / 节点增删
  useEffect(() => {
    if (loading) return;

    const timer = setTimeout(() => {
      const countChanged = nodeCount !== prevCountRef.current;
      const isInitial = !hasInitialFitRef.current;

      if (isInitial || countChanged) {
        prevCountRef.current = nodeCount;
        hasInitialFitRef.current = true;
        runFit(undefined, isInitial ? 0.22 : FIT_OPTIONS.padding);
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [loading, nodeCount, runFit]);

  // 节点选中展开后聚焦，确保控制面板完整可见
  useEffect(() => {
    if (loading) return;

    if (selectedNodeId) {
      const timer = setTimeout(() => runFit([selectedNodeId], 0.3), 260);
      prevSelectedRef.current = selectedNodeId;
      return () => clearTimeout(timer);
    }

    // 取消选中时恢复全览
    if (prevSelectedRef.current) {
      prevSelectedRef.current = null;
      const timer = setTimeout(() => runFit(undefined, FIT_OPTIONS.padding), 200);
      return () => clearTimeout(timer);
    }
  }, [selectedNodeId, loading, runFit]);

  return null;
}

export const manualFitViewOptions = FIT_OPTIONS;
