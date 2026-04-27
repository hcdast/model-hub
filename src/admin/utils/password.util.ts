import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

/**
 * 密码复杂度要求：
 * - 至少8个字符
 * - 包含至少一个小写字母
 * - 包含至少一个大写字母
 * - 包含至少一个数字
 */
export interface PasswordComplexityResult {
  isValid: boolean;
  errors: string[];
}

/**
 * 验证密码复杂度
 */
export function validatePasswordComplexity(password: string): PasswordComplexityResult {
  const errors: string[] = [];

  if (!password || password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * 使用bcrypt加密密码
 */
export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 10;
  return bcrypt.hash(password, saltRounds);
}

/**
 * 验证密码是否匹配哈希值
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * 生成临时密码
 * 生成一个符合复杂度要求的随机密码
 */
export function generateTemporaryPassword(length: number = 12): string {
  // 确保长度至少为8
  const actualLength = Math.max(length, 8);
  
  // 定义字符集
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';
  const allChars = lowercase + uppercase + numbers;
  
  // 确保至少包含每种类型的字符
  let password = '';
  password += lowercase[crypto.randomInt(0, lowercase.length)];
  password += uppercase[crypto.randomInt(0, uppercase.length)];
  password += numbers[crypto.randomInt(0, numbers.length)];
  
  // 填充剩余长度
  for (let i = password.length; i < actualLength; i++) {
    password += allChars[crypto.randomInt(0, allChars.length)];
  }
  
  // 打乱字符顺序
  return password
    .split('')
    .sort(() => crypto.randomInt(0, 2) - 0.5)
    .join('');
}

/**
 * 验证密码哈希是否为有效的bcrypt格式
 */
export function isBcryptHash(hash: string): boolean {
  // bcrypt哈希格式: $2a$10$... 或 $2b$10$...
  const bcryptRegex = /^\$2[aby]\$\d{2}\$.{53}$/;
  return bcryptRegex.test(hash);
}
