/*
 * 端口 Schema 服务
 * 负责生成节点端口的输入输出定义
 */
import { Injectable, Logger } from '@nestjs/common';
import { PortDefinition } from './interfaces/execution-graph.interface';

/**
 * 节点端口 Schema
 */
export interface NodePortSchema {
  /** 节点类型 */
  nodeType: string;
  /** 输入端口定义 */
  inputPorts: PortDefinition[];
  /** 输出端口定义 */
  outputPorts: PortDefinition[];
}

/**
 * 端口 Schema 服务
 * 从 parameter-schema-system 获取模型参数并转换为端口定义
 */
@Injectable()
export class PortSchemaService {
  private readonly logger = new Logger(PortSchemaService.name);

  // 端口 Schema 缓存
  private readonly schemaCache = new Map<string, NodePortSchema>();

  /**
   * 获取模型的端口 Schema
   * @param modelId 模型 ID
   * @returns 端口 Schema
   */
  async getModelPortSchema(modelId: string): Promise<NodePortSchema> {
    this.logger.debug(`获取模型端口 Schema: ${modelId}`);

    // 检查缓存
    const cached = this.schemaCache.get(`model:${modelId}`);
    if (cached) {
      return cached;
    }

    // 模型参数由 model config 决定，统一以参数对象作为输入边界。
    const schema: NodePortSchema = {
      nodeType: 'model',
      inputPorts: [
        {
          name: 'input',
          displayName: '参数',
          dataType: 'object',
          required: false,
          description: '与节点 parameters 合并后提交给模型的动态参数',
        },
      ],
      outputPorts: [
        {
          name: 'result',
          displayName: '结果',
          dataType: 'array',
          description: '模型任务结果（URL 数组）',
        },
      ],
    };

    // 缓存结果
    this.schemaCache.set(`model:${modelId}`, schema);

    return schema;
  }

  /**
   * 获取节点类型的端口 Schema
   * @param nodeType 节点类型
   * @returns 端口 Schema
   */
  getNodeTypePortSchema(
    nodeType: 'condition' | 'loop' | 'input' | 'output' | 'transform',
  ): NodePortSchema {
    this.logger.debug(`获取节点类型端口 Schema: ${nodeType}`);

    // 检查缓存
    const cached = this.schemaCache.get(`type:${nodeType}`);
    if (cached) {
      return cached;
    }

    let schema: NodePortSchema;

    switch (nodeType) {
      case 'condition':
        schema = {
          nodeType: 'condition',
          inputPorts: [
            {
              name: 'input',
              displayName: '输入',
              dataType: 'any',
              required: true,
              description: '条件判断的输入值',
            },
          ],
          outputPorts: [
            {
              name: 'default',
              displayName: '默认分支',
              dataType: 'any',
              description: '默认分支输出',
            },
          ],
        };
        break;

      case 'loop':
        schema = {
          nodeType: 'loop',
          inputPorts: [
            {
              name: 'array',
              displayName: '数组',
              dataType: 'array',
              required: true,
              description: '要迭代的数组',
            },
          ],
          outputPorts: [
            {
              name: 'result',
              displayName: '结果',
              dataType: 'array',
              description: '所有迭代的结果数组',
            },
          ],
        };
        break;

      case 'input':
        schema = {
          nodeType: 'input',
          inputPorts: [],
          outputPorts: [
            {
              name: 'output',
              displayName: '输出',
              dataType: 'any',
              description: '工作流输入',
            },
          ],
        };
        break;

      case 'output':
        schema = {
          nodeType: 'output',
          inputPorts: [
            {
              name: 'input',
              displayName: '输入',
              dataType: 'any',
              required: true,
              description: '工作流输出',
            },
          ],
          outputPorts: [],
        };
        break;

      case 'transform':
        schema = {
          nodeType: 'transform',
          inputPorts: [
            {
              name: 'input',
              displayName: '输入',
              dataType: 'any',
              required: true,
              description: '要转换的数据',
            },
          ],
          outputPorts: [
            {
              name: 'output',
              displayName: '输出',
              dataType: 'any',
              description: '转换后的数据',
            },
          ],
        };
        break;

      default:
        schema = {
          nodeType,
          inputPorts: [],
          outputPorts: [],
        };
    }

    // 缓存结果
    this.schemaCache.set(`type:${nodeType}`, schema);

    return schema;
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.schemaCache.clear();
    this.logger.debug('端口 Schema 缓存已清除');
  }
}
