import { useId } from 'react';

/**
 * 侧栏 / 登录页共用的极简品牌图形：抽象「节点 + 连接」，暗示模型路由与中台。
 */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  const gid = useId().replace(/:/g, '');
  const gradId = `brandMarkGrad-${gid}`;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#22d3ee" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="8" r="3" fill={`url(#${gradId})`} />
      <circle cx="8" cy="22" r="3" fill={`url(#${gradId})`} opacity={0.85} />
      <circle cx="24" cy="22" r="3" fill={`url(#${gradId})`} opacity={0.85} />
      <path
        d="M16 11v6M16 17l-6 3M16 17l6 3"
        stroke={`url(#${gradId})`}
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity={0.9}
      />
    </svg>
  );
}
