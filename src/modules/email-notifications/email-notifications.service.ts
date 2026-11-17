import { unprocessable } from '../../lib/app-error.js';
import type { Clock } from '../../lib/clock.js';
import type { AuthContext } from '../users/index.js';
import {
  TOPIC_ROLES,
  topicNotAvailable,
  topicsFor,
  type EmailPreference,
  type UpdateEmailPreferencesInput,
} from './email-notifications.model.js';
import type { EmailNotificationsRepository } from './email-notifications.repository.js';

export class EmailNotificationsService {
  constructor(
    private readonly repository: EmailNotificationsRepository,
    private readonly clock: Clock,
  ) {}

  async preferences({ user }: AuthContext): Promise<EmailPreference[]> {
    const disabled = new Set(await this.repository.disabledTopics(user.id));
    return topicsFor(user.roles).map((topic) => ({ topic, role: TOPIC_ROLES[topic], enabled: !disabled.has(topic) }));
  }

  async update(auth: AuthContext, { preferences }: UpdateEmailPreferencesInput): Promise<EmailPreference[]> {
    const available = topicsFor(auth.user.roles);
    if (preferences.some(({ topic }) => !available.includes(topic))) {
      throw unprocessable(topicNotAvailable.code, topicNotAvailable.message);
    }
    await this.repository.savePreferences(auth.user.id, preferences, this.clock.now());
    return this.preferences(auth);
  }
}
