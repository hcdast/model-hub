import { Alert, Button, Drawer, Input, InputNumber, Select, Space, Spin } from 'antd';
import { Node } from 'reactflow';
import { WorkflowNodeData } from '../../store/workflow-store';
import { nodeTypeSupportsModel } from '../../utils/model-type-map';
import { useNodeModelConfig } from '../../hooks/useNodeModelConfig';
import { useModelParams } from '../../hooks/useModelParams';
import InlineModelPicker from '../Node/InlineModelPicker';
import ModelParamField from '../Node/ModelParamField';
import NodeOutputPreview from '../Node/NodeOutputPreview';
import StructuredTextEditor from '../Node/StructuredTextEditor';

interface Props {
  node: Node<WorkflowNodeData> | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (id: string, data: Partial<WorkflowNodeData>) => void;
}

export default function NodeParametersPanel({ node, open, onClose, onUpdate }: Props) {
  return <Drawer title={node ? `${node.data.label} · 完整配置` : '节点配置'} open={open} onClose={onClose} width={480} destroyOnClose>
    {node && <NodeConfiguration key={node.id} node={node} onUpdate={onUpdate} />}
  </Drawer>;
}

function NodeConfiguration({ node, onUpdate }: Pick<Props, 'onUpdate'> & { node: Node<WorkflowNodeData> }) {
  const { data, id } = node;
  const modelBacked = nodeTypeSupportsModel(data.type);
  const { updateModel, updateParam } = useNodeModelConfig({ nodeId: id, nodeType: data.type, modelId: data.modelId, parameters: data.parameters, onUpdateNode: onUpdate });
  const { params, loading, error, retry } = useModelParams(modelBacked ? data.modelId : undefined, data.modelSelection);
  const update = (patch: Partial<WorkflowNodeData>) => onUpdate(id, patch);
  const loop = data.loopConfig ?? { inputArray: '', outputMode: 'collect' as const, parallelism: 'sequential' as const };
  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    <label>节点名称<Input value={data.label} onChange={(event) => update({ label: event.target.value })} /></label>
    {modelBacked && <>
      <InlineModelPicker nodeType={data.type} value={data.modelId} onChange={updateModel} />
      {!data.modelId && <Alert type="info" message="请选择模型以加载真实参数定义" />}
      {!data.modelId && <StructuredTextEditor value={data.textDocument} prompt={typeof data.parameters?.prompt === 'string' ? data.parameters.prompt : ''} onChange={(textDocument, prompt) => update({ textDocument, parameters: { ...data.parameters, prompt } })} />}
      {loading && <Spin tip="加载模型参数" />}
      {error && <Alert type="error" message={error} action={<Button onClick={retry}>重试</Button>} />}
      {!loading && !error && params.filter((param) => !param.hide).map((param) => param.name === 'prompt' && param.type === 'string' ? <div key={`${data.modelId}:prompt`}><label>{param.label || '提示词'}{param.required ? ' *' : ''}</label><StructuredTextEditor value={data.textDocument} prompt={typeof data.parameters?.prompt === 'string' ? data.parameters.prompt : ''} onChange={(textDocument, prompt) => update({ textDocument, parameters: { ...data.parameters, prompt } })} />{param.description && <div>{param.description}</div>}</div> : <ModelParamField key={`${data.modelId}:${param.name}`} param={param} value={data.parameters?.[param.name]} parameters={data.parameters ?? {}} onChange={(value) => updateParam(param.name, value)} />)}
    </>}
    {data.type === 'condition' && <>
      <Alert type="info" message="按顺序匹配条件；分支 ID 必须与连线 branchId 一致，无匹配使用 default。" />
      {(data.conditions ?? []).map((condition, index) => <div key={index}>
        <label>条件表达式<Input.TextArea value={condition.expression} onChange={(event) => update({ conditions: data.conditions!.map((item, at) => at === index ? { ...item, expression: event.target.value } : item) })} placeholder="$input.value > 10" /></label>
        <label>分支 ID<Input value={condition.branchId} onChange={(event) => update({ conditions: data.conditions!.map((item, at) => at === index ? { ...item, branchId: event.target.value } : item) })} /></label>
        {(!condition.expression.trim() || !condition.branchId.trim() || data.conditions!.some((item, at) => at !== index && item.branchId === condition.branchId)) && <div role="alert">表达式和唯一分支 ID 不能为空</div>}
        <Button danger onClick={() => update({ conditions: data.conditions!.filter((_, at) => at !== index) })}>删除条件</Button>
      </div>)}
      <Button onClick={() => update({ conditions: [...(data.conditions ?? []), { expression: '', branchId: `branch-${crypto.randomUUID()}` }] })}>添加条件</Button>
    </>}
    {data.type === 'loop' && <>
      <label>数组引用<Input value={loop.inputArray} placeholder="$input.array" onChange={(event) => update({ loopConfig: { ...loop, inputArray: event.target.value } })} /></label>
      <label>输出模式<Select style={{ width: '100%' }} value={loop.outputMode} options={[{ value: 'collect', label: '收集全部结果' }, { value: 'last', label: '最后一个结果' }]} onChange={(outputMode) => update({ loopConfig: { ...loop, outputMode } })} /></label>
      <label>并发方式<Select style={{ width: '100%' }} value={loop.parallelism} options={[{ value: 'sequential', label: '顺序' }, { value: 'parallel', label: '并行' }]} onChange={(parallelism) => update({ loopConfig: { ...loop, parallelism } })} /></label>
      <label>最大并发<InputNumber min={1} max={100} precision={0} value={loop.maxConcurrency} onChange={(value) => update({ loopConfig: { ...loop, maxConcurrency: value ?? undefined } })} /></label>
    </>}
    {data.type === 'transform' && <label>转换表达式<Input.TextArea rows={5} value={data.transform?.expression ?? ''} placeholder="$input.value * 2" onChange={(event) => update({ transform: { ...data.transform, expression: event.target.value } })} /></label>}
    {!modelBacked && <ModelParamField param={{ name: 'parameters', label: '节点参数（JSON）', type: 'object', required: false }} value={data.parameters ?? {}} parameters={{}} onChange={(parameters) => update({ parameters: parameters as Record<string, unknown> | undefined })} />}
    {(data.type === 'input' || data.type === 'output') && <Alert type="info" message={data.type === 'input' ? '输入节点透传工作流运行输入；通过连线选择需要传递的端口。' : '输出节点汇总上游连线输入；结果可在运行后查看。'} />}
    {data.output !== undefined && <NodeOutputPreview output={data.output} />}
  </Space>;
}
