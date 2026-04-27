# ModelConfigEditor 组件使用说明

## 概述

`ModelConfigEditor` 是一个基于 Monaco Editor 的 JSON 配置编辑器组件，专为模型配置管理功能设计。

## 功能特性

### 核心功能
- ✅ **语法高亮**: 自动高亮 JSON 语法
- ✅ **行号显示**: 显示代码行号
- ✅ **代码折叠**: 支持折叠和展开嵌套结构
- ✅ **自动缩进**: 自动格式化和缩进
- ✅ **实时验证**: 实时检查 JSON 语法错误
- ✅ **错误提示**: 显示错误位置和详细信息

### 工具栏功能
- 🎨 **格式化 JSON**: 一键美化 JSON 格式（2 空格缩进）
- 📋 **复制 JSON**: 快速复制编辑器内容到剪贴板
- ⚠️ **错误计数**: 实时显示验证错误数量

## 使用方法

### 基本用法

```tsx
import { ModelConfigEditor } from '@/components/ModelConfigEditor';
import { useState } from 'react';

function MyComponent() {
  const [jsonValue, setJsonValue] = useState('{}');
  const [errors, setErrors] = useState([]);

  return (
    <ModelConfigEditor
      value={jsonValue}
      onChange={setJsonValue}
      onValidate={setErrors}
    />
  );
}
```

### Props 说明

| 属性 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `value` | `string` | 是 | - | JSON 字符串内容 |
| `onChange` | `(value: string) => void` | 是 | - | 内容变化回调 |
| `onValidate` | `(errors: any[]) => void` | 否 | - | 验证结果回调 |
| `readOnly` | `boolean` | 否 | `false` | 是否只读 |
| `height` | `string` | 否 | `'600px'` | 编辑器高度 |

### 验证错误格式

```typescript
interface ValidationError {
  message: string;           // 错误信息
  startLineNumber: number;   // 起始行号
  startColumn: number;       // 起始列号
  endLineNumber: number;     // 结束行号
  endColumn: number;         // 结束列号
}
```

## 使用示例

### 示例 1: 创建配置页面

```tsx
import { ModelConfigEditor } from '@/components/ModelConfigEditor';
import { Button, message } from 'antd';
import { useState } from 'react';

export function CreateModelConfigPage() {
  const [jsonValue, setJsonValue] = useState(JSON.stringify({
    model_name: '',
    model_type: 40001,
    provider: '',
    label: '',
    service: '',
  }, null, 2));
  
  const [validationErrors, setValidationErrors] = useState([]);

  const handleSubmit = async () => {
    if (validationErrors.length > 0) {
      message.error('请先修正 JSON 格式错误');
      return;
    }

    try {
      const config = JSON.parse(jsonValue);
      // 调用 API 创建配置
      await createModelConfig(config);
      message.success('创建成功');
    } catch (error) {
      message.error('创建失败');
    }
  };

  return (
    <div>
      <ModelConfigEditor
        value={jsonValue}
        onChange={setJsonValue}
        onValidate={setValidationErrors}
      />
      <Button
        type="primary"
        onClick={handleSubmit}
        disabled={validationErrors.length > 0}
        style={{ marginTop: 16 }}
      >
        提交
      </Button>
    </div>
  );
}
```

### 示例 2: 编辑配置页面

```tsx
import { ModelConfigEditor } from '@/components/ModelConfigEditor';
import { Button, Spin } from 'antd';
import { useState, useEffect } from 'react';

export function EditModelConfigPage({ id }: { id: string }) {
  const [loading, setLoading] = useState(true);
  const [jsonValue, setJsonValue] = useState('');
  const [validationErrors, setValidationErrors] = useState([]);

  useEffect(() => {
    // 加载配置数据
    loadConfig(id).then(config => {
      setJsonValue(JSON.stringify(config, null, 2));
      setLoading(false);
    });
  }, [id]);

  if (loading) {
    return <Spin />;
  }

  return (
    <div>
      <ModelConfigEditor
        value={jsonValue}
        onChange={setJsonValue}
        onValidate={setValidationErrors}
      />
      <Button
        type="primary"
        disabled={validationErrors.length > 0}
        style={{ marginTop: 16 }}
      >
        保存
      </Button>
    </div>
  );
}
```

### 示例 3: 只读模式

```tsx
<ModelConfigEditor
  value={jsonValue}
  onChange={() => {}}
  readOnly={true}
  height="400px"
/>
```

## 编辑器快捷键

Monaco Editor 支持以下快捷键：

- `Ctrl + F`: 查找
- `Ctrl + H`: 替换
- `Ctrl + /`: 切换注释
- `Ctrl + Z`: 撤销
- `Ctrl + Y`: 重做
- `Ctrl + Shift + F`: 格式化文档
- `Alt + Up/Down`: 移动行
- `Ctrl + D`: 选择下一个匹配项

## 注意事项

1. **性能**: Monaco Editor 对大文件（>1MB）的性能可能下降，建议对超大配置进行分页或分块处理
2. **验证**: 组件只进行 JSON 语法验证，业务逻辑验证需要在父组件中实现
3. **浏览器兼容性**: 需要现代浏览器支持（Chrome 60+, Firefox 60+, Safari 12+）
4. **剪贴板**: 复制功能需要 HTTPS 或 localhost 环境

## 测试

运行测试页面：

```bash
# 在浏览器中访问测试页面
# 路由: /test/model-config-editor
```

测试页面提供了完整的功能演示和测试建议。

## 相关文档

- [Monaco Editor 官方文档](https://microsoft.github.io/monaco-editor/)
- [@monaco-editor/react 文档](https://github.com/suren-atoyan/monaco-react)
- [需求文档](../../../.kiro/specs/model-config-management/requirements.md)
- [设计文档](../../../.kiro/specs/model-config-management/design.md)
