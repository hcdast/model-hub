import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Table as AntTable, Button, Drawer } from 'antd';
import type { TableProps } from 'antd';
import type { ColumnType, ColumnsType } from 'antd/es/table';

type Row = Record<string, any>;
type AdminTableProps<T extends Row> = TableProps<T> & { columnPriority?: string[] };
const label = (column: ColumnType<any>) => typeof column.title === 'string' ? column.title : String(column.key || column.dataIndex || '字段');
const isAction = (column: ColumnType<any>) => /操作|详情/.test(label(column)) || /^(actions?|act)$/.test(String(column.key));
const isStatus = (column: ColumnType<any>) => /状态|启用|开关/.test(label(column));
const isIdentity = (column: ColumnType<any>) => ['account_alias', 'account_id', 'taskId', 'code', 'email', 'name', 'model_id', 'queueName'].includes(String(column.dataIndex || column.key));
const weight = (column: ColumnType<any>) => Math.max(64, Math.min(isAction(column) ? 210 : 230, typeof column.width === 'number' ? column.width : 170));
function valueAt(row: Row, index: any) {
  if (index === undefined) return undefined;
  return (Array.isArray(index) ? index : [index]).reduce((value: any, key) => value?.[key], row);
}
function cellContent(node: any): ReactNode {
  // Some grouped lists still use Ant Design's legacy RenderedCell rowSpan contract.
  if (node && typeof node === 'object' && 'props' in node && 'children' in node && !('type' in node)) return node.children;
  if (node == null) return '—';
  if (typeof node === 'string' || typeof node === 'number') return <span className={String(node).length > 100 ? 'admin-table-long-value' : undefined} title={String(node)}>{node}</span>;
  return node;
}

/** Lists fit their container. Narrow layouts move secondary fields into explicit row details. */
export default function AdminTable<T extends Row = Row>({ columns = [], scroll, className, expandable, columnPriority, ...props }: AdminTableProps<T>) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const [detail, setDetail] = useState<{ record: T; index: number }>();
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const leafColumns = columns as ColumnType<T>[];
  // Preserve grouped headers; row details do not interfere with tree expansion or merged rows.
  const canCollapse = !columns.some(column => 'children' in column);
  const limit = width < 520 ? (columnPriority ? 5 : 3) : width < 760 ? 5 : width < 960 ? 7 : columns.length;
  const required = columnPriority
    ? new Set(leafColumns.filter(column => columnPriority.slice(0, limit).includes(String(column.key || column.dataIndex))))
    : new Set(leafColumns.filter((column, index) => index === 0 || isIdentity(column) || isAction(column) || isStatus(column) || !!column.sorter || !!column.filters));
  const visible = canCollapse && columns.length > limit
    ? leafColumns.filter(column => required.has(column) || required.size < limit && (required.add(column), true))
    : leafColumns;
  const hidden = leafColumns.filter(column => !visible.includes(column));
  const keyOf = (record: T, index: number) => typeof props.rowKey === 'function' ? props.rowKey(record, index) : record[props.rowKey || 'key'];
  // Editable cells replace their source record. Details must read that new value too.
  const detailRecord = detail && (props.dataSource?.find((record, index) => {
    const key = keyOf(detail.record, detail.index);
    return key === undefined ? record === detail.record : keyOf(record, index) === key;
  }) || detail.record);
  const totalWeight = visible.reduce((sum, column) => sum + weight(column), hidden.length ? 84 : 0);
  const fitted = visible.map((column): ColumnType<T> => ({
    ...column, fixed: undefined, minWidth: undefined, ellipsis: false,
    width: `${weight(column) / totalWeight * 100}%`,
    className: [column.className, isAction(column) ? 'admin-table-actions' : '', column.sorter || column.filters ? 'admin-table-interactive-heading' : ''].filter(Boolean).join(' '),
    onCell: (record, index) => ({ ...column.onCell?.(record, index), 'data-label': label(column) }),
    render: (value, record, index) => {
      const result: any = column.render ? column.render(value, record, index) : value;
      if (result && typeof result === 'object' && 'props' in result && 'children' in result && !('type' in result)) return { ...result, children: <div className="admin-table-cell-value">{cellContent(result.children)}</div> };
      return <div className="admin-table-cell-value">{cellContent(result)}</div>;
    },
  }));
  if (hidden.length) fitted.push({ key: '__more_fields', title: '更多字段', width: `${84 / totalWeight * 100}%`, onCell: () => ({ 'data-label': '更多字段' } as any), render: (_, record, index) => <div className="admin-table-cell-value"><Button type="link" size="small" aria-label="查看更多字段" onClick={() => setDetail({ record, index })}>字段</Button></div> });
  return <div ref={container} className={`admin-table-container${width < 520 && canCollapse ? ' admin-table-compact' : ''}`}><AntTable<T> {...props} className={['admin-fit-table', className].filter(Boolean).join(' ')}
    columns={fitted as ColumnsType<T>} tableLayout="fixed" scroll={scroll?.y ? { y: scroll.y } : undefined}
    expandable={expandable} rowSelection={props.rowSelection ? { ...props.rowSelection, columnWidth: 36, fixed: false } : undefined} />
    <Drawer title="更多字段" open={!!detail} width={520} onClose={() => setDetail(undefined)}>
      {detail && detailRecord && <dl className="admin-table-details">{hidden.map((column, columnIndex) => <div key={String(column.key || column.dataIndex || columnIndex)}><dt>{label(column)}</dt><dd>{cellContent(column.render ? column.render(valueAt(detailRecord, column.dataIndex), detailRecord, detail.index) : valueAt(detailRecord, column.dataIndex))}</dd></div>)}</dl>}
    </Drawer>
  </div>;
}
