import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { useParams, useSearchParams, useNavigate, UNSAFE_NavigationContext } from 'react-router-dom';
import ReactFlow, { Node, Edge, Connection, Controls, Background, MiniMap, addEdge, useNodesState, useEdgesState, NodeTypes, BackgroundVariant, useReactFlow, ReactFlowProvider, Viewport } from 'reactflow';
import 'reactflow/dist/style.css';
import { Button, Space, message, Input, Spin, Tooltip, Divider, Drawer, Select, List, Alert, Pagination, Modal, Tag } from 'antd';
import { SaveOutlined, PlayCircleOutlined, CheckCircleOutlined, ArrowLeftOutlined, ZoomInOutlined, ZoomOutOutlined, ExpandOutlined } from '@ant-design/icons';
import { workflowApi } from '../services/workflow-api';
import { needsWorkflowApiKey } from '../utils/workflow-billing';
import { workflowAssetsApi, WorkflowAsset } from '../services/workflow-assets-api';
import { modelApi } from '../services/model-api';
import { findMediaParams } from '../utils/model-params.util';
import { useWorkflowStore, WorkflowNodeData } from '../store/workflow-store';
import type { ParamDefinition } from '../types/model-params';
import { getNodeDefinition, NodeType } from '../types/node-types';
import { nodeTypeSupportsModel, NODE_TYPE_TO_MODEL_TYPE } from '../utils/model-type-map';
import { catalogApi } from '../services/catalog-api';
import { useI18n } from '../i18n';
import LanguageSwitcher from '../components/Layout/LanguageSwitcher';
import TemplateSubmissionButton from '../components/Templates/TemplateSubmissionButton';
import WorkflowDramaBridge from '../components/Editor/WorkflowDramaBridge';
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
import NodeParametersPanel from '../components/Editor/NodeParametersPanel';
import AssetsPanel from '../components/Editor/AssetsPanel';
import NodeOutputPreview from '../components/Node/NodeOutputPreview';
import { manualFitViewOptions } from '../components/Editor/AutoFitView';
import tokens from '../theme/dark';

