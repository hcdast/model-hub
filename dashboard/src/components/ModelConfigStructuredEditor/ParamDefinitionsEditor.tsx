import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  Divider,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Typography,
  Modal,
  Row,
  Col,
} from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import type {
  ParamDefinitions,
  ParamDefinition,
  ParamType,
  ParamUIType,
} from '@model-hub/common/interfaces/param-definition.interface';
import {
  coerceUiType,
  defaultUiTypeForParamType,
  labeledUiOptionsForParamType,
  PARAM_TYPE_LABELS,
} from './paramUi';

const PARAM_TYPES: ParamType[] = ['string', 'number', 'boolean', 'array'];

export interface ParamRow {
  key: string;
  label: string;
  type: ParamType;
  ui_type: ParamUIType;
  required: boolean;
  description: string;
  defaultStr: string;
  /** 枚举项逐行编辑（与 type 一致时写入 enum） */
  enumStrings: string[];
  minStr: string;
  maxStr: string;
  minLengthStr: string;
  maxLengthStr: string;
  minItemsStr: string;
  maxItemsStr: string;
  hide: boolean;
  skipValidation: boolean;
  third_party_field: string;
  /** 枚举联动：依赖的参数字段名 */
  enumDependsParam: string;
  /** 枚举联动：JSON 对象，键为依赖字段取值，值为允许的本字段 enum 子集 */
  enumDependsMapJson: string;
}

function safeJsonStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return '';
  }
}

/** 从旧版 configs 仅提取 value 作为枚举迁移展示 */
function enumStringsFromDefinition(def: ParamDefinition): string[] {
  const fromEnum = def.enum;
  if (Array.isArray(fromEnum) && fromEnum.length > 0) {
    return fromEnum.map((v) => String(v));
  }
  const legacy = (def as { configs?: { value?: unknown }[] }).configs;
  if (Array.isArray(legacy) && legacy.length > 0) {
    return legacy
      .map((c) => (c && typeof c === 'object' && 'value' in c ? c.value : undefined))
      .filter((v) => v !== undefined)
      .map((v) => String(v));
  }
  return [];
}

/** 是否已配置高级选项内容 */
export function rowHasAdvancedContent(row: ParamRow): boolean {
  if (row.hide) return true;
  if (row.skipValidation) return true;
  if (row.third_party_field.trim()) return true;
  if (row.enumDependsParam.trim()) return true;
  if (row.enumDependsMapJson.trim()) return true;
  return false;
}

function defToRow(paramKey: string, def: ParamDefinition): ParamRow {
  const t = def.type ?? 'string';
  const ui = coerceUiType(t, def.ui_type);
  const ed = def.enumDependsOn;
  return {
    key: paramKey,
    label: def.label ?? '',
    type: t,
    ui_type: ui,
    required: !!def.required,
    description: def.description ?? '',
    defaultStr:
      def.default === undefined || def.default === null
        ? ''
        : typeof def.default === 'object'
          ? safeJsonStringify(def.default)
          : String(def.default),
    enumStrings: enumStringsFromDefinition(def),
    minStr: def.min !== undefined && def.min !== null ? String(def.min) : '',
    maxStr: def.max !== undefined && def.max !== null ? String(def.max) : '',
    minLengthStr:
      def.minLength !== undefined && def.minLength !== null
        ? String(def.minLength)
        : '',
    maxLengthStr:
      def.maxLength !== undefined && def.maxLength !== null
        ? String(def.maxLength)
        : '',
    minItemsStr:
      def.minItems !== undefined && def.minItems !== null
        ? String(def.minItems)
        : '',
    maxItemsStr:
      def.maxItems !== undefined && def.maxItems !== null
        ? String(def.maxItems)
        : '',
    hide: !!def.hide,
    skipValidation: !!def.skipValidation,
    third_party_field: def.third_party_field ?? '',
    enumDependsParam: ed?.param ?? '',
    enumDependsMapJson: ed?.map ? safeJsonStringify(ed.map) : '',
  };
}

