import { and, asc, eq, exists, ilike, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { Database, Transaction } from '../../database/pg-client.js';
import { specialties, units } from '../../database/schema/catalog.js';
import { doctorProfiles } from '../../database/schema/doctor-profiles.js';
import { sessions } from '../../database/schema/sessions.js';
import { userRoles, users, type Role } from '../../database/schema/users.js';
import { recordAudit, type AuditEntry } from '../../lib/audit.js';
import { offsetOf, type Page } from '../../lib/pagination.js';
import { publicUserColumns } from '../users/user.repository.js';
import type { AdminUser, AdminUserDetail, DoctorProfile, UsersQuery } from './admin-users.model.js';

const ADMIN_SET_LOCK = 727_003;

const adminUserColumns = {
  ...publicUserColumns,
  isProtected: users.isProtected,
  deactivatedAt: users.deactivatedAt,
  createdAt: users.createdAt,
};

type AdminUserRow = Omit<AdminUser, 'deactivatedAt' | 'createdAt'> & { deactivatedAt: Date | null; createdAt: Date };

export interface LockedUser {
  id: string;
  email: string;
  roles: Role[];
  isProtected: boolean;
  deactivatedAt: Date | null;
}

export interface ProfileRow {
  specialtyId: string;
  council: string;
  unitId: string;
  registryNumber: string;
  registryUf: string;
}

function toAdminUser({ deactivatedAt, createdAt, ...row }: AdminUserRow): AdminUser {
  return { ...row, deactivatedAt: deactivatedAt?.toISOString() ?? null, createdAt: createdAt.toISOString() };
}

function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, '\\$&')}%`;
}

export class AdminUserRepository {
  constructor(private readonly db: Database) {}

  get reader(): Pick<Database, '$count' | 'select'> {
    return this.db;
  }

  async page({ search, role, status, page, pageSize }: UsersQuery): Promise<Page<AdminUser>> {
    const filters: (SQL | undefined)[] = [
      search
        ? or(
            sql`unaccent(${users.fullName}) ilike unaccent(${likePattern(search)})`,
            ilike(users.email, likePattern(search)),
          )
        : undefined,
      role
        ? exists(
            this.db
              .select({ one: sql`1` })
              .from(userRoles)
              .where(and(eq(userRoles.userId, users.id), eq(userRoles.role, role))),
          )
        : undefined,
      status === 'active'
        ? isNull(users.deactivatedAt)
        : status === 'inactive'
          ? isNotNull(users.deactivatedAt)
          : undefined,
    ];
    const where = and(...filters);
    const rows = await this.db
      .select(adminUserColumns)
      .from(users)
      .where(where)
      .orderBy(asc(users.fullName), asc(users.id))
      .limit(pageSize)
      .offset(offsetOf({ page, pageSize }));
    return { items: rows.map(toAdminUser), page, pageSize, total: await this.db.$count(users, where) };
  }

  async detail(id: string): Promise<AdminUserDetail | undefined> {
    const [row] = await this.db.select(adminUserColumns).from(users).where(eq(users.id, id));
    if (!row) return undefined;
    const doctorProfile = row.roles.includes('doctor') ? await this.profileOf(this.db, id) : undefined;
    return { ...toAdminUser(row), doctorProfile: doctorProfile ?? null };
  }

  mutate<T>(id: string, work: (tx: Transaction, user: LockedUser) => Promise<T>, adminSet = false) {
    return this.db.transaction(async (tx): Promise<T | undefined> => {
      if (adminSet) await tx.execute(sql`select pg_advisory_xact_lock(${ADMIN_SET_LOCK}, 0)`);
      const [user] = await tx
        .select({
          id: users.id,
          email: users.email,
          roles: publicUserColumns.roles,
          isProtected: users.isProtected,
          deactivatedAt: users.deactivatedAt,
        })
        .from(users)
        .where(eq(users.id, id))
        .for('no key update');
      return user ? work(tx, user) : undefined;
    });
  }

  async isActiveAdmin(db: Pick<Database, '$count' | 'select'>, id: string): Promise<boolean> {
    const total = await db.$count(
      users,
      and(
        eq(users.id, id),
        isNull(users.deactivatedAt),
        exists(
          db
            .select({ one: sql`1` })
            .from(userRoles)
            .where(and(eq(userRoles.userId, users.id), eq(userRoles.role, 'admin'))),
        ),
      ),
    );
    return total > 0;
  }

  async otherActiveAdmins(tx: Transaction, exceptId: string): Promise<number> {
    return tx.$count(
      users,
      and(
        ne(users.id, exceptId),
        isNull(users.deactivatedAt),
        exists(
          tx
            .select({ one: sql`1` })
            .from(userRoles)
            .where(and(eq(userRoles.userId, users.id), eq(userRoles.role, 'admin'))),
        ),
      ),
    );
  }

  async updateUser(tx: Transaction, id: string, changes: { fullName?: string; phone?: string | null }) {
    await tx.update(users).set(changes).where(eq(users.id, id));
  }

  async setDeactivated(tx: Transaction, id: string, deactivatedAt: Date | null) {
    await tx.update(users).set({ deactivatedAt }).where(eq(users.id, id));
    if (deactivatedAt) await tx.delete(sessions).where(eq(sessions.userId, id));
  }

  async grantRole(tx: Transaction, id: string, role: Role, grantedBy: string, now: Date) {
    await tx.insert(userRoles).values({ userId: id, role, grantedBy, grantedAt: now }).onConflictDoNothing();
  }

  async revokeRole(tx: Transaction, id: string, role: Role) {
    await tx.delete(userRoles).where(and(eq(userRoles.userId, id), eq(userRoles.role, role)));
  }

  async activeSpecialtyCouncil(tx: Transaction, id: string): Promise<string | undefined> {
    const [row] = await tx
      .select({ council: specialties.council })
      .from(specialties)
      .where(and(eq(specialties.id, id), eq(specialties.isActive, true)))
      .for('share');
    return row?.council;
  }

  async unitIsActive(tx: Transaction, id: string): Promise<boolean> {
    const rows = await tx
      .select({ id: units.id })
      .from(units)
      .where(and(eq(units.id, id), eq(units.isActive, true)))
      .for('share');
    return rows.length > 0;
  }

  async profileRow(tx: Transaction, userId: string, lock = false): Promise<ProfileRow | undefined> {
    const query = tx
      .select({
        specialtyId: doctorProfiles.specialtyId,
        council: doctorProfiles.council,
        unitId: doctorProfiles.unitId,
        registryNumber: doctorProfiles.registryNumber,
        registryUf: doctorProfiles.registryUf,
      })
      .from(doctorProfiles)
      .where(eq(doctorProfiles.userId, userId));
    const [row] = await (lock ? query.for('no key update') : query);
    return row;
  }

  async saveProfile(tx: Transaction, userId: string, profile: ProfileRow) {
    await tx
      .insert(doctorProfiles)
      .values({ userId, ...profile })
      .onConflictDoUpdate({ target: doctorProfiles.userId, set: profile });
  }

  futureBookingCounts(_userId: string, _db: Pick<Database, 'select'> = this.db) {
    return Promise.resolve({ futureAppointmentsAsPatient: 0, futureAppointmentsAsDoctor: 0 });
  }

  cancelFutureBookings(_tx: Transaction, _userId: string, _as: 'patient' | 'doctor' | 'both') {
    return Promise.resolve();
  }

  audit(entry: AuditEntry, db: Pick<Database, 'insert'> = this.db) {
    return recordAudit(db, entry);
  }

  private async profileOf(db: Pick<Database, 'select'>, userId: string): Promise<DoctorProfile | undefined> {
    const [row] = await db
      .select({
        specialtyId: doctorProfiles.specialtyId,
        specialtyName: specialties.name,
        council: doctorProfiles.council,
        unitId: doctorProfiles.unitId,
        unitName: units.name,
        registryNumber: doctorProfiles.registryNumber,
        registryUf: doctorProfiles.registryUf,
      })
      .from(doctorProfiles)
      .innerJoin(specialties, eq(specialties.id, doctorProfiles.specialtyId))
      .innerJoin(units, eq(units.id, doctorProfiles.unitId))
      .where(eq(doctorProfiles.userId, userId));
    return row;
  }
}
