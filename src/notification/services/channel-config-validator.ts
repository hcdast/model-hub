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
      break;
    }
    case NotificationChannelType.EMAIL: {
      for (const field of EMAIL_REQUIRED_FIELDS) {
        const value = config[field];
        if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
          errors.push(`email channel requires ${field}`);
        }
      }
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
