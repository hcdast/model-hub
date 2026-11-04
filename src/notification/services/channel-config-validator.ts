import { NotificationChannelType } from '../../database/schemas/notification-rule.schema';

export interface ChannelValidationResult {
  valid: boolean;
  errors: string[];
}

const EMAIL_REQUIRED_FIELDS = ['smtpHost', 'smtpPort', 'smtpUser', 'smtpPass', 'from'] as const;

/**
 * Validate that a channel configuration contains all required fields
 * for the given channel type.
 *
 * - wecom: requires non-empty `webhookUrl`
 * - email: requires `smtpHost`, `smtpPort`, `smtpUser`, `smtpPass`, `from`
 * - in_app: accepts empty config
 */
export function validateChannelConfig(
  channelType: NotificationChannelType | string,
  config: Record<string, any>,
): ChannelValidationResult {
  const errors: string[] = [];

  switch (channelType) {
    case NotificationChannelType.WECOM: {
      if (!config.webhookUrl || typeof config.webhookUrl !== 'string' || config.webhookUrl.trim() === '') {
        errors.push('wecom channel requires a non-empty webhookUrl');
      }
      if (config.webhookUrl) { try { const u = new URL(config.webhookUrl); if (u.protocol !== 'https:' || u.username || u.password) throw new Error(); } catch { errors.push('Webhook URL 必须为 HTTPS 地址'); } }
      break;
    }
    case NotificationChannelType.EMAIL: {
      for (const field of EMAIL_REQUIRED_FIELDS) {
        const value = config[field];
        if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
          errors.push(`email channel requires ${field}`);
        }
      }
      if (!Number.isInteger(config.smtpPort) || config.smtpPort < 1 || config.smtpPort > 65535) errors.push('SMTP 端口必须为 1 至 65535 的整数');
      if (typeof config.from !== 'string' || !config.from.includes('@')) errors.push('发件人邮箱无效');
      break;
    }
    case NotificationChannelType.IN_APP: {
      // in_app accepts empty config — always valid
      break;
    }
    default: {
      errors.push(`unknown channel type: ${channelType}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
