import { createContext, useContext } from 'react';
import { WorkflowNodeData } from '../store/workflow-store';

interface WorkflowEditorContextValue {
  onRunNode: (nodeId: string) => void;
  onUpdateNode: (nodeId: string, data: Partial<WorkflowNodeData>) => void;
  onCopyNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onExpandNode: (nodeId: string) => void;
  onOpenAssets: (nodeId?: string) => void;
  onConnectPort: (nodeId: string, port: string, direction: 'source' | 'target') => void;
  onOpenParameters: (nodeId: string) => void;
  onOpenHistory: (nodeId?: string) => void;
}

export const WorkflowEditorContext = createContext<WorkflowEditorContextValue | null>(null);

export function useWorkflowEditor() {
  const context = useContext(WorkflowEditorContext);
  if (!context) throw new Error('WorkflowEditorContext provider is required');
  return context;
}
