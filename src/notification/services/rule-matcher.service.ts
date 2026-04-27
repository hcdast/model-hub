import { Injectable } from '@nestjs/common';
import { SystemEvent } from '../events/system-event.types';
import { NotificationRule } from '../../database/schemas/notification-rule.schema';

@Injectable()
export class RuleMatcherService {
  /**
   * Match a system event against a list of notification rules.
   * Returns only rules where:
   *  - rule.enabled === true
   *  - rule.eventTypes contains event.type (or eventTypes is empty → match all)
   *  - rule.severities contains event.severity (or severities is empty → match all)
   */
  matchRules(event: SystemEvent, rules: NotificationRule[]): NotificationRule[] {
    return rules.filter((rule) => {
      if (!rule.enabled) return false;

      const eventTypeMatch =
        rule.eventTypes.length === 0 || rule.eventTypes.includes(event.type);

      const severityMatch =
        rule.severities.length === 0 || rule.severities.includes(event.severity);

      return eventTypeMatch && severityMatch;
    });
  }
}
