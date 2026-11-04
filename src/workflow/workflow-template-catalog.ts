import { WorkflowTemplate } from '../database/schemas/workflow-template.schema';

type CatalogTemplate = WorkflowTemplate & { _id?: unknown; createdAt?: Date; updatedAt?: Date };

/** Explicit projection: public discovery never returns parameters, defaults, credentials or owner IDs. */
export function templateCatalogEntry(template: CatalogTemplate, detail = false) {
  const definition = template.workflowDefinition;
  const nodes = definition?.nodes || [];
  const edges = definition?.edges || [];
  const summary = {
    id: String(template._id), name: template.name, description: template.description || '',
    category: template.category, tags: template.tags || [], thumbnail: template.thumbnail,
    // Existing templates are administered by the platform; community attribution is explicit.
    source: template.source || 'official', scenario: template.scenario, authorName: template.authorName,
    version: template.version, createdAt: template.createdAt, updatedAt: template.updatedAt,
    nodeCount: nodes.length,
    models: [...new Set(nodes.map(node => node.data?.modelId).filter((id): id is string => !!id))],
    inputs: Object.entries(definition?.inputSchema || {}).map(([name, field]) => ({ name, type: field.type, required: field.required })),
    outputs: Object.keys(definition?.outputMapping || {}),
  };
  if (!detail) return summary;
  return { ...summary, instructions: template.instructions || '', examples: (template.examples || []).map(example => ({
    title: example.title, mediaType: example.mediaType, inputUrl: example.inputUrl, inputMediaType: example.inputMediaType,
    outputUrl: example.outputUrl, description: example.description,
  })), graph: {
    nodes: nodes.map(node => ({ id: node.id, type: node.type, position: node.position,
      label: node.data?.label || node.type, modelId: node.data?.modelId })),
    edges: edges.map(edge => ({ id: edge.id, source: edge.source.nodeId, target: edge.target.nodeId, label: edge.label })),
  } };
}
