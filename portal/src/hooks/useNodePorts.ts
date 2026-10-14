import { useCallback, useEffect, useState } from 'react';
import { workflowApi } from '../services/workflow-api';

type NodePort = { id: string; name: string; displayName?: string; dataType: string };
type PortState = { modelId?: string; inputPorts: NodePort[]; outputPorts: NodePort[]; loading: boolean; error: string };
const empty = { inputPorts: [], outputPorts: [], loading: false, error: '' };

export function useNodePorts(modelId?: string) {
  const [state, setState] = useState<PortState>(empty);
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let alive = true;
    if (!modelId) { setState(empty); return; }
    setState({ ...empty, modelId, loading: true });
    workflowApi.getModelPortSchema(modelId).then((response) => {
      if (!alive) return;
      const schema = response.data as { inputPorts: Array<Omit<NodePort, 'id'>>; outputPorts: Array<Omit<NodePort, 'id'>> };
      setState({ modelId, loading: false, error: '', inputPorts: schema.inputPorts.map((port) => ({ ...port, id: port.name })), outputPorts: schema.outputPorts.map((port) => ({ ...port, id: port.name })) });
    }).catch((error: unknown) => {
      if (alive) setState({ ...empty, modelId, error: error instanceof Error ? error.message : '端口加载失败' });
    });
    return () => { alive = false; };
  }, [modelId, revision]);
  return { ...(state.modelId === modelId ? state : { ...empty, loading: !!modelId }), retry };
}
