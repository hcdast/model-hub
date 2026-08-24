import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactFlow, {
  Node,
  Controls,
  Background,
  MiniMap,
  addEdge,
  Connection,
  useNodesState,
  useEdgesState,
  NodeTypes,
  BackgroundVariant,
  useReactFlow,
  ReactFlowProvider,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  Button,
  Space,
  message,
  Input,
  Spin,
  Tooltip,
  Divider,
} from 'antd';
import {
  SaveOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  ArrowLeftOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  ExpandOutlined,
} from '@ant-design/icons';
import { workflowApi } from '../services/workflow-api';
import { useWorkflowStore, WorkflowNodeData } from '../store/workflow-store';
import { getNodeDefinition, NodeType } from '../types/node-types';
import { nodeTypeSupportsModel } from '../utils/model-type-map';
import { findNonOverlappingPosition, findNearbyPosition, getViewportCenter } from '../utils/node-placement';
import { WorkflowEditorContext } from '../contexts/WorkflowEditorContext';
import ModelNode from '../components/Node/ModelNode';
import ConditionNode from '../components/Node/ConditionNode';
import LoopNode from '../components/Node/LoopNode';
import InputNode from '../components/Node/InputNode';
import OutputNode from '../components/Node/OutputNode';
import TransformNode from '../components/Node/TransformNode';
import TextToImageNode from '../components/Node/TextToImageNode';
import TextToVideoNode from '../components/Node/TextToVideoNode';
import AIAgentNode from '../components/Node/AIAgentNode';
import EditorSidebar, { SidebarAction } from '../components/Editor/EditorSidebar';
import AddNodeMenu from '../components/Editor/AddNodeMenu';
import NodeContextMenu from '../components/Editor/NodeContextMenu';
import AutoFitView, { manualFitViewOptions } from '../components/Editor/AutoFitView';
import tokens from '../theme/dark';

const nodeTypes: NodeTypes = {
  model: ModelNode,
  condition: ConditionNode,
  loop: LoopNode,
  input: InputNode,
  output: OutputNode,
  transform: TransformNode,
  'text-to-image': TextToImageNode,
  'image-to-image': TextToImageNode,
  'image-editor': TextToImageNode,
  'image-upscale': TextToImageNode,
  'text-to-video': TextToVideoNode,
  'image-to-video': TextToVideoNode,
  'video-to-video': TextToVideoNode,
  'video-upscale': TextToVideoNode,
  'ai-chat': AIAgentNode,
  'script-writer': AIAgentNode,
  storyboard: AIAgentNode,
  'character-create': TextToImageNode,
  'face-swap': TextToImageNode,
  'character-swap': TextToImageNode,
  'text-to-speech': ModelNode,
  'music-generation': ModelNode,
};