const nodeTypes: NodeTypes = {
  model: ModelNode, condition: ConditionNode, loop: LoopNode, input: InputNode, output: OutputNode, transform: TransformNode,
  'text-to-image': TextToImageNode, 'image-to-image': TextToImageNode, 'image-editor': TextToImageNode, 'image-upscale': TextToImageNode,
  'text-to-video': TextToVideoNode, 'image-to-video': TextToVideoNode, 'video-to-video': TextToVideoNode, 'video-upscale': TextToVideoNode,
  'ai-chat': AIAgentNode, 'script-writer': AIAgentNode, storyboard: AIAgentNode,
  'character-create': TextToImageNode, 'face-swap': TextToImageNode, 'character-swap': TextToImageNode,
  'text-to-speech': ModelNode, 'music-generation': ModelNode,
};
type Port = { name: string; displayName?: string; dataType: string };
type RunState = { nodeId: string; status: string; output?: Record<string, unknown>; error?: { message?: string } };
type Run = { runId: string; workflowId: string; status: string; createdAt?: string; nodeStates?: RunState[] };
const terminal = new Set(['succeeded', 'failed', 'cancelled']);
const cleanData = (data: WorkflowNodeData): WorkflowNodeData => {
  const { type, label, modelId, modelSelection, parameters, conditions, loopConfig, transform, textDocument, messages } = data;
  return { type, label, modelId, modelSelection, parameters, conditions, loopConfig, transform, textDocument, messages };
};
const errorText = (error: unknown) => {
  const text = isAxiosError<{ message?: string | string[] }>(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : '请求失败，请重试';
  return Array.isArray(text) ? text.join('；') : String(text);
};
const graphData = (name: string, nodes: Node<WorkflowNodeData>[], edges: Edge[], viewport: Viewport) => ({
  name, viewport,
  nodes: nodes.map(n => ({ id: n.id, type: n.type, position: n.position, data: cleanData(n.data) })),
  edges: edges.map(e => ({ id: e.id, source: { nodeId: e.source, port: e.sourceHandle || 'output' }, target: { nodeId: e.target, port: e.targetHandle || 'input' }, ...(typeof e.label === 'string' ? { label: e.label } : {}), ...(e.data?.branchId ? { branchId: e.data.branchId } : {}) })),
});

function WorkflowEditorInner() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const initialModel = searchParams.get('model');
  const initialModelType = searchParams.get('type');
  const initialModelProvider = searchParams.get('provider');
  const initialConfigId = searchParams.get('config');
  const { t } = useI18n();
  const navigate = useNavigate();
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const flow = useReactFlow();
  const { name, setName, selectedNodeId, setSelectedNode, isExecuting, setIsExecuting, setRunId } = useWorkflowStore();
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [loading, setLoading] = useState(true);
  const [loadedWorkflowId, setLoadedWorkflowId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [baseline, setBaseline] = useState('');
  const [sidebarAction, setSidebarAction] = useState<SidebarAction | null>(null);
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [parameterId, setParameterId] = useState<string | null>(null);
  const [assets, setAssets] = useState<{ open: boolean; nodeId?: string }>({ open: false });
  const [assetChoice, setAssetChoice] = useState<{ nodeId: string; modelId: string; asset: WorkflowAsset; fields: string[]; definitions: Record<string, ParamDefinition> } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyNodeId, setHistoryNodeId] = useState<string>();
  const [historyPage, setHistoryPage] = useState(1);
  const [historyStatus, setHistoryStatus] = useState<string>();
  const [historyWorkflowId, setHistoryWorkflowId] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<Run[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [pollError, setPollError] = useState('');
  const [operation, setOperation] = useState(false);
  const [chatText, setChatText] = useState('');
  const [portSchemas, setPortSchemas] = useState<Record<string, { inputPorts: Port[]; outputPorts: Port[] }>>({});
  const [connecting, setConnecting] = useState<{ nodeId: string; port: string; direction: 'source' | 'target' } | null>(null);
  const clipboard = useRef<Node<WorkflowNodeData> | null>(null);
  const workflowId = useRef<string | null>(null);
  const metadata = useRef<Record<string, unknown>>({});
  const savingPromise = useRef<Promise<string> | null>(null);
  const busy = useRef(false);
  const busyAsset = useRef(false);
  const poll = useRef<{ timer?: ReturnType<typeof setTimeout>; controller?: AbortController; generation: number }>({ generation: 0 });
  const mounted = useRef(true);
  const latest = useRef({ nodes, edges, name, viewport });
  latest.current = { nodes, edges, name, viewport };
  const dirty = !loading && JSON.stringify(graphData(name, nodes, edges, viewport)) !== baseline;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const outputRuns = useRef<Record<string, string>>({});
  const documentGeneration = useRef(0);
  const historySelection = useRef(0);
  const historyRequest = useRef(0);
  const routeId = useRef(id);
  routeId.current = id;
  const operationPending = useRef(false);
  const assetSelection = useRef(0);
  const isCurrentDocument = (generation: number) => mounted.current && generation === documentGeneration.current;
  const historyReady = !loading && !!id && loadedWorkflowId === id && workflowId.current === id;
  const historyVisible = historyReady && historyWorkflowId === id;
  const isCurrentHistoryDocument = (generation: number, owner: string) => isCurrentDocument(generation) && routeId.current === owner && workflowId.current === owner;
  const selectedNode = nodes.find(n => n.id === selectedNodeId);

  const stopPolling = useCallback(() => {
    poll.current.generation++;
    clearTimeout(poll.current.timer);
    poll.current.controller?.abort();
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; documentGeneration.current++; stopPolling(); setIsExecuting(false); };
  }, [stopPolling, setIsExecuting]);
  useEffect(() => {
    const confirmLeave = () => !dirtyRef.current || window.confirm('当前工作流有未保存修改，确定离开并丢弃修改？');
    const push = navigator.push.bind(navigator), replace = navigator.replace.bind(navigator), go = navigator.go.bind(navigator);
    let index = window.history.state?.idx ?? 0;
    let restoring = false;
    navigator.push = (...args) => { if (confirmLeave()) { push(...args); index = window.history.state?.idx ?? index; } };
    navigator.replace = (...args) => { if (confirmLeave()) { replace(...args); index = window.history.state?.idx ?? index; } };
    navigator.go = (...args) => go(...args);
    const popstate = (event: PopStateEvent) => {
      const nextIndex = event.state?.idx;
      if (restoring) { restoring = false; return; }
      if (typeof nextIndex === 'number' && nextIndex !== index && !confirmLeave()) {
        event.stopImmediatePropagation(); restoring = true; window.history.go(index - nextIndex);
      } else if (typeof nextIndex === 'number') index = nextIndex;
    };
    window.addEventListener('popstate', popstate, true);
    const unload = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => { navigator.push = push; navigator.replace = replace; navigator.go = go; window.removeEventListener('beforeunload', unload); window.removeEventListener('popstate', popstate, true); };
  }, [navigator]);
  useEffect(() => {
    if (id && id === workflowId.current && !loading) return;
    let alive = true;
    documentGeneration.current++;
    stopPolling(); busy.current = false;
    operationPending.current = false; busyAsset.current = false; savingPromise.current = null;
    historySelection.current++; assetSelection.current++;
    historyRequest.current++;
    setLoadedWorkflowId(null); setHistoryWorkflowId(null);
    setHistoryItems([]); setHistoryTotal(0); setHistoryError(''); setHistoryLoading(false);
    setHistoryPage(1); setHistoryStatus(undefined); setHistoryNodeId(undefined); setHistoryRefresh(0);
    setOperation(false); setSaving(false); setValidating(false); setAssetChoice(null);
    useWorkflowStore.getState().reset();
    setNodes([]); setEdges([]); setRun(null); setSelectedRun(null); setSidebarAction(null);
    setParameterId(null); setAssets({ open: false }); setHistoryOpen(false); setConnecting(null);
    setContextMenu(null); setPollError(''); setChatText(''); clipboard.current = null; outputRuns.current = {};
    metadata.current = {}; workflowId.current = id && id !== 'new' ? id : null;
    setLoading(true);
    const load = async () => {
      try {
        const response = workflowId.current ? await workflowApi.get(workflowId.current) : null;
        if (!alive) return;
        const data = response?.data;
        const nextNodes: Node<WorkflowNodeData>[] = (data?.nodes || []).map(n => ({ id: n.id, type: n.type, position: n.position, data: { ...n.data, type: n.type as NodeType } }));
        if (!data && initialModel) {
          const model = await catalogApi.detail(initialModel, initialModelType, undefined, initialModelProvider, initialConfigId);
          if (!alive) return;
          const nodeType = Object.entries(NODE_TYPE_TO_MODEL_TYPE).find(([, type]) => type === model.model_type)?.[0] as NodeType || 'model';
          nextNodes.push({ id: crypto.randomUUID(), type: nodeType, position: { x: 200, y: 160 }, data: { type: nodeType, label: model.model_name || model.model_id, modelId: model.model_id, modelSelection: { configId: model.config_id, configRevision: model.revision || 0, featureType: model.model_type, provider: model.provider }, parameters: Object.fromEntries(model.params.filter(param => param.default !== undefined).map(param => [param.name, param.default])) } });
        }
        const nextEdges = (data?.edges || []).map(e => ({ id: e.id, source: e.source.nodeId, target: e.target.nodeId, sourceHandle: e.source.port, targetHandle: e.target.port, label: e.label, data: { branchId: e.branchId } }));
        const nextViewport = data?.viewport || { x: 0, y: 0, zoom: 1 };
        const nextName = data?.name || '未命名工作流';
        if (data) metadata.current = Object.fromEntries(['description', 'inputSchema', 'outputMapping', 'executionConfig', 'tags'].filter(key => data[key] !== undefined).map(key => [key, data[key]]));
        setName(nextName); setNodes(nextNodes); setEdges(nextEdges); setViewport(nextViewport);
        void flow.setViewport(nextViewport);
        setBaseline(JSON.stringify(graphData(nextName, nextNodes, nextEdges, nextViewport)));
        setLoadedWorkflowId(workflowId.current);
      } catch (error) { if (alive) message.error(errorText(error)); }
      finally { if (alive) setLoading(false); }
    };
    void load();
    return () => { alive = false; };
  }, [id, initialModel, initialModelType, initialModelProvider, initialConfigId, setNodes, setEdges, setName, stopPolling, flow]);
  useEffect(() => {
    const ids = [...new Set(nodes.map(n => n.data.modelId).filter((value): value is string => !!value))];
    let alive = true;
    for (const modelId of ids) {
      if (portSchemas[modelId]) continue;
      workflowApi.getModelPortSchema(modelId).then(response => {
        if (alive) setPortSchemas(current => ({ ...current, [modelId]: response.data }));
      }).catch(() => { /* The connection picker offers an explicit retry. */ });
    }
    return () => { alive = false; };
  }, [nodes.map(n => n.data.modelId).join('|'), portSchemas]);
  const updateNodeData = useCallback((nodeId: string, data: Partial<WorkflowNodeData>) => {
    setNodes(current => current.map(n => n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n));
  }, [setNodes]);
  const deleteNode = useCallback((nodeId: string) => {
    setNodes(current => current.filter(n => n.id !== nodeId));
    setEdges(current => current.filter(e => e.source !== nodeId && e.target !== nodeId));
    if (selectedNodeId === nodeId) setSelectedNode(null);
  }, [selectedNodeId, setNodes, setEdges, setSelectedNode]);
  const paste = useCallback((source?: Node<WorkflowNodeData>) => {
    const original = source || clipboard.current;
    if (!original) return;
    const copy: Node<WorkflowNodeData> = { id: crypto.randomUUID(), type: original.type, position: findNearbyPosition(original.position, latest.current.nodes), selected: true, data: structuredClone(cleanData(original.data)) };
    setNodes(current => [...current.map(n => ({ ...n, selected: false })), copy]); setSelectedNode(copy.id);
  }, [setNodes, setSelectedNode]);
  const copyNode = useCallback((nodeId: string) => {
    const node = latest.current.nodes.find(n => n.id === nodeId);
    if (node) { clipboard.current = structuredClone({ ...node, data: cleanData(node.data) }); message.success('已复制节点，可使用粘贴创建副本'); }
  }, []);
  const copySystem = async (nodeId: string) => {
    const node = latest.current.nodes.find(n => n.id === nodeId);
    if (!node) return;
    try { await navigatorClipboard(JSON.stringify({ id: node.id, type: node.type, position: node.position, data: cleanData(node.data) }, null, 2)); message.success('节点已写入系统剪贴板'); }
    catch (error) { message.error(errorText(error)); }
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]') || document.querySelector('.ant-modal-wrap:not([style*="display: none"]), .ant-drawer-open')) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        const selectedEdges = flow.getEdges().filter(edge => edge.selected);
        if (selectedEdges.length) {
          const edgeIds = new Set(selectedEdges.map(edge => edge.id));
          setEdges(current => current.filter(edge => !edgeIds.has(edge.id)));
          setSelectedNode(null);
          return;
        }
        const selectedNode = flow.getNodes().find(node => node.id === selectedNodeId && node.selected);
        if (selectedNode) deleteNode(selectedNode.id);
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        if (event.key === 'c' && selectedNodeId) { event.preventDefault(); copyNode(selectedNodeId); }
        if (event.key === 'v') { event.preventDefault(); paste(); }
        if (event.key === 'd' && selectedNodeId) { event.preventDefault(); paste(latest.current.nodes.find(n => n.id === selectedNodeId)); }
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [selectedNodeId, deleteNode, copyNode, paste, setEdges, setSelectedNode, flow]);
  const currentGraph = () => graphData(latest.current.name, latest.current.nodes, latest.current.edges, latest.current.viewport);
  const validateGraph = async () => {
    const generation = documentGeneration.current;
    const response = await workflowApi.validate(currentGraph());
    if (!isCurrentDocument(generation)) throw new Error('已离开此工作流');
    if (!response.data?.valid) {
      const errors = response.data?.errors || [];
      const nodeId = errors.find(error => error.nodeId)?.nodeId;
      if (nodeId) { setSelectedNode(nodeId); void flow.fitView({ nodes: [{ id: nodeId }], padding: 0.5 }); }
      const edgeIds = new Set(errors.map(error => error.edgeId).filter(Boolean));
      setEdges(current => current.map(edge => ({ ...edge, selected: edgeIds.has(edge.id) })));
      throw new Error(errors.map(error => error.message).join('；') || '图校验失败');
    }
  };
  const saveGraph = (): Promise<string> => {
    if (savingPromise.current) return savingPromise.current;
    const generation = documentGeneration.current;
    const graph = currentGraph(); setSaving(true);
    const task = (async () => {
      const existing = workflowId.current;
      const response = existing ? await workflowApi.update(existing, { ...metadata.current, ...graph }) : await workflowApi.create({ ...metadata.current, ...graph });
      if (!mounted.current || generation !== documentGeneration.current) throw new Error('已离开此工作流，保存响应不再应用到当前编辑器');
      const savedId = existing || response.data?._id || response.data?.id;
      if (!savedId) throw new Error('保存响应缺少工作流 ID');
      workflowId.current = savedId; setLoadedWorkflowId(savedId); setBaseline(JSON.stringify(graph));
      if (!existing) { const wasDirty = dirtyRef.current; dirtyRef.current = false; navigate(`/workflows/${savedId}`, { replace: true }); dirtyRef.current = wasDirty; }
      return savedId;
    })().finally(() => { if (isCurrentDocument(generation)) { savingPromise.current = null; setSaving(false); } });
    savingPromise.current = task; return task;
  };
  const handleValidate = async () => {
    const generation = documentGeneration.current;
    setValidating(true);
    try { await validateGraph(); if (isCurrentDocument(generation)) message.success('校验通过'); }
    catch (error) { if (isCurrentDocument(generation)) message.error(errorText(error)); }
    finally { if (isCurrentDocument(generation)) setValidating(false); }
  };
  const handleSave = async () => {
    const generation = documentGeneration.current;
    try { await saveGraph(); if (isCurrentDocument(generation)) message.success('保存成功'); }
    catch (error) { if (isCurrentDocument(generation)) message.error(errorText(error)); }
  };
  const applyRun = (next: Run) => {
    setRun(next); setRunId(next.runId); setIsExecuting(!terminal.has(next.status));
    const states = new Map((next.nodeStates || []).map(state => [state.nodeId, state]));
    setNodes(current => current.map(node => {
      const state = states.get(node.id); if (!state) return node;
      if (state.output !== undefined) outputRuns.current[node.id] = next.runId;
      return { ...node, data: { ...node.data, executionStatus: state.status === 'succeeded' ? 'success' : state.status === 'failed' ? 'error' : state.status === 'running' || state.status === 'pending' ? 'running' : 'idle', progress: undefined, output: state.output } };
    }));
    if (terminal.has(next.status)) busy.current = false;
  };
  const monitor = (runId: string) => {
    if (!mounted.current) return;
    stopPolling(); setPollError(''); setIsExecuting(true);
    const generation = poll.current.generation;
    const owner = workflowId.current;
    const document = documentGeneration.current;
    const current = () => !!owner && generation === poll.current.generation && isCurrentHistoryDocument(document, owner);
    const tick = async () => {
      const controller = new AbortController(); poll.current.controller = controller;
      try {
        const response = await workflowApi.getRun(runId, controller.signal);
        if (!current()) return;
        const next = response.data as Run; applyRun(next); setPollError(''); if (terminal.has(next.status)) return;
      } catch (error) {
        if (controller.signal.aborted || !current()) return;
        setPollError(`状态读取失败：${errorText(error)}。不会把仍在运行的任务标记失败。`);
        if (isAxiosError(error) && [401, 403, 404].includes(error.response?.status || 0)) return;
      }
      if (current()) poll.current.timer = setTimeout(tick, 1500);
    };
    void tick();
  };
  const execute = async (nodeId?: string) => {
    if (busy.current || savingPromise.current) return;
    busy.current = true; setIsExecuting(true);
    const generation = documentGeneration.current;
    try {
      const targets = nodeId ? latest.current.nodes.filter(n => n.id === nodeId) : latest.current.nodes;
      const missing = targets.find(n => nodeTypeSupportsModel(n.data.type) && !n.data.modelId);
      if (missing) { setParameterId(missing.id); throw new Error('请先为节点选择模型'); }
      await validateGraph();
      if (!mounted.current || generation !== documentGeneration.current) return;
      const savedId = await saveGraph();
      if (!mounted.current || generation !== documentGeneration.current) return;
      const response = nodeId ? await workflowApi.runNode(savedId, nodeId, {}) : await workflowApi.run(savedId, {});
      if (!mounted.current || generation !== documentGeneration.current) return;
      setRun({ runId: response.data.runId, workflowId: savedId, status: 'pending' }); setRunId(response.data.runId); monitor(response.data.runId);
    } catch (error) { if (mounted.current && generation === documentGeneration.current) {
      busy.current = false; setIsExecuting(false);
      message.error(needsWorkflowApiKey(error) ? t('Model billing is temporarily unavailable. Your workflow is saved. Please retry later or contact an administrator.') : errorText(error));
    } }
  };
  const cancelRun = async () => {
    if (!run || operationPending.current) return;
    const generation = documentGeneration.current;
    operationPending.current = true; setOperation(true);
    try {
      await workflowApi.cancelRun(run.runId);
      if (isCurrentDocument(generation)) monitor(run.runId);
    } catch (error) { if (isCurrentDocument(generation)) message.error(errorText(error)); }
    finally { if (isCurrentDocument(generation)) { operationPending.current = false; setOperation(false); } }
  };
  const retryRun = async (target: Run) => {
    if (!historyReady || target.workflowId !== id || busy.current || operationPending.current) return;
    const owner = target.workflowId;
    const generation = documentGeneration.current;
    operationPending.current = true; setOperation(true); busy.current = true;
    try {
      await workflowApi.retryRun(target.runId);
      if (isCurrentHistoryDocument(generation, owner)) { setRun(target); setRunId(target.runId); monitor(target.runId); }
    } catch (error) { if (isCurrentHistoryDocument(generation, owner)) { busy.current = false; message.error(errorText(error)); } }
    finally { if (isCurrentHistoryDocument(generation, owner)) { operationPending.current = false; setOperation(false); } }
  };
  const portsFor = (node: Node<WorkflowNodeData>, direction: 'source' | 'target'): Port[] => {
    if (node.data.modelId) return portSchemas[node.data.modelId]?.[direction === 'source' ? 'outputPorts' : 'inputPorts'] || [];
    if (node.type === 'condition' && direction === 'source') return [...(node.data.conditions || []).map(rule => ({ name: rule.branchId, dataType: 'any' })), { name: 'default', dataType: 'any' }];
    return getNodeDefinition(node.type as NodeType)?.[direction === 'source' ? 'outputs' : 'inputs'] || [];
  };
  const isValidConnection = (connection: Connection) => {
    const { source, target, sourceHandle, targetHandle } = connection;
    if (!source || !target || source === target || !sourceHandle || !targetHandle) return false;
    const sourceNode = nodes.find(n => n.id === source), targetNode = nodes.find(n => n.id === target);
    if (!sourceNode || !targetNode) return false;
    const output = portsFor(sourceNode, 'source').find(p => p.name === sourceHandle), input = portsFor(targetNode, 'target').find(p => p.name === targetHandle);
    if (!output || !input) return false;
    const normalType = (type: string) => ['text', 'image', 'video', 'audio'].includes(type) ? 'string' : type;
    if (output.dataType !== 'any' && input.dataType !== 'any' && normalType(output.dataType) !== normalType(input.dataType)) return false;
    if (edges.some(e => e.source === source && e.target === target && e.sourceHandle === sourceHandle && e.targetHandle === targetHandle)) return false;
    const visited = new Set<string>(); const pending = [target];
    while (pending.length) { const current = pending.pop()!; if (current === source) return false; if (visited.has(current)) continue; visited.add(current); for (const edge of edges) if (edge.source === current) pending.push(edge.target); }
    return true;
  };
  const connect = (connection: Connection) => {
    if (!isValidConnection(connection)) { message.warning('连接无效：请检查端口类型、重复连接或环路'); return; }
    const source = nodes.find(n => n.id === connection.source);
    setEdges(current => addEdge({ ...connection, data: source?.type === 'condition' ? { branchId: connection.sourceHandle } : undefined }, current)); setConnecting(null);
  };
  const openConnection = async (nodeId: string, port: string, direction: 'source' | 'target') => {
    const generation = documentGeneration.current;
    setConnecting({ nodeId, port, direction });
    try {
      const models = [...new Set(latest.current.nodes.map(node => node.data.modelId).filter((value): value is string => !!value))];
      const schemas = await Promise.all(models.map(async modelId => [modelId, (await workflowApi.getModelPortSchema(modelId)).data] as const));
      if (!isCurrentDocument(generation)) return;
      setPortSchemas(current => ({ ...current, ...Object.fromEntries(schemas) }));
    } catch (error) { if (isCurrentDocument(generation)) message.error(`无法加载连接端口：${errorText(error)}`); }
  };
  const connectionOptions = connecting ? nodes.flatMap(node => portsFor(node, connecting.direction === 'source' ? 'target' : 'source').map(port => {
    const connection: Connection = connecting.direction === 'source' ? { source: connecting.nodeId, sourceHandle: connecting.port, target: node.id, targetHandle: port.name } : { target: connecting.nodeId, targetHandle: connecting.port, source: node.id, sourceHandle: port.name };
    return { node, port, connection };
  }).filter(option => isValidConnection(option.connection))) : [];
  const addNode = (type: NodeType, position?: { x: number; y: number }) => {
    if (!nodeTypes[type]) return;
    const bounds = document.querySelector('.react-flow')?.getBoundingClientRect();
    const anchor = position || getViewportCenter(flow.getViewport(), bounds?.width || window.innerWidth, bounds?.height || window.innerHeight - 52);
    const node: Node<WorkflowNodeData> = { id: crypto.randomUUID(), type, position: findNonOverlappingPosition(anchor, nodes), data: { type, label: getNodeDefinition(type)?.label || type } };
    setNodes(current => [...current, node]); setSelectedNode(node.id); setSidebarAction(null);
  };
  const openHistory = (nodeId?: string) => { if (loading || (workflowId.current && !historyReady)) return; setHistoryNodeId(nodeId); setHistoryPage(1); setSelectedRun(null); setHistoryOpen(true); setHistoryRefresh(value => value + 1); };
  useEffect(() => {
    if (!historyOpen || !historyReady || !id) return;
    const owner = id;
    const generation = documentGeneration.current;
    const request = ++historyRequest.current;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && request === historyRequest.current && isCurrentHistoryDocument(generation, owner);
    setHistoryWorkflowId(owner); setHistoryLoading(true); setHistoryError('');
    workflowApi.listRuns(owner, { page: historyPage, pageSize: 20, status: historyStatus }, controller.signal).then(response => {
      if (current()) { setHistoryItems(response.data.items.filter(entry => entry.workflowId === owner)); setHistoryTotal(response.data.total); }
    }).catch(error => { if (current()) setHistoryError(errorText(error)); }).finally(() => { if (current()) setHistoryLoading(false); });
    return () => controller.abort();
  }, [id, historyReady, historyOpen, historyPage, historyStatus, historyRefresh]);
  const chooseHistory = async (entry: Run) => {
    if (!historyReady || entry.workflowId !== id) return;
    const owner = entry.workflowId;
    const selection = ++historySelection.current;
    const generation = documentGeneration.current;
    try {
      const response = await workflowApi.getRun(entry.runId);
      if (isCurrentHistoryDocument(generation, owner) && selection === historySelection.current && response.data.workflowId === owner) setSelectedRun(response.data);
    } catch (error) { if (isCurrentHistoryDocument(generation, owner) && selection === historySelection.current) message.error(errorText(error)); }
  };
  const applyHistory = (state: RunState) => {
    if (!historyReady || !selectedRun || selectedRun.workflowId !== id || state.output === undefined) return;
    updateNodeData(state.nodeId, { output: state.output, executionStatus: state.status === 'succeeded' ? 'success' : 'idle' }); outputRuns.current[state.nodeId] = selectedRun.runId;
    setSelectedNode(state.nodeId); message.success('已应用选中运行的节点输出；不会改写节点参数');
  };
  const saveAsset = async (nodeId: string) => {
    const runId = outputRuns.current[nodeId];
    if (!workflowId.current || !runId) { message.warning('请先运行节点，或选择一次有输出的历史运行'); return; }
    if (busyAsset.current) return; busyAsset.current = true;
    const generation = documentGeneration.current;
    try {
      await workflowAssetsApi.fromOutput({ workflowId: workflowId.current, runId, nodeId });
      if (isCurrentDocument(generation)) message.success('已保存真实输出到素材库');
    } catch (error) { if (isCurrentDocument(generation)) message.error(errorText(error)); }
    finally { if (isCurrentDocument(generation)) busyAsset.current = false; }
  };
  const feedback = async (nodeId: string) => {
    const node = nodes.find(item => item.id === nodeId);
    const diagnostic = { schema: 1, workflowId: workflowId.current, nodeId, nodeType: node?.type, modelId: node?.data.modelId, runId: outputRuns.current[nodeId] || run?.runId, runStatus: run?.status, nodeStatus: run?.nodeStates?.find(state => state.nodeId === nodeId)?.status, graph: { nodes: nodes.length, edges: edges.length }, time: new Date().toISOString() };
    try { await navigatorClipboard(JSON.stringify(diagnostic, null, 2)); message.success('已复制脱敏诊断：不包含提示词、输出、凭据或用户资料'); } catch (error) { message.error(errorText(error)); }
  };
  const selectAsset = async (asset: WorkflowAsset) => {
    const node = latest.current.nodes.find(item => item.id === (assets.nodeId || selectedNodeId));
    if (!node?.data.modelId) { message.warning('请选中节点并先配置模型'); return; }
    const generation = documentGeneration.current;
    const selection = ++assetSelection.current;
    try {
      const response = await modelApi.getByName(node.data.modelId); const fields = findMediaParams(response.data.params || {}, asset.kind);
      if (!isCurrentDocument(generation) || selection !== assetSelection.current) return;
      if (!fields.length) { message.warning(`模型没有可接收 ${asset.kind} 的参数，请选择其他模型或素材`); return; }
      setAssetChoice({ nodeId: node.id, modelId: node.data.modelId, asset, fields, definitions: response.data.params || {} });
    } catch (error) { if (isCurrentDocument(generation) && selection === assetSelection.current) message.error(errorText(error)); }
  };
  const applyAsset = (field: string) => {
    if (!assetChoice) return;
    const node = latest.current.nodes.find(item => item.id === assetChoice.nodeId);
    if (!node || node.data.modelId !== assetChoice.modelId) { message.warning('节点或模型已改变，请重新选择素材'); setAssetChoice(null); return; }
    if (assetChoice.asset.kind === 'text' && assetChoice.asset.text === undefined) { message.error('此文本素材没有可读取的正文，不能将文件 URL 当作提示词'); return; }
    const definition = assetChoice.definitions[field];
    if (!definition || (definition.type !== 'string' && definition.type !== 'array')) {
      message.error('此参数不是字符串或素材数组；请在完整参数面板按模型要求配置，素材库不会猜测对象结构');
      return;
    }
    const value = assetChoice.asset.kind === 'text' ? assetChoice.asset.text : assetChoice.asset.url;
    updateNodeData(node.id, { parameters: { ...node.data.parameters, [field]: definition.type === 'array' ? [value] : value }, ...(field === 'prompt' ? { textDocument: undefined } : {}) });
    setAssetChoice(null); setAssets({ open: false }); message.success('素材已写入模型参数');
  };
  const writeMessages = (messages: NonNullable<WorkflowNodeData['messages']>) => {
    if (!selectedNode) return;
    updateNodeData(selectedNode.id, { messages, parameters: { ...selectedNode.data.parameters, prompt: messages.map(item => `${item.role === 'user' ? '用户' : '助手'}：${item.content}`).join('\n\n') }, textDocument: undefined });
  };
  const sendChat = () => {
    if (!selectedNode || !chatText.trim()) return;
    writeMessages([...(selectedNode.data.messages || []), { role: 'user', content: chatText.trim() }]); setChatText('');
  };
  const appendAssistant = () => {
    if (!selectedNode) return; const text = selectedNode.data.output?.text;
    if (typeof text !== 'string') { message.warning('当前节点没有可用文本输出'); return; }
    writeMessages([...(selectedNode.data.messages || []), { role: 'assistant', content: text }]);
  };
  const contextNode = nodes.find(node => node.id === contextMenu?.nodeId);
  return (
    <WorkflowEditorContext.Provider value={{ onRunNode: execute, onUpdateNode: updateNodeData, onCopyNode: copyNode, onDeleteNode: deleteNode, onExpandNode: setParameterId, onOpenParameters: setParameterId, onOpenAssets: nodeId => setAssets({ open: true, nodeId }), onConnectPort: openConnection, onOpenHistory: openHistory }}>
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: tokens.bg.primary }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 52, padding: '0 16px', background: tokens.bg.secondary, borderBottom: `1px solid ${tokens.border.default}`, zIndex: 10 }}>
          <Space><Tooltip title="返回工作流列表"><Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/works?type=workflow')} /></Tooltip><Divider type="vertical" /><Input value={name} onChange={event => setName(event.target.value)} placeholder="工作流名称" variant="borderless" style={{ width: 220 }} /><span>{dirty ? '未保存' : '已保存'}</span></Space>
          <Space><Tooltip title="放大"><Button type="text" icon={<ZoomInOutlined />} onClick={() => flow.zoomIn()} /></Tooltip><Tooltip title="缩小"><Button type="text" icon={<ZoomOutOutlined />} onClick={() => flow.zoomOut()} /></Tooltip><Tooltip title="适应画布"><Button type="text" icon={<ExpandOutlined />} onClick={() => flow.fitView(manualFitViewOptions)} /></Tooltip></Space>
          <Space><LanguageSwitcher /><TemplateSubmissionButton kind="workflow" name={name} prepare={saveGraph} disabled={loading || saving || isExecuting || !nodes.length} /><Button icon={<CheckCircleOutlined />} loading={validating} onClick={handleValidate}>{t('Validate')}</Button><Button icon={<SaveOutlined />} loading={saving} disabled={loading || isExecuting} onClick={handleSave}>{t('Save')}</Button><Button type="primary" icon={<PlayCircleOutlined />} loading={isExecuting} disabled={loading || saving || !nodes.length} onClick={() => execute()}>{t('Run')}</Button>{run && <Tag>{run.status}</Tag>}{run && !terminal.has(run.status) && <Button danger loading={operation} onClick={cancelRun}>{t('Cancel run')}</Button>}{run?.status === 'failed' && <Button loading={operation} disabled={!historyReady || run.workflowId !== id} onClick={() => retryRun(run)}>{t('Retry failed nodes')}</Button>}</Space>
        </div>
        {loadedWorkflowId && <WorkflowDramaBridge key={loadedWorkflowId} workflowId={loadedWorkflowId} run={selectedRun || run} disabled={loading || isExecuting} />}
        {pollError && <Alert type="warning" message={pollError} action={<Button onClick={() => run && monitor(run.runId)}>重新连接状态</Button>} />}
        <div style={{ flex: 1, position: 'relative' }}>
          {loading && <Spin style={{ position: 'absolute', left: '50%', top: '40%', zIndex: 100 }} />}
          <EditorSidebar activeAction={sidebarAction} onAction={action => { if (action === 'templates') navigate('/templates'); else if (action === 'profile') navigate('/profile'); else if (action === 'history') openHistory(); else if (action === 'assets') setAssets({ open: true, nodeId: selectedNodeId || undefined }); else setSidebarAction(current => current === action ? null : action); }} />
          {selectedNode && <Space style={{ position: 'absolute', right: 20, top: 16, zIndex: 20, padding: 8, background: tokens.bg.secondary, borderRadius: 8 }}>
            <span>{selectedNode.data.label}</span>
            <Button type="primary" onClick={() => setParameterId(selectedNode.id)}>完整配置</Button>
          </Space>}
          <AddNodeMenu open={sidebarAction === 'add'} position={{ x: 80, y: Math.max(60, window.innerHeight / 2 - 160) }} onSelect={addNode} onClose={() => setSidebarAction(null)} />
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={connect} isValidConnection={isValidConnection} onMoveEnd={(_, next) => setViewport(next)} onNodeClick={(_, node) => { setSelectedNode(node.id); setContextMenu(null); }} onNodeDoubleClick={(_, node) => setParameterId(node.id)} onNodeContextMenu={(event, node) => { event.preventDefault(); setSelectedNode(node.id); setContextMenu({ nodeId: node.id, x: event.clientX, y: event.clientY }); }} onEdgeClick={() => setSelectedNode(null)} onEdgeDoubleClick={(_, edge) => setEdges(current => current.filter(item => item.id !== edge.id))} onPaneClick={() => { setContextMenu(null); setSelectedNode(null); if (sidebarAction === 'add') setSidebarAction(null); }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }} onDrop={event => { event.preventDefault(); const type = event.dataTransfer.getData('application/reactflow') as NodeType; if (!nodeTypes[type]) return; const bounds = event.currentTarget.getBoundingClientRect(); addNode(type, flow.project({ x: event.clientX - bounds.left, y: event.clientY - bounds.top })); }} nodeTypes={nodeTypes} deleteKeyCode={null} defaultEdgeOptions={{ style: { stroke: 'rgba(255,255,255,0.3)', strokeWidth: 1.5 } }}>
            <Controls /><MiniMap style={{ background: tokens.bg.secondary }} nodeColor={() => 'rgba(255,255,255,0.2)'} /><Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(255,255,255,0.06)" />
          </ReactFlow>
          {contextMenu && contextNode && <NodeContextMenu open position={contextMenu} nodeType={contextNode.type} onClose={() => setContextMenu(null)} onCopy={() => copyNode(contextNode.id)} onPaste={() => paste()} onDuplicate={() => paste(contextNode)} onDelete={() => deleteNode(contextNode.id)} onRun={() => execute(contextNode.id)} canPaste={!!clipboard.current} canRun={!isExecuting && !saving} onConfigure={() => setParameterId(contextNode.id)} onSystemCopy={() => copySystem(contextNode.id)} onSaveAsset={() => saveAsset(contextNode.id)} onHistory={() => openHistory(contextNode.id)} onFeedback={() => feedback(contextNode.id)} />}
        </div>
        <NodeParametersPanel node={nodes.find(node => node.id === parameterId) || null} open={!!parameterId} onClose={() => setParameterId(null)} onUpdate={updateNodeData} />
        <AssetsPanel open={assets.open} nodeId={assets.nodeId} onClose={() => setAssets({ open: false })} onSelect={selectAsset} />
        <Modal open={!!assetChoice} title="选择素材写入的模型参数" footer={null} onCancel={() => setAssetChoice(null)}><Space direction="vertical">{assetChoice?.fields.map(field => <Button key={field} onClick={() => applyAsset(field)}>{field}</Button>)}</Space></Modal>

        <Modal open={!!connecting} title="选择连接目标端口" footer={null} onCancel={() => setConnecting(null)}><p>只列出类型兼容、不会产生环路或重复边的端口。</p>{!connectionOptions.length && <Alert type="info" message="暂无兼容端口：请添加目标节点、选择模型，或重试加载端口。" />}<List dataSource={connectionOptions} renderItem={option => <List.Item><Button onClick={() => connect(option.connection)}>{option.node.data.label} / {option.port.displayName || option.port.name}</Button></List.Item>} />{connecting && <Button onClick={() => openConnection(connecting.nodeId, connecting.port, connecting.direction)}>重新加载端口</Button>}</Modal>
        <Drawer title="运行历史" width={640} open={historyOpen && !loading && (!workflowId.current || historyReady)} onClose={() => setHistoryOpen(false)}>
          {!workflowId.current ? <Alert type="info" message="新工作流尚未保存，没有运行历史。" /> : <><Space><Select allowClear disabled={!historyReady} placeholder="所有状态" value={historyStatus} onChange={value => { setHistoryStatus(value); setHistoryPage(1); }} style={{ width: 180 }} options={['pending', 'running', 'succeeded', 'failed', 'cancelled'].map(value => ({ value, label: value }))} /><Button disabled={!historyReady} onClick={() => setHistoryRefresh(value => value + 1)}>刷新</Button></Space>{historyVisible && historyError && <Alert type="error" message={historyError} />}<List loading={historyReady && historyLoading} dataSource={historyVisible ? historyItems : []} renderItem={entry => <List.Item actions={[<Button key="view" disabled={!historyReady || entry.workflowId !== id} onClick={() => chooseHistory(entry)}>查看输出</Button>, ...(entry.status === 'failed' ? [<Button key="retry" disabled={!historyReady || entry.workflowId !== id || isExecuting || operation} onClick={() => retryRun(entry)}>重试</Button>] : [])]}><List.Item.Meta title={entry.runId} description={`${entry.status} · ${entry.createdAt || ''}`} /></List.Item>} /><Pagination current={historyVisible ? historyPage : 1} pageSize={20} total={historyVisible ? historyTotal : 0} disabled={!historyReady} showSizeChanger={false} onChange={setHistoryPage} />{historyVisible && selectedRun?.workflowId === id && <><h3>已选择：{selectedRun.runId}</h3>{(selectedRun.nodeStates || []).filter(state => !historyNodeId || state.nodeId === historyNodeId).map(state => <div key={state.nodeId}><h4>{state.nodeId} · {state.status}</h4>{state.error?.message && <Alert type="error" message={state.error.message} />}<NodeOutputPreview output={state.output} /><Button disabled={!historyReady || state.output === undefined || !nodes.some(node => node.id === state.nodeId)} onClick={() => applyHistory(state)}>应用此节点输出</Button></div>)}</>}</>}
        </Drawer>
        <Drawer title="节点多轮对话" width={460} open={sidebarAction === 'chat'} onClose={() => setSidebarAction(null)}>{!selectedNode ? <Alert type="info" message="请先在画布选择一个节点。" /> : <><h3>{selectedNode.data.label}</h3><Alert type="info" message="消息按用户/助手顺序写入 prompt；运行仍使用该节点实际模型并可能产生费用。" /><List dataSource={selectedNode.data.messages || []} renderItem={item => <List.Item><div><strong>{item.role === 'user' ? '用户' : '助手'}</strong><p style={{ whiteSpace: 'pre-wrap' }}>{item.content}</p></div></List.Item>} /><Input.TextArea value={chatText} onChange={event => setChatText(event.target.value)} rows={5} /><Space wrap style={{ marginTop: 12 }}><Button onClick={sendChat} disabled={!chatText.trim()}>添加消息</Button><Button onClick={appendAssistant}>将当前文本输出加入对话</Button><Button type="primary" disabled={isExecuting || !!chatText.trim()} onClick={() => execute(selectedNode.id)}>运行对话节点</Button></Space></>}</Drawer>
      </div>
    </WorkflowEditorContext.Provider>
  );
}
async function navigatorClipboard(text: string) {
  if (!window.navigator.clipboard?.writeText) throw new Error('当前浏览器或页面安全上下文不支持系统剪贴板，请使用 HTTPS 或 localhost');
  await window.navigator.clipboard.writeText(text);
}
export default function WorkflowEditor() {
  return <ReactFlowProvider><WorkflowEditorInner /></ReactFlowProvider>;
}
