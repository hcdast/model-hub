import { Node } from 'reactflow';

/** 节点占位尺寸（含展开面板预留） */
const NODE_WIDTH = 300;
const NODE_HEIGHT = 200;
const GAP = 48;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w + GAP
    && a.x + a.w + GAP > b.x
    && a.y < b.y + b.h + GAP
    && a.y + a.h + GAP > b.y
  );
}

function nodeToRect(node: Node): Rect {
  return {
    x: node.position.x,
    y: node.position.y,
    w: NODE_WIDTH,
    h: NODE_HEIGHT,
  };
}

function isFree(pos: { x: number; y: number }, existing: Node[]): boolean {
  const candidate: Rect = { x: pos.x, y: pos.y, w: NODE_WIDTH, h: NODE_HEIGHT };
  return !existing.some((n) => overlaps(candidate, nodeToRect(n)));
}

/**
 * 从锚点出发按网格搜索不重叠的位置
 */
export function findNonOverlappingPosition(
  anchor: { x: number; y: number },
  existingNodes: Node[],
): { x: number; y: number } {
  if (existingNodes.length === 0) {
    return anchor;
  }

  const stepX = NODE_WIDTH + GAP;
  const stepY = NODE_HEIGHT + GAP;

  // 优先从左到右、从上到下网格排列
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 5; col++) {
      const pos = { x: anchor.x + col * stepX, y: anchor.y + row * stepY };
      if (isFree(pos, existingNodes)) {
        return pos;
      }
    }
  }

  // 兜底：按已有节点数量偏移
  const n = existingNodes.length;
  return {
    x: anchor.x + (n % 5) * stepX,
    y: anchor.y + Math.floor(n / 5) * stepY,
  };
}

/** 获取当前视口中心（画布坐标） */
export function getViewportCenter(
  viewport: { x: number; y: number; zoom: number },
  containerWidth: number,
  containerHeight: number,
): { x: number; y: number } {
  return {
    x: (containerWidth / 2 - viewport.x) / viewport.zoom - NODE_WIDTH / 2,
    y: (containerHeight / 2 - viewport.y) / viewport.zoom - NODE_HEIGHT / 2,
  };
}

/** 在参考位置附近找不重叠点（用于复制/粘贴/副本） */
export function findNearbyPosition(
  reference: { x: number; y: number },
  existingNodes: Node[],
): { x: number; y: number } {
  const anchor = {
    x: reference.x + NODE_WIDTH + GAP,
    y: reference.y,
  };
  return findNonOverlappingPosition(anchor, existingNodes);
}
