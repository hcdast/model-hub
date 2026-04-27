import React, { useRef, useEffect, useState } from 'react';
import Editor, { OnMount, OnChange } from '@monaco-editor/react';
import { Button, Space, message } from 'antd';
import { CopyOutlined, FormatPainterOutlined } from '@ant-design/icons';
import type { editor } from 'monaco-editor';

interface ModelConfigEditorProps {
  value: string;
  onChange: (value: string) => void;
  onValidate?: (errors: any[]) => void;
  readOnly?: boolean;
  height?: string;
}

/**
 * ModelConfigEditor 组件
 * 基于 Monaco Editor 的 JSON 配置编辑器
 * 提供语法高亮、自动格式化、实时验证等功能
 */
export const ModelConfigEditor: React.FC<ModelConfigEditorProps> = ({
  value,
  onChange,
  onValidate,
  readOnly = false,
  height = '600px',
}) => {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [validationErrors, setValidationErrors] = useState<any[]>([]);

  /**
   * 编辑器挂载时的回调
   * 配置编辑器选项和验证
   */
  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // 配置 JSON 语言选项
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: false,
      schemas: [],
      enableSchemaRequest: false,
    });

    // 配置编辑器选项
    editor.updateOptions({
      minimap: { enabled: true },
      fontSize: 14,
      lineNumbers: 'on',
      folding: true,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      formatOnPaste: true,
      formatOnType: true,
    });
  };

  /**
   * 编辑器内容变化时的回调
   * 触发父组件的 onChange 和实时验证
   */
  const handleEditorChange: OnChange = (value) => {
    if (value !== undefined) {
      onChange(value);
      validateJson(value);
    }
  };

  /**
   * 验证 JSON 格式
   * 使用 JSON.parse 进行语法验证
   */
  const validateJson = (jsonString: string) => {
    const errors: any[] = [];

    if (!jsonString.trim()) {
      errors.push({
        message: 'JSON 内容不能为空',
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 1,
      });
    } else {
      try {
        JSON.parse(jsonString);
        // JSON 语法正确
      } catch (error: any) {
        // 解析错误位置
        const match = error.message.match(/position (\d+)/);
        const position = match ? parseInt(match[1], 10) : 0;
        
        // 计算行号和列号
        const lines = jsonString.substring(0, position).split('\n');
        const lineNumber = lines.length;
        const column = lines[lines.length - 1].length + 1;

        errors.push({
          message: `JSON 语法错误: ${error.message}`,
          startLineNumber: lineNumber,
          startColumn: column,
          endLineNumber: lineNumber,
          endColumn: column + 1,
        });
      }
    }

    setValidationErrors(errors);
    
    // 通知父组件验证结果
    if (onValidate) {
      onValidate(errors);
    }
  };

  /**
   * 格式化 JSON
   * 美化 JSON 格式，使用 2 空格缩进
   */
  const handleFormatJson = () => {
    if (!editorRef.current) return;

    try {
      const currentValue = editorRef.current.getValue();
      const parsed = JSON.parse(currentValue);
      const formatted = JSON.stringify(parsed, null, 2);
      
      editorRef.current.setValue(formatted);
      message.success('JSON 格式化成功');
    } catch (error: any) {
      message.error(`格式化失败: ${error.message}`);
    }
  };

  /**
   * 复制 JSON 到剪贴板
   */
  const handleCopyJson = async () => {
    if (!editorRef.current) return;

    try {
      const currentValue = editorRef.current.getValue();
      await navigator.clipboard.writeText(currentValue);
      message.success('已复制到剪贴板');
    } catch (error) {
      message.error('复制失败');
    }
  };

  // 初始验证
  useEffect(() => {
    if (value) {
      validateJson(value);
    }
  }, []);

  return (
    <div style={{ border: '1px solid #d9d9d9', borderRadius: '4px' }}>
      {/* 工具栏 */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid #d9d9d9',
          backgroundColor: '#fafafa',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Space>
          <Button
            icon={<FormatPainterOutlined />}
            onClick={handleFormatJson}
            disabled={readOnly}
            size="small"
          >
            格式化 JSON
          </Button>
          <Button
            icon={<CopyOutlined />}
            onClick={handleCopyJson}
            size="small"
          >
            复制 JSON
          </Button>
        </Space>
        
        {/* 验证错误提示 */}
        {validationErrors.length > 0 && (
          <span style={{ color: '#ff4d4f', fontSize: '12px' }}>
            {validationErrors.length} 个错误
          </span>
        )}
      </div>

      {/* Monaco Editor */}
      <Editor
        height={height}
        defaultLanguage="json"
        value={value}
        onChange={handleEditorChange}
        onMount={handleEditorDidMount}
        theme="vs"
        options={{
          readOnly,
          selectOnLineNumbers: true,
          roundedSelection: false,
          cursorStyle: 'line',
          automaticLayout: true,
        }}
      />
    </div>
  );
};

export default ModelConfigEditor;
