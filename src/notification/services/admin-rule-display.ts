/** SMTP passwords and webhook keys are write-only in every admin response. */
export function adminRuleDisplay(rule: any) {
  if (!rule) return rule;
  const value = rule.toObject ? rule.toObject() : { ...rule };
  const config = { ...value.channelConfig };
  const secretsConfigured = { smtpPass: !!config.smtpPass, webhookUrl: !!config.webhookUrl };
  delete config.smtpPass; delete config.webhookUrl;
  return { ...value, channelConfig: config, secretsConfigured };
}