function WorkflowEditorInner() {
  const { id } = useParams();
  const navigate = useNavigate();
  const reactFlowInstance = useReactFlow();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [sidebarAction, setSidebarAction] = useState<SidebarAction | null>(null);
  const [addMenuPos, setAddMenuPos] = useState({ x: 80, y: 200 });
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const clipboardRef = useRef<Node<WorkflowNodeData> | null>(null);

  const {
    name,
    setName,
    selectedNodeId,
    setSelectedNode,
    isExecuting,
    setIsExecuting,
    setRunId,
  } = useWorkflowStore();

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    if (id && id !== 'new') {
      loadWorkflow(id);
    } else {
      // 新建工作流：空白画布，由用户通过左侧 + 添加节点
      setNodes([]);
    }
  }, [id]);

  const loadWorkflow = async (workflowId: string) => {
    setLoading(true);
    try {
      const res: any = await workflowApi.get(workflowId);
      const workflow = res.data;
      setName(workflow.name);
      setNodes(
        (workflow.nodes || []).map((n: any) => ({
          id: n.id,
          type: n.type,
          position: n.position,
          data: n.data,
        })),
      );
      setEdges(
        (workflow.edges || []).map((e: any) => ({
          id: e.id,
          source: e.source.nodeId,
          target: e.target.nodeId,
          sourceHandle: e.source.port,
          targetHandle: e.target.port,
          label: e.label,
        })),
      );
    } catch {
      message.error('加载工作流失败');
    } finally {
      setLoading(false);
    }
  };

  const updateNodeData = useCallback((nodeId: string, data: Partial<WorkflowNodeData>) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n)),
    );
  }, [setNodes]);

  const deleteNode = useCallback((nodeId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    if (selectedNodeId === nodeId) setSelectedNode(null);
  }, [setNodes, setEdges, selectedNodeId, setSelectedNode]);

  const duplicateNode = useCallback((nodeId: string) => {
    const source = nodes.find((n) => n.id === nodeId);
    if (!source) return;
    const position = findNearbyPosition(source.position, nodes);
    const newNode: Node<WorkflowNodeData> = {
      ...source,
      id: `${source.type}-${Date.now()}`,
      position,
      selected: false,
      data: { ...source.data, label: `${source.data.label} (副本)` },
    };
    setNodes((nds) => [...nds, newNode]);
    setSelectedNode(newNode.id);
  }, [nodes, setNodes, setSelectedNode]);

  const copyNode = useCallback((nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (node) {
      clipboardRef.current = JSON.parse(JSON.stringify(node));
      message.success('已复制节点');
    }
  }, [nodes]);

  const pasteNode = useCallback(() => {
    if (!clipboardRef.current) return;
    const src = clipboardRef.current;
    const position = findNearbyPosition(src.position, nodes);
    const newNode: Node<WorkflowNodeData> = {
      ...src,
      id: `${src.type}-${Date.now()}`,
      position,
      selected: true,
    };
    setNodes((nds) => [...nds, newNode]);
    setSelectedNode(newNode.id);
    message.success('已粘贴节点');
  }, [nodes, setNodes, setSelectedNode]);

  const pollRunStatus = useCallback(async (runId: string, nodeId: string) => {
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const res: any = await workflowApi.getRun(runId);
        const nodeState = res.data?.nodeStates?.find((n: any) => n.nodeId === nodeId);
        if (!nodeState) continue;

        if (nodeState.status === 'running') {
          updateNodeData(nodeId, { executionStatus: 'running', progress: Math.min(90, (i + 1) * 10) });
        }
        if (nodeState.status === 'succeeded') {
          updateNodeData(nodeId, {
            executionStatus: 'success',
            progress: 100,
            output: nodeState.output,
          });
          return;
        }
        if (nodeState.status === 'failed') {
          updateNodeData(nodeId, { executionStatus: 'error' });
          message.error(nodeState.error?.message || '节点执行失败');
          return;
        }
      } catch {
        // continue polling
      }
    }
    updateNodeData(nodeId, { executionStatus: 'error' });
  }, [updateNodeData]);

  const handleRunNode = useCallback(async (nodeId: string) => {
    if (!id || id === 'new') {
      message.warning('请先保存工作流');
      return;
    }

    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;

    if (nodeTypeSupportsModel(node.data.type) && !node.data.modelId) {
      message.warning('请先为节点选择模型');
      setSelectedNode(nodeId);
      return;
    }

    updateNodeData(nodeId, { executionStatus: 'running', progress: 0 });

    try {
      const res: any = await workflowApi.runNode(id, nodeId, {});
      setRunId(res.data.runId);
      message.success('节点执行已触发');
      await pollRunStatus(res.data.runId, nodeId);
    } catch {
      updateNodeData(nodeId, { executionStatus: 'error' });
      message.error('节点执行失败');
    }
  }, [id, nodes, updateNodeData, pollRunStatus, setRunId, setSelectedNode]);

  const handleRun = async () => {
    if (!id || id === 'new') {
      message.warning('请先保存工作流');
      return;
    }
    setIsExecuting(true);
    try {
      const res: any = await workflowApi.run(id, {});
      setRunId(res.data.runId);
      message.success('工作流执行已触发');
    } catch {
      message.error('执行触发失败');
    } finally {
      setIsExecuting(false);
    }
  };

  const addNodeAtCenter = useCallback((type: NodeType) => {
    const wrapper = document.querySelector('.react-flow')?.getBoundingClientRect();
    const viewport = reactFlowInstance.getViewport();
    const anchor = getViewportCenter(
      viewport,
      wrapper?.width ?? window.innerWidth,
      wrapper?.height ?? window.innerHeight - 52,
    );

    setNodes((nds) => {
      const position = findNonOverlappingPosition(anchor, nds);
      const newNode: Node<WorkflowNodeData> = {
        id: `${type}-${Date.now()}`,
        type,
        position,
        selected: true,
        data: {
          label: getDefaultLabel(type),
          type,
        },
      };
      setSelectedNode(newNode.id);
      return [...nds, newNode];
    });
    setSidebarAction(null);
  }, [reactFlowInstance, setNodes, setSelectedNode]);

  const handleSidebarAction = (action: SidebarAction) => {
    if (action === 'add') {
      setSidebarAction(sidebarAction === 'add' ? null : 'add');
      setAddMenuPos({ x: 80, y: window.innerHeight / 2 - 160 });
    } else if (action === 'templates') {
      navigate('/templates');
    } else if (action === 'history') {
      message.info('执行历史功能即将上线');
    } else {
      message.info('功能即将上线');
    }
  };

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
        e.preventDefault();
        deleteNode(selectedNodeId);
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'c' && selectedNodeId) {
          e.preventDefault();
          copyNode(selectedNodeId);
        }
        if (e.key === 'v') {
          e.preventDefault();
          pasteNode();
        }
        if (e.key === 'd' && selectedNodeId) {
          e.preventDefault();
          duplicateNode(selectedNodeId);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeId, deleteNode, copyNode, pasteNode, duplicateNode]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({
        ...connection,
        style: { stroke: 'rgba(255,255,255,0.3)', strokeWidth: 1.5 },
      }, eds));
    },
    [setEdges],
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node.id);
    setContextMenu(null);
  }, [setSelectedNode]);

  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    setSelectedNode(node.id);
    setContextMenu({ nodeId: node.id, x: e.clientX, y: e.clientY });
  }, [setSelectedNode]);

  const onPaneClick = useCallback(() => {
    setContextMenu(null);
    setSidebarAction(null);
    setSelectedNode(null);
  }, [setSelectedNode]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/reactflow');
      if (!type) return;

      const bounds = (event.target as HTMLElement).closest('.react-flow')?.getBoundingClientRect();
      const dropPoint = reactFlowInstance.project({
        x: event.clientX - (bounds?.left || 0),
        y: event.clientY - (bounds?.top || 0),
      });

      setNodes((nds) => {
        const position = findNonOverlappingPosition(dropPoint, nds);
        return [...nds, {
          id: `${type}-${Date.now()}`,
          type,
          position,
          data: { label: getDefaultLabel(type), type: type as NodeType },
        }];
      });
    },
    [reactFlowInstance, setNodes],
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      const workflowData = {
        name,
        nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
        edges: edges.map((e) => ({
          id: e.id,
          source: { nodeId: e.source, port: e.sourceHandle || 'output' },
          target: { nodeId: e.target, port: e.targetHandle || 'input' },
        })),
      };
      if (id && id !== 'new') {
        await workflowApi.update(id, workflowData);
        message.success('保存成功');
      } else {
        const res: any = await workflowApi.create(workflowData);
        message.success('创建成功');
        navigate(`/workflows/${res.data._id}`);
      }
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res: any = await workflowApi.validate({
        nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
        edges: edges.map((e) => ({
          id: e.id,
          source: { nodeId: e.source, port: e.sourceHandle || 'output' },
          target: { nodeId: e.target, port: e.targetHandle || 'input' },
        })),
      });
      if (res.data?.valid) message.success('校验通过');
      else message.error(res.data?.errors?.[0]?.message || '校验失败');
    } catch {
      message.error('校验失败');
    } finally {
      setValidating(false);
    }
  };

  const contextNode = contextMenu ? nodes.find((n) => n.id === contextMenu.nodeId) : null;

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: tokens.bg.primary }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <WorkflowEditorContext.Provider value={{ onRunNode: handleRunNode, onUpdateNode: updateNodeData }}>
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: tokens.bg.primary }}>
        {/* 顶部工具栏 */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          height: 52, padding: `0 ${tokens.spacing.md}`,
          background: tokens.bg.secondary, borderBottom: `1px solid ${tokens.border.default}`, zIndex: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacing.md }}>
            <Tooltip title="返回工作流列表">
              <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/workflows')} style={{ color: tokens.text.secondary }} />
            </Tooltip>
            <Divider type="vertical" style={{ borderColor: tokens.border.default }} />
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="工作流名称"
              variant="borderless"
              style={{ width: 240, fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.medium, color: tokens.text.primary, background: 'transparent' }}
            />
          </div>

          <Space size="small">
            <Tooltip title="放大"><Button type="text" icon={<ZoomInOutlined />} onClick={() => reactFlowInstance.zoomIn()} style={{ color: tokens.text.secondary }} /></Tooltip>
            <Tooltip title="缩小"><Button type="text" icon={<ZoomOutOutlined />} onClick={() => reactFlowInstance.zoomOut()} style={{ color: tokens.text.secondary }} /></Tooltip>
            <Tooltip title="适应画布"><Button type="text" icon={<ExpandOutlined />} onClick={() => reactFlowInstance.fitView(manualFitViewOptions)} style={{ color: tokens.text.secondary }} /></Tooltip>
          </Space>

          <Space size="small">
            <Button icon={<CheckCircleOutlined />} onClick={handleValidate} loading={validating} style={{ background: tokens.bg.elevated, borderColor: tokens.border.default, color: tokens.text.primary }}>
              校验
            </Button>
            <Button icon={<SaveOutlined />} onClick={handleSave} loading={saving} style={{ background: tokens.bg.elevated, borderColor: tokens.border.default, color: tokens.text.primary }}>
              保存
            </Button>
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleRun} loading={isExecuting} disabled={!id || id === 'new'} style={{ background: tokens.accent.gradient, border: 'none' }}>
              运行
            </Button>
          </Space>
        </div>

        {/* 画布 */}
        <div style={{ flex: 1, position: 'relative' }}>
          <EditorSidebar activeAction={sidebarAction} onAction={handleSidebarAction} />

          <AddNodeMenu
            open={sidebarAction === 'add'}
            position={addMenuPos}
            onSelect={addNodeAtCenter}
            onClose={() => setSidebarAction(null)}
          />

          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onNodeContextMenu={onNodeContextMenu}
            onPaneClick={onPaneClick}
            onDragOver={onDragOver}
            onDrop={onDrop}
            nodeTypes={nodeTypes}
            fitViewOptions={manualFitViewOptions}
            deleteKeyCode={null}
            defaultEdgeOptions={{ style: { stroke: 'rgba(255,255,255,0.25)', strokeWidth: 1.5 } }}
          >
            <Controls style={{ background: tokens.bg.tertiary, borderColor: tokens.border.default, borderRadius: tokens.radius.md, boxShadow: tokens.shadow.md }} />
            <MiniMap
              style={{ background: tokens.bg.secondary, borderColor: tokens.border.default, borderRadius: tokens.radius.md }}
              nodeColor={() => 'rgba(255,255,255,0.2)'}
              maskColor={`${tokens.bg.primary}80`}
            />
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(255,255,255,0.06)" />
            <AutoFitView loading={loading} nodeCount={nodes.length} selectedNodeId={selectedNodeId} />
          </ReactFlow>

          {contextMenu && contextNode && (
            <NodeContextMenu
              open
              position={{ x: contextMenu.x, y: contextMenu.y }}
              nodeType={contextNode.type}
              onClose={() => setContextMenu(null)}
              onCopy={() => copyNode(contextMenu.nodeId)}
              onPaste={pasteNode}
              onDuplicate={() => duplicateNode(contextMenu.nodeId)}
              onDelete={() => deleteNode(contextMenu.nodeId)}
              onRun={() => handleRunNode(contextMenu.nodeId)}
              canPaste={!!clipboardRef.current}
              canRun={!!id && id !== 'new'}
            />
          )}
        </div>
      </div>
    </WorkflowEditorContext.Provider>
  );
}

export default function WorkflowEditor() {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner />
    </ReactFlowProvider>
  );
}

function getDefaultLabel(type: string): string {
  const nodeDef = getNodeDefinition(type as NodeType);
  if (nodeDef) return nodeDef.label;
  return type;
}
