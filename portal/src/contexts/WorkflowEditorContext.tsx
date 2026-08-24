import { createContext, useContext } from 'react';
import { WorkflowNodeData } from '../store/workflow-store';

interface WorkflowEditorContextValue {
  onRunNode: (nodeId: string) => void;
  onUpdateNode: (nodeId: string, data: Partial<WorkflowNodeData>) => void;
}

export const WorkflowEditorContext = createContext<WorkflowEditorContextValue>({
  onRunNode: () => {},
  onUpdateNode: () => {},
});

export function useWorkflowEditor() {
  return useContext(WorkflowEditorContext);
}
