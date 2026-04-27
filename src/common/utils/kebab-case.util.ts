const KEBAB_CASE_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * 验证字符串是否为合法的 kebab-case 格式
 * 规则：以小写字母开头，由小写字母/数字组成的段，段之间用单个连字符连接
 */
export function isValidKebabCase(value: string): boolean {
  return KEBAB_CASE_REGEX.test(value);
}