function rowsFromDefinitions(params: ParamDefinitions): ParamRow[] {
  return Object.entries(params).map(([k, def]) =>
    def && typeof def === 'object' && !Array.isArray(def)
      ? defToRow(k, def as ParamDefinition)
      : defToRow(k, {
          required: false,
          type: 'string',
        }),
  );
}

function parseNum(s: string): number | undefined {
  const t = s.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function parseIntMaybe(s: string): number | undefined {
  const t = s.trim();
  if (t === '') return undefined;
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : undefined;
}

function parseDefaultStr(type: ParamType, s: string): unknown {
  const t = s.trim();
  if (t === '') return undefined;
  try {
    if (type === 'array') return JSON.parse(t);
    if (type === 'number') {
      const n = Number(t);
      return Number.isFinite(n) ? n : undefined;
    }
    if (type === 'boolean') {
      if (t === 'true' || t === '1') return true;
      if (t === 'false' || t === '0') return false;
      return undefined;
    }
    return t;
  } catch {
    return undefined;
  }
}

function parseEnumStrings(
  type: ParamType,
  strings: string[],
): (string | number | boolean)[] {
  const out: (string | number | boolean)[] = [];
  const seen = new Set<string>();
  for (const raw of strings) {
    const t = raw.trim();
    if (t === '') continue;
    let v: string | number | boolean;
    if (type === 'number') {
      const n = Number(t);
      if (!Number.isFinite(n)) continue;
      v = n;
    } else if (type === 'boolean') {
      if (t === 'true') v = true;
      else if (t === 'false') v = false;
      else continue;
    } else {
      v = t;
    }
    const key = JSON.stringify(v);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function rowToDefinition(row: ParamRow, allKeys: string[]): ParamDefinition | null {
  const key = row.key.trim();
  if (!key) return null;

  const def: ParamDefinition = {
    required: row.required,
    type: row.type,
    ui_type: coerceUiType(row.type, row.ui_type),
  };

  if (row.label.trim()) def.label = row.label.trim();
  if (row.description.trim()) def.description = row.description.trim();
  if (row.third_party_field.trim())
    def.third_party_field = row.third_party_field.trim();

  const enumVals = parseEnumStrings(row.type, row.enumStrings);
  if (enumVals.length > 0) def.enum = enumVals;

  const d = parseDefaultStr(row.type, row.defaultStr);
  if (d !== undefined) def.default = d;

  if (row.type === 'number') {
    const min = parseNum(row.minStr);
    const max = parseNum(row.maxStr);
    if (min !== undefined) def.min = min;
    if (max !== undefined) def.max = max;
  }

  if (row.type === 'string') {
    const minL = parseIntMaybe(row.minLengthStr);
    const maxL = parseIntMaybe(row.maxLengthStr);
    if (minL !== undefined) def.minLength = minL;
    if (maxL !== undefined) def.maxLength = maxL;
  }

  if (row.type === 'array') {
    const mi = parseIntMaybe(row.minItemsStr);
    const ma = parseIntMaybe(row.maxItemsStr);
    if (mi !== undefined) def.minItems = mi;
    if (ma !== undefined) def.maxItems = ma;
  }

  if (row.hide) def.hide = true;
  if (row.skipValidation) def.skipValidation = true;

  const dep = row.enumDependsParam.trim();
  const mapRaw = row.enumDependsMapJson.trim();
  if (dep && mapRaw) {
    try {
      const map = JSON.parse(mapRaw) as unknown;
      if (map && typeof map === 'object' && !Array.isArray(map)) {
        def.enumDependsOn = {
          param: dep,
          map: map as Record<string, (string | number | boolean)[]>,
        };
      }
    } catch {
      /* skip invalid JSON */
    }
  } else if (dep && allKeys.includes(dep) && !mapRaw) {
    /* param set but empty map — omit */
  }

  return def;
}

function rowsToDefinitions(rows: ParamRow[]): ParamDefinitions {
  const keys = rows.map((r) => r.key.trim()).filter(Boolean);
  const out: ParamDefinitions = {};
  for (const row of rows) {
    const def = rowToDefinition(row, keys);
    if (def) out[row.key.trim()] = def;
  }
  return out;
}

function defaultValueForSelect(
  type: ParamType,
  defaultStr: string,
  enumParsed: (string | number | boolean)[],
): string | number | boolean | undefined {
  const d = parseDefaultStr(type, defaultStr);
  if (d === undefined) return undefined;
  if (enumParsed.length === 0) return undefined;
  const ok = enumParsed.some(
    (e) => JSON.stringify(e) === JSON.stringify(d),
  );
  return ok ? (d as string | number | boolean) : undefined;
}

/** 可解析为「仅含基本类型」的 JSON 数组时，供 tags 编辑；否则返回 null 走 JSON 文本框 */
function parsePrimitiveArrayForTags(defaultStr: string): string[] | null {
  const t = defaultStr.trim();
  if (t === '' || t === '[]') return [];
  try {
    const v = JSON.parse(t) as unknown;
    if (!Array.isArray(v)) return null;
    if (v.some((x) => x !== null && typeof x === 'object')) return null;
    return v.map((x) =>
      typeof x === 'string' ? x : JSON.stringify(x),
    );
  } catch {
    return null;
  }
}

function stringifyPrimitiveArrayFromTags(tags: string[]): string {
  if (tags.length === 0) return '[]';
  const arr = tags.map((raw) => {
    const t = raw.trim();
    if (t === 'true') return true;
    if (t === 'false') return false;
    const n = Number(t);
    if (t !== '' && Number.isFinite(n) && String(n) === t) return n;
    return raw;
  });
  return JSON.stringify(arr);
}

interface DefaultEditorProps {
  row: ParamRow;
  index: number;
  enumParsed: (string | number | boolean)[];
  updateRow: (index: number, patch: Partial<ParamRow>) => void;
}

function DefaultValueEditor({
  row,
  index,
  enumParsed,
  updateRow,
}: DefaultEditorProps) {
  const hasEnum = enumParsed.length > 0;

  if (row.type === 'boolean' && !hasEnum) {
    const v = parseDefaultStr('boolean', row.defaultStr);
    const selectVal =
      v === true || v === false ? String(v) : undefined;
    return (
      <Select
        allowClear
        placeholder="未设置（保存时不写入初始值）"
        style={{ width: '100%' }}
        value={selectVal}
        onChange={(next) =>
          updateRow(index, {
            defaultStr:
              next === undefined || next === null ? '' : String(next),
          })
        }
        options={[
          { label: '是（true）', value: 'true' },
          { label: '否（false）', value: 'false' },
        ]}
      />
    );
  }

  if ((row.type === 'string' || row.type === 'number' || row.type === 'boolean') && hasEnum) {
    const val = defaultValueForSelect(row.type, row.defaultStr, enumParsed);
    const optionValues = enumParsed.map((v) => ({
      label: String(v),
      value: typeof v === 'boolean' ? (v ? 'true' : 'false') : (v as string | number),
    }));
    const selectValue =
      val === undefined
        ? undefined
        : typeof val === 'boolean'
          ? (val ? 'true' : 'false')
          : (val as string | number);
    return (
      <Select
        allowClear
        placeholder="未设置"
        style={{ width: '100%' }}
        value={selectValue}
        onChange={(next) => {
          if (next === undefined || next === null) {
            updateRow(index, { defaultStr: '' });
            return;
          }
          if (row.type === 'boolean') {
            updateRow(index, {
              defaultStr: String(next) === 'true' ? 'true' : 'false',
            });
          } else if (row.type === 'number') {
            updateRow(index, { defaultStr: String(next) });
          } else {
            updateRow(index, { defaultStr: String(next) });
          }
        }}
        options={optionValues}
      />
    );
  }

  if (row.type === 'number' && !hasEnum) {
    const n = parseNum(row.defaultStr);
    return (
      <InputNumber
        style={{ width: '100%' }}
        placeholder="可选"
        value={n !== undefined ? n : null}
        onChange={(v) =>
          updateRow(index, {
            defaultStr:
              v === null || v === undefined ? '' : String(v),
          })
        }
      />
    );
  }

  if (row.type === 'array') {
    const tagValues = parsePrimitiveArrayForTags(row.defaultStr);
    if (tagValues !== null) {
      return (
        <Select
          mode="tags"
          style={{ width: '100%' }}
          placeholder="逐项输入，回车添加；无标签表示无初始项"
          value={tagValues}
          onChange={(tags) => {
              if (tags.length > 0) {
                updateRow(index, {
                  defaultStr: stringifyPrimitiveArrayFromTags(tags as string[]),
                });
                return;
              }
              const prev = row.defaultStr.trim();
              if (prev === '' || prev === '[]') {
                updateRow(index, { defaultStr: prev === '[]' ? '[]' : '' });
                return;
              }
              try {
                const v = JSON.parse(prev) as unknown;
                updateRow(index, {
                  defaultStr: Array.isArray(v) ? '[]' : '',
                });
              } catch {
                updateRow(index, { defaultStr: '' });
              }
            }}
            tokenSeparators={[',']}
          />
      );
    }
    return (
      <Input.TextArea
        rows={3}
        placeholder='复杂结构请在此编辑 JSON，例如 ["项一","项二"]'
        value={row.defaultStr}
        onChange={(e) => updateRow(index, { defaultStr: e.target.value })}
      />
    );
  }

  return (
    <Input
      placeholder="可选"
      value={row.defaultStr}
      onChange={(e) => updateRow(index, { defaultStr: e.target.value })}
    />
  );
}

export interface ParamDefinitionsEditorProps {
  params: ParamDefinitions;
  onChange: (next: ParamDefinitions) => void;
}

export function ParamDefinitionsEditor({
  params,
  onChange,
}: ParamDefinitionsEditorProps) {
  const incoming = useMemo(() => JSON.stringify(params), [params]);
  const lastEmittedRef = useRef(incoming);
  const [rows, setRows] = useState<ParamRow[]>(() => rowsFromDefinitions(params));
  const [advancedDraftKeys, setAdvancedDraftKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameIndex, setRenameIndex] = useState(0);
  const [renameNewKey, setRenameNewKey] = useState('');

  useEffect(() => {
    if (incoming === lastEmittedRef.current) return;
    setRows(rowsFromDefinitions(params));
    setAdvancedDraftKeys(new Set());
  }, [incoming, params]);

  const emit = useCallback(
    (nextRows: ParamRow[]) => {
      setRows(nextRows);
      const defs = rowsToDefinitions(nextRows);
      lastEmittedRef.current = JSON.stringify(defs);
      onChange(defs);
    },
    [onChange],
  );

  const updateRow = (index: number, patch: Partial<ParamRow>) => {
    const prevType = rows[index]?.type;
    let next = rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    if (patch.type !== undefined) {
      const r = next[index];
      const typeChanged = patch.type !== prevType;
      next[index] = {
        ...r,
        ui_type: coerceUiType(patch.type ?? r.type, r.ui_type),
        enumStrings: typeChanged ? [] : r.enumStrings,
        defaultStr: typeChanged ? '' : r.defaultStr,
      };
    }
    const updated = next[index];
    if (updated && rowHasAdvancedContent(updated)) {
      setAdvancedDraftKeys((prev) => {
        const n = new Set(prev);
        n.delete(updated.key);
        return n;
      });
    }
    emit(next);
  };

  const removeRow = (index: number) => {
    const key = rows[index]?.key;
    if (key) {
      setAdvancedDraftKeys((prev) => {
        const n = new Set(prev);
        n.delete(key);
        return n;
      });
    }
    emit(rows.filter((_, i) => i !== index));
  };

  const addRow = () => {
    let base = `param_${rows.length + 1}`;
    const keys = new Set(rows.map((r) => r.key));
    while (keys.has(base)) base += '_';

    emit([
      ...rows,
      {
        key: base,
        label: '',
        type: 'string',
        ui_type: defaultUiTypeForParamType('string'),
        required: false,
        description: '',
        defaultStr: '',
        enumStrings: [],
        minStr: '',
        maxStr: '',
        minLengthStr: '',
        maxLengthStr: '',
        minItemsStr: '',
        maxItemsStr: '',
        hide: false,
        skipValidation: false,
        third_party_field: '',
        enumDependsParam: '',
        enumDependsMapJson: '',
      },
    ]);
  };

  const renameRow = (index: number) => {
    const row = rows[index];
    if (!row) return;
    setRenameIndex(index);
    setRenameNewKey(row.key);
    setRenameOpen(true);
  };

  const confirmRename = () => {
    const nk = renameNewKey.trim();
    if (!nk) return;
    if (rows.some((r, i) => i !== renameIndex && r.key === nk)) {
      Modal.error({ title: '字段名已存在' });
      return;
    }
    const oldKey = rows[renameIndex]?.key;
    const next = rows.map((r, i) => (i === renameIndex ? { ...r, key: nk } : r));
    if (oldKey) {
      setAdvancedDraftKeys((prev) => {
        const n = new Set(prev);
        if (n.delete(oldKey)) n.add(nk);
        return n;
      });
    }
    emit(next);
    setRenameOpen(false);
  };

  const openAdvancedDraft = (paramKey: string) => {
    setAdvancedDraftKeys((prev) => new Set(prev).add(paramKey));
  };

  const closeAdvancedDraft = (paramKey: string) => {
    setAdvancedDraftKeys((prev) => {
      const n = new Set(prev);
      n.delete(paramKey);
      return n;
    });
  };

  const addEnumLine = (index: number) => {
    const row = rows[index];
    if (!row) return;
    updateRow(index, { enumStrings: [...row.enumStrings, ''] });
  };

  const setEnumLine = (index: number, li: number, value: string) => {
    const row = rows[index];
    if (!row) return;
    const next = [...row.enumStrings];
    next[li] = value;
    updateRow(index, { enumStrings: next });
  };

  const removeEnumLine = (index: number, li: number) => {
    const row = rows[index];
    if (!row) return;
    updateRow(index, {
      enumStrings: row.enumStrings.filter((_, i) => i !== li),
    });
  };

  const renderAdvancedFields = (row: ParamRow, index: number) => {
    const otherKeys = rows
      .map((r) => r.key.trim())
      .filter((k) => k && k !== row.key.trim());

    return (
      <div
        style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: '1px solid var(--ant-color-split, rgba(5,5,5,0.06))',
        }}
      >
        <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>
          高级选项
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 12 }}>
          第三方字段映射、枚举联动、隐藏与跳过校验。绝大多数模型无需配置。
        </Typography.Paragraph>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Typography.Text type="secondary">厂商请求体字段名（third_party_field）</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ margin: '4px 0 0', fontSize: 12 }}>
              与对外参数字段名不一致时填写（例如客户端用 aspect_ratio，厂商接口字段为 scale）。留空表示与参数字段名相同。
            </Typography.Paragraph>
            <Input
              style={{ marginTop: 4 }}
              value={row.third_party_field}
              onChange={(e) =>
                updateRow(index, { third_party_field: e.target.value })
              }
              placeholder="默认同字段名"
            />
          </div>

          {(row.type === 'string' || row.type === 'number') && (
            <div>
              <Typography.Text type="secondary">枚举联动（可选）</Typography.Text>
              <Typography.Paragraph type="secondary" style={{ margin: '4px 0 0', fontSize: 12 }}>
                当另一参数取值变化时，限制本参数可选枚举子集（例如 resolution 依赖 aspect_ratio）。需已为本参数配置枚举列表。
              </Typography.Paragraph>
              <Select
                allowClear
                showSearch
                placeholder="选择依赖的参数字段"
                style={{ width: '100%', marginTop: 8 }}
                value={row.enumDependsParam || undefined}
                options={otherKeys.map((k) => ({ label: k, value: k }))}
                onChange={(v) =>
                  updateRow(index, { enumDependsParam: (v as string) ?? '' })
                }
              />
              <Input.TextArea
                style={{ marginTop: 8 }}
                rows={4}
                value={row.enumDependsMapJson}
                onChange={(e) =>
                  updateRow(index, { enumDependsMapJson: e.target.value })
                }
                placeholder={`JSON 对象示例：\n{\n  "16:9": ["1280x720", "1920x1080"],\n  "1:1": ["1024x1024"]\n}`}
              />
            </div>
          )}

          <Space wrap>
            <span>在表单中隐藏</span>
            <Switch
              checked={row.hide}
              onChange={(c) => updateRow(index, { hide: c })}
            />
            <span>创建任务时跳过校验</span>
            <Switch
              checked={row.skipValidation}
              onChange={(c) => updateRow(index, { skipValidation: c })}
            />
          </Space>
          {!rowHasAdvancedContent(row) && advancedDraftKeys.has(row.key) && (
            <Button type="link" size="small" onClick={() => closeAdvancedDraft(row.key)}>
              收起高级选项
            </Button>
          )}
        </Space>
      </div>
    );
  };

  const renderTypeSection = (row: ParamRow, index: number) => {
    const enumParsed = parseEnumStrings(row.type, row.enumStrings);

    const enumBlock = (row.type === 'string' ||
      row.type === 'number' ||
      row.type === 'boolean') && (
      <div style={{ marginTop: 12 }}>
        <Typography.Text type="secondary">固定选项（枚举）</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ margin: '4px 0 8px', fontSize: 12 }}>
          有枚举时展示为下拉或单选；展示控件选「下拉列表」或「单选按钮组」即可。标签与取值一致，直接编辑取值列表。
        </Typography.Paragraph>
        {row.enumStrings.length === 0 ? (
          <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => addEnumLine(index)}>
            配置固定选项（枚举）
          </Button>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            {row.enumStrings.map((line, li) => (
              <Space key={`${row.key}-enum-${li}`} style={{ width: '100%' }} align="baseline">
                <Input
                  style={{ flex: 1, maxWidth: 360 }}
                  value={line}
                  placeholder={
                    row.type === 'number'
                      ? '数字，如 720'
                      : row.type === 'boolean'
                        ? 'true 或 false'
                        : '文本取值'
                  }
                  onChange={(e) => setEnumLine(index, li, e.target.value)}
                />
                <Button
                  type="text"
                  danger
                  icon={<MinusCircleOutlined />}
                  onClick={() => removeEnumLine(index, li)}
                />
              </Space>
            ))}
            <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => addEnumLine(index)}>
              添加枚举项
            </Button>
          </Space>
        )}
      </div>
    );

    if (row.type === 'number') {
      return (
        <>
          {enumBlock}
          <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
            <Col xs={24} sm={12} md={8}>
              <Typography.Text type="secondary">最小值（min）</Typography.Text>
              <Input
                style={{ marginTop: 4 }}
                value={row.minStr}
                onChange={(e) => updateRow(index, { minStr: e.target.value })}
                placeholder="仅数字类型"
              />
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Typography.Text type="secondary">最大值（max）</Typography.Text>
              <Input
                style={{ marginTop: 4 }}
                value={row.maxStr}
                onChange={(e) => updateRow(index, { maxStr: e.target.value })}
                placeholder="仅数字类型"
              />
            </Col>
          </Row>
        </>
      );
    }

    if (row.type === 'string') {
      return (
        <>
          {enumBlock}
          <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
            <Col xs={24} sm={12} md={8}>
              <Typography.Text type="secondary">最小长度（minLength）</Typography.Text>
              <Input
                style={{ marginTop: 4 }}
                value={row.minLengthStr}
                onChange={(e) =>
                  updateRow(index, { minLengthStr: e.target.value })
                }
                placeholder="字符数"
              />
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Typography.Text type="secondary">最大长度（maxLength）</Typography.Text>
              <Input
                style={{ marginTop: 4 }}
                value={row.maxLengthStr}
                onChange={(e) =>
                  updateRow(index, { maxLengthStr: e.target.value })
                }
                placeholder="字符数"
              />
            </Col>
          </Row>
        </>
      );
    }

    if (row.type === 'array') {
      return (
        <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
          <Col xs={24} sm={12} md={8}>
            <Typography.Text type="secondary">最少元素（minItems）</Typography.Text>
            <Input
              style={{ marginTop: 4 }}
              value={row.minItemsStr}
              onChange={(e) =>
                updateRow(index, { minItemsStr: e.target.value })
              }
              placeholder="仅数组类型"
            />
          </Col>
          <Col xs={24} sm={12} md={8}>
            <Typography.Text type="secondary">最多元素（maxItems）</Typography.Text>
            <Input
              style={{ marginTop: 4 }}
              value={row.maxItemsStr}
              onChange={(e) =>
                updateRow(index, { maxItemsStr: e.target.value })
              }
              placeholder="仅数组类型"
            />
          </Col>
        </Row>
      );
    }

    if (row.type === 'boolean') {
      return enumBlock;
    }

    return null;
  };

  return (
    <>
      <Card
        size="small"
        title="请求参数（params）"
        styles={{ header: { fontWeight: 600 } }}
      >
        <Space style={{ marginBottom: 12 }} wrap align="start">
          <Button type="primary" ghost onClick={addRow}>
            添加参数
          </Button>
          <Typography.Text type="secondary" style={{ maxWidth: 720 }}>
            按数据类型展示可配约束：文本支持长度与枚举；数字支持范围与枚举；数组支持元素个数；布尔支持枚举化展示。已移除 configs，旧数据中的枚举值会从 configs 自动带出一次，保存后即写入 enum。
          </Typography.Text>
        </Space>

        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          {rows.map((row, index) => {
            const enumParsed = parseEnumStrings(row.type, row.enumStrings);
            const showAdvanced =
              rowHasAdvancedContent(row) || advancedDraftKeys.has(row.key);
            return (
              <Card
                key={`${row.key}-${index}`}
                size="small"
                type="inner"
                title={<Typography.Text code>{row.key}</Typography.Text>}
                extra={(
                  <Space size={12} align="center" wrap>
                    <Space size={6} align="center">
                      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                        必填
                      </Typography.Text>
                      <Switch
                        checked={row.required}
                        onChange={(c) => updateRow(index, { required: c })}
                      />
                    </Space>
                    <Divider type="vertical" style={{ margin: 0, height: 20 }} />
                    <Button type="link" size="small" onClick={() => renameRow(index)}>
                      重命名
                    </Button>
                    <Button type="link" danger size="small" onClick={() => removeRow(index)}>
                      删除
                    </Button>
                  </Space>
                )}
              >
                <Row gutter={[16, 20]}>
                  <Col xs={24} md={8}>
                    <Typography.Text type="secondary">数据类型</Typography.Text>
                    <Typography.Paragraph type="secondary" style={{ margin: '2px 0 0', fontSize: 12 }}>
                      决定校验规则与下方可选约束（长度、范围、枚举等）。
                    </Typography.Paragraph>
                    <Select
                      style={{ width: '100%', marginTop: 4 }}
                      value={row.type}
                      options={PARAM_TYPES.map((t) => ({
                        label: PARAM_TYPE_LABELS[t],
                        value: t,
                      }))}
                      onChange={(t: ParamType) => {
                        updateRow(index, {
                          type: t,
                          ui_type: defaultUiTypeForParamType(t),
                        });
                      }}
                    />
                  </Col>
                  <Col xs={24} md={8}>
                    <Typography.Text type="secondary">展示控件</Typography.Text>
                    <Typography.Paragraph type="secondary" style={{ margin: '2px 0 0', fontSize: 12 }}>
                      客户端表单形态；有固定选项时常用下拉或单选。
                    </Typography.Paragraph>
                    <Select
                      style={{ width: '100%', marginTop: 4 }}
                      value={row.ui_type}
                      options={labeledUiOptionsForParamType(row.type)}
                      onChange={(ui_type: ParamUIType) =>
                        updateRow(index, { ui_type })
                      }
                    />
                  </Col>
                  <Col xs={24} md={8}>
                    <Typography.Text type="secondary">展示名称</Typography.Text>
                    <Typography.Paragraph type="secondary" style={{ margin: '2px 0 0', fontSize: 12 }}>
                      表单上的标题；留空则按字段名自动生成可读名称。
                    </Typography.Paragraph>
                    <Input
                      style={{ marginTop: 4 }}
                      value={row.label}
                      onChange={(e) => updateRow(index, { label: e.target.value })}
                      placeholder="例如：正向提示词"
                    />
                  </Col>
                  <Col xs={24} lg={8}>
                    <Typography.Text type="secondary">初始值</Typography.Text>
                    <Typography.Paragraph type="secondary" style={{ margin: '2px 0 0', fontSize: 12 }}>
                      {row.type === 'array'
                        ? '数组类型用标签录入初始项；无标签表示不设初值或初始为空列表。'
                        : '有枚举或布尔时从列表选；纯数字或自由文本可直接输入。'}
                    </Typography.Paragraph>
                    <div style={{ marginTop: 4 }}>
                      <DefaultValueEditor
                        row={row}
                        index={index}
                        enumParsed={enumParsed}
                        updateRow={updateRow}
                      />
                    </div>
                  </Col>
                  <Col xs={24} lg={16}>
                    <Typography.Text type="secondary">说明</Typography.Text>
                    <Typography.Paragraph type="secondary" style={{ margin: '2px 0 0', fontSize: 12 }}>
                      对用户或对接文档可见的补充信息（单位、格式、注意点等）。
                    </Typography.Paragraph>
                    <Input
                      style={{ marginTop: 4 }}
                      value={row.description}
                      onChange={(e) =>
                        updateRow(index, { description: e.target.value })
                      }
                      placeholder="参数用途、单位、注意事项等"
                    />
                  </Col>
                </Row>

                {renderTypeSection(row, index)}

                {showAdvanced ? (
                  renderAdvancedFields(row, index)
                ) : (
                  <Button
                    type="link"
                    size="small"
                    style={{ paddingLeft: 0, marginTop: 8 }}
                    onClick={() => openAdvancedDraft(row.key)}
                  >
                    展开高级选项（第三方字段、枚举联动、隐藏…）
                  </Button>
                )}
              </Card>
            );
          })}
        </Space>
      </Card>

      <Modal
        title="重命名参数键（key）"
        open={renameOpen}
        onOk={confirmRename}
        onCancel={() => setRenameOpen(false)}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          与 API / 任务 JSON 中的字段名一致，建议使用英文蛇形命名。
        </Typography.Paragraph>
        <Input
          value={renameNewKey}
          onChange={(e) => setRenameNewKey(e.target.value)}
          placeholder="例如 aspect_ratio"
        />
      </Modal>
    </>
  );
}
