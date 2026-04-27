/**
 * 验证错误信息
 */
export interface ValidationError {
  field: string;
  message: string;
  value?: any;
}

/**
 * 验证结果
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * 冲突信息
 */
export interface ConflictInfo {
  field: string;
  value: any;
  existingModelName: string;
}

/**
 * 唯一性检查结果
 */
export interface UniquenessCheckResult {
  unique: boolean;
  conflicts: ConflictInfo[];
}
