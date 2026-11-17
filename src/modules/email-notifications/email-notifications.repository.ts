import { and, eq, gt, inArray, isNull, lte, not, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database } from '../../database/pg-client.js';
import { bookings } from '../../database/schema/bookings.js';
import { examTypes, units } from '../../database/schema/catalog.js';
import { emailPreferences, type EmailTopic } from '../../database/schema/email-preferences.js';
import { users } from '../../database/schema/users.js';

const doctorUsers = alias(users, 'doctor_users');

const wantsEmail = (topic: EmailTopic) => and(
  eq(users.isProtected, false),
  isNull(users.deactivatedAt),
  sql`not exists (select 1 from ${emailPreferences} where ${emailPreferences.userId} = ${users.id} and ${emailPreferences.topic} = ${topic} and not ${emailPreferences.enabled})`,
);

const recipientColumns = { userId: users.id, email: users.email, fullName: users.fullName };

export type Recipient = { userId: string; email: string; fullName: string };

export interface Reminder extends Recipient {
  bookingId: string;
  kind: 'appointment' | 'exam';
  startsAt: Date;
  unitName: string;
  unitAddress: string;
  doctorName: string | null;
  examName: string | null;
}

export class EmailNotificationsRepository {
  constructor(private readonly db: Database) {}

  async disabledTopics(userId: string): Promise<EmailTopic[]> {
    const rows = await this.db
      .select({ topic: emailPreferences.topic })
      .from(emailPreferences)
      .where(and(eq(emailPreferences.userId, userId), not(emailPreferences.enabled)));
    return rows.map(({ topic }) => topic);
  }

  async savePreferences(userId: string, choices: { topic: EmailTopic; enabled: boolean }[], now: Date): Promise<void> {
    await this.db
      .insert(emailPreferences)
      .values(choices.map((choice) => ({ ...choice, userId, updatedAt: now })))
      .onConflictDoUpdate({
        target: [emailPreferences.userId, emailPreferences.topic],
        set: { enabled: sql`excluded.enabled`, updatedAt: sql`excluded.updated_at` },
      });
  }

  recipients(userIds: string[], topic: EmailTopic): Promise<Recipient[]> {
    return this.db
      .select(recipientColumns)
      .from(users)
      .where(and(inArray(users.id, userIds), wantsEmail(topic)));
  }

  claimReminders(now: Date, until: Date): Promise<Reminder[]> {
    return this.db.transaction(async (tx) => {
      const due = await tx
        .update(bookings)
        .set({ remindedAt: now })
        .where(
          and(
            eq(bookings.status, 'confirmed'),
            isNull(bookings.remindedAt),
            gt(bookings.startsAt, now),
            lte(bookings.startsAt, until),
          ),
        )
        .returning({ id: bookings.id });
      if (due.length === 0) return [];
      return tx
        .select({
          ...recipientColumns,
          bookingId: bookings.id,
          kind: bookings.kind,
          startsAt: bookings.startsAt,
          unitName: units.name,
          unitAddress: units.address,
          doctorName: doctorUsers.fullName,
          examName: examTypes.name,
        })
        .from(bookings)
        .innerJoin(users, eq(users.id, bookings.patientId))
        .innerJoin(units, eq(units.id, bookings.unitId))
        .leftJoin(doctorUsers, eq(doctorUsers.id, bookings.doctorId))
        .leftJoin(examTypes, eq(examTypes.id, bookings.examTypeId))
        .where(and(inArray(bookings.id, due.map(({ id }) => id)), wantsEmail('booking_reminder')));
    });
  }
}
