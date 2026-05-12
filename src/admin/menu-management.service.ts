import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MenuConfig, MenuConfigDocument } from '../database/schemas/menu-config.schema';
import { CreateMenuDto } from './dto/create-menu.dto';
import { UpdateMenuDto } from './dto/update-menu.dto';
import { MenuRegistryService } from './services/menu-registry.service';

export interface MenuTreeNode {
  key: string;
  label: string;
  path?: string;
  icon: string;
  sortOrder: number;
  requiredPermission?: string;
  associatedPermissions: string[];
  enabled: boolean;
  moduleKey?: string;
  children: MenuTreeNode[];
}

@Injectable()
export class MenuManagementService {
  constructor(
    @InjectModel(MenuConfig.name)
    private readonly menuConfigModel: Model<MenuConfigDocument>,
    private readonly menuRegistryService: MenuRegistryService,
  ) {}

  async listAll(): Promise<MenuConfig[]> {
    return this.menuConfigModel.find().sort({ sortOrder: 1 }).lean().exec();
  }

  async getTree(): Promise<MenuTreeNode[]> {
    const all = await this.listAll();
    return this.buildTree(all);
  }

  async getByKey(key: string): Promise<MenuConfig> {
    const menu = await this.menuConfigModel.findOne({ key }).lean().exec();
    if (!menu) {
      throw new NotFoundException(`Menu with key "${key}" not found`);
    }
    return menu;
  }

  async create(dto: CreateMenuDto): Promise<MenuConfig> {
    const existing = await this.menuConfigModel.findOne({ key: dto.key }).lean().exec();
    if (existing) {
      throw new BadRequestException(`Menu with key "${dto.key}" already exists`);
    }

    if (dto.parentKey) {
      const parent = await this.menuConfigModel.findOne({ key: dto.parentKey }).lean().exec();
      if (!parent) {
        throw new BadRequestException(`Parent menu "${dto.parentKey}" not found`);
      }
    }

    const doc = new this.menuConfigModel(dto);
    const saved = await doc.save();
    await this.menuRegistryService.reloadFromDb();
    return saved;
  }

  async update(key: string, dto: UpdateMenuDto): Promise<MenuConfig> {
    const menu = await this.menuConfigModel.findOne({ key }).exec();
    if (!menu) {
      throw new NotFoundException(`Menu with key "${key}" not found`);
    }

    if (dto.parentKey && dto.parentKey !== menu.parentKey) {
      if (dto.parentKey === key) {
        throw new BadRequestException('A menu cannot be its own parent');
      }
      const parent = await this.menuConfigModel.findOne({ key: dto.parentKey }).lean().exec();
      if (!parent) {
        throw new BadRequestException(`Parent menu "${dto.parentKey}" not found`);
      }
    }

    Object.assign(menu, dto);
    const saved = await menu.save();
    await this.menuRegistryService.reloadFromDb();
    return saved;
  }

  async delete(key: string): Promise<void> {
    const menu = await this.menuConfigModel.findOne({ key }).lean().exec();
    if (!menu) {
      throw new NotFoundException(`Menu with key "${key}" not found`);
    }

    // Check for children
    const children = await this.menuConfigModel.countDocuments({ parentKey: key }).exec();
    if (children > 0) {
      throw new BadRequestException(`Cannot delete menu "${key}" because it has ${children} child menu(s). Delete children first.`);
    }

    await this.menuConfigModel.deleteOne({ key }).exec();
    await this.menuRegistryService.reloadFromDb();
  }

  async upsertFromDescriptor(item: {
    key: string;
    label: string;
    path?: string;
    icon: string;
    sortOrder: number;
    parentKey?: string;
    requiredPermission?: string;
    associatedPermissions?: string[];
    moduleKey?: string;
  }): Promise<void> {
    await this.menuConfigModel.updateOne(
      { key: item.key },
      {
        $set: {
          label: item.label,
          path: item.path,
          icon: item.icon,
          sortOrder: item.sortOrder,
          parentKey: item.parentKey,
          requiredPermission: item.requiredPermission,
          associatedPermissions: item.associatedPermissions || [],
          moduleKey: item.moduleKey,
        },
        $setOnInsert: {
          key: item.key,
          enabled: true,
        },
      },
      { upsert: true },
    ).exec();
  }

  async getMenuKeysByModule(moduleKey: string): Promise<string[]> {
    const menus = await this.menuConfigModel
      .find({ moduleKey })
      .select('key')
      .lean()
      .exec();
    return menus.map((m) => m.key);
  }

  private buildTree(items: MenuConfig[]): MenuTreeNode[] {
    const map = new Map<string, MenuTreeNode>();
    const roots: MenuTreeNode[] = [];

    for (const item of items) {
      map.set(item.key, {
        key: item.key,
        label: item.label,
        path: item.path,
        icon: item.icon,
        sortOrder: item.sortOrder,
        requiredPermission: item.requiredPermission,
        associatedPermissions: item.associatedPermissions || [],
        enabled: item.enabled,
        moduleKey: item.moduleKey,
        children: [],
      });
    }

    for (const item of items) {
      const node = map.get(item.key)!;
      if (item.parentKey && map.has(item.parentKey)) {
        map.get(item.parentKey)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    const sortTree = (nodes: MenuTreeNode[]): MenuTreeNode[] => {
      nodes.sort((a, b) => a.sortOrder - b.sortOrder);
      for (const node of nodes) {
        sortTree(node.children);
      }
      return nodes;
    };

    return sortTree(roots);
  }
}
