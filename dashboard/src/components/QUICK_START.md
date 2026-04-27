# ModelConfigEditor 快速启动指南

## 5 分钟快速上手

### 步骤 1: 导入组件

```tsx
import { ModelConfigEditor } from '@/components/ModelConfigEditor';
```

### 步骤 2: 准备状态

```tsx
const [jsonValue, setJsonValue] = useState('{}');
const [errors, setErrors] = useState([]);
```

### 步骤 3: 使用组件

```tsx
<ModelConfigEditor
  value={jsonValue}
  onChange={setJsonValue}
  onValidate={setErrors}
/>
```

### 步骤 4: 处理提交

```tsx
const handleSubmit = () => {
  if (errors.length > 0) {
    message.error('请修正错误');
    return;
  }
  
  const config = JSON.parse(jsonValue);
  // 提交配置...
};
```

## 完整示例

```tsx
import React, { useState } from 'react';
import { ModelConfigEditor } from '@/components/ModelConfigEditor';
import { Button, message } from 'antd';

export function MyPage() {
  const [jsonValue, setJsonValue] = useState(JSON.stringify({
    model_name: 'my-model',
    model_type: 40001,
    provider: 'My Provider',
    label: '我的模型',
    service: 'my-service',
  }, null, 2));
  
  const [validationErrors, setValidationErrors] = useState([]);

  const handleSubmit = async () => {
    if (validationErrors.length > 0) {
      message.error('请先修正 JSON 格式错误');
      return;
    }

    try {
      const config = JSON.parse(jsonValue);
      console.log('提交配置:', config);
      message.success('提交成功');
    } catch (error) {
      message.error('提交失败');
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <h1>创建模型配置</h1>
      
      <ModelConfigEditor
        value={jsonValue}
        onChange={setJsonValue}
        onValidate={setValidationErrors}
        height="500px"
      />

      <Button
        type="primary"
        onClick={handleSubmit}
        disabled={validationErrors.length > 0}
        style={{ marginTop: 16 }}
      >
        提交配置
      </Button>
    </div>
  );
}
```

## 常见用法

### 1. 只读模式

```tsx
<ModelConfigEditor
  value={jsonValue}
  onChange={() => {}}
  readOnly={true}
/>
```

### 2. 自定义高度

```tsx
<ModelConfigEditor
  value={jsonValue}
  onChange={setJsonValue}
  height="400px"
/>
```

### 3. 显示验证错误

```tsx
{validationErrors.length > 0 && (
  <Alert
    type="error"
    message={`发现 ${validationErrors.length} 个错误`}
    description={
      <ul>
        {validationErrors.map((error, i) => (
          <li key={i}>{error.message}</li>
        ))}
      </ul>
    }
  />
)}
```

## 工具栏功能

- 🎨 **格式化 JSON**: 点击按钮美化 JSON 格式
- 📋 **复制 JSON**: 点击按钮复制到剪贴板
- ⚠️ **错误提示**: 自动显示验证错误数量

## 编辑器快捷键

- `Ctrl + F`: 查找
- `Ctrl + H`: 替换
- `Ctrl + Shift + F`: 格式化
- `Ctrl + Z`: 撤销
- `Ctrl + Y`: 重做

## 下一步

- 查看 [完整文档](./ModelConfigEditor.README.md)
- 查看 [使用示例](./ModelConfigEditor.example.tsx)
- 查看 [测试页面](./ModelConfigEditor.test.tsx)

## 需要帮助？

如有问题，请查看：
1. [需求文档](../../../.kiro/specs/model-config-management/requirements.md)
2. [设计文档](../../../.kiro/specs/model-config-management/design.md)
3. [Monaco Editor 文档](https://microsoft.github.io/monaco-editor/)
