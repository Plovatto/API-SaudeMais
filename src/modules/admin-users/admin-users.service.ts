import { runAfterCommit, type AfterCommit, type Transaction } from '../../database/pg-client.js';
import type { AuditAction } from '../../database/schema/audit-logs.js';
import type { Role } from '../../database/schema/users.js';
import { conflictError, notFound, unprocessableField, type FieldConflict } from '../../lib/app-error.js';
import { withConstraintConflicts } from '../../lib/constraint-conflicts.js';
import { definedFields } from '../../lib/defined.js';
import { refuseExampleEscalation } from '../../lib/example-account.js';
import type { Actor, AuditEntry } from '../../lib/audit.js';
import type { Clock } from '../../lib/clock.js';
import { forbidden } from '../../middleware/auth.js';
import type { BookingSide } from '../bookings/bookings.repository.js';
import type { BookingsService } from '../bookings/bookings.service.js';
import type { PasswordResetService } from '../password-reset/password-reset.service.js';
import type { UpdateProfileInput } from '../users/user.model.js';
import { unusablePasswordHash } from '../users/user.password.js';
import type { UserService } from '../users/user.service.js';
import type { SessionCache } from '../users/user.session-cache.js';
import {
  adminConflicts,
  doctorProfileNotFound,
  inDoctorProfile,
  unavailable,
  userNotFound,
} from './admin-users.messages.js';
import type {
  AdminUserDetail,
  CreateUserInput,
  DeactivationImpact,
  DoctorProfileInput,
  UpdateDoctorProfileInput,
  UsersQuery,
} from './admin-users.model.js';
import type { AdminUserRepository, LockedUser } from './admin-users.repository.js';


function active(user: LockedUser): LockedUser {
  if (user.deactivatedAt) throw conflictError(adminConflicts.inactive);
  return user;
}

const sameField = (conflict: FieldConflict) => conflict;

export class AdminUserService {
  constructor(
    private readonly repository: AdminUserRepository,
    private readonly passwordReset: PasswordResetService,
    private readonly bookings: BookingsService,
    private readonly sessions: SessionCache,
    private readonly clock: Clock,
    private readonly accounts: UserService,
  ) {}

  page(query: UsersQuery) {
    return this.repository.page(query);
  }

  async create(
    actor: Actor,
    { fullName, email, phone, role, doctorProfile }: CreateUserInput,
  ): Promise<AdminUserDetail> {
    refuseExampleEscalation(actor.actorId);
    const passwordHash = await unusablePasswordHash();
    const roles = [...new Set<Role>(['patient', role])];
    const user = await withConstraintConflicts(
      () =>
        this.accounts.createAccount(
          { fullName, email, phone, passwordHash, roles, termsVersion: null, grantedBy: actor.actorId },
          async (tx, created) => {
            if (!(await this.repository.isActiveAdmin(tx, actor.actorId))) throw forbidden();
            if (doctorProfile) await this.saveDoctorProfile(tx, created.id, doctorProfile, inDoctorProfile);
            const { specialtyId, unitId } = doctorProfile ?? {};
            const metadata = { role, ...definedFields({ specialtyId, unitId }) };
            await this.repository.audit(
              { ...actor, action: 'user.created', entityType: 'user', entityId: created.id, metadata },
              tx,
            );
            return this.passwordReset.issueWelcome(tx, created, actor.actorId);
          },
        ),
      { doctor_profiles_registry_key: inDoctorProfile(adminConflicts.registryTaken) },
    );
    return this.detail(user.id);
  }

  async detail(id: string): Promise<AdminUserDetail> {
    return (await this.repository.detail(id)) ?? Promise.reject(notFound(userNotFound));
  }

  async impact(id: string): Promise<DeactivationImpact> {
    await this.detail(id);
    return this.repository.futureBookingCounts(id, this.clock.now());
  }

  update(actor: Actor, id: string, { fullName, phone }: UpdateProfileInput) {
    return this.change(actor, id, 'user.updated', async (tx) => {
      const changes = definedFields({ fullName, phone });
      await this.repository.updateUser(tx, id, changes);
      return { fields: Object.keys(changes) };
    });
  }

  deactivate(actor: Actor, id: string) {
    return this.change(
      actor,
      id,
      'user.deactivated',
      async (tx, user, defer) => {
        if (id === actor.actorId) throw conflictError(adminConflicts.selfOrLastAdmin);
        if (user.deactivatedAt) return undefined;
        if (user.roles.some((role) => role !== 'patient')) refuseExampleEscalation(actor.actorId);
        await this.ensureAnotherAdmin(tx, user);
        defer(await this.cancelBookings(tx, user, ['patient', 'doctor'], actor));
        await this.repository.setDeactivated(tx, id, this.clock.now());
        return {};
      },
      true,
    );
  }

  reactivate(actor: Actor, id: string) {
    return this.change(actor, id, 'user.reactivated', async (tx, user) => {
      if (!user.deactivatedAt) return undefined;
      if (user.roles.some((role) => role !== 'patient')) refuseExampleEscalation(actor.actorId);
      await this.repository.setDeactivated(tx, id, null);
      return {};
    });
  }

  async sendPasswordReset(actor: Actor, id: string): Promise<void> {
    const user = await this.detail(id);
    if (user.deactivatedAt) throw conflictError(adminConflicts.inactive);
    if (!(await this.repository.isActiveAdmin(this.repository.reader, actor.actorId))) throw forbidden();
    const audit: AuditEntry = { ...actor, action: 'user.password_reset_sent', entityType: 'user', entityId: id };
    if (!(await this.passwordReset.sendLink(user, actor.actorId, audit)))
      throw conflictError(adminConflicts.resetNotSent);
  }

  grantAdmin(actor: Actor, id: string) {
    refuseExampleEscalation(actor.actorId);
    return this.change(actor, id, 'user.role_granted', async (tx, user) => {
      active(user);
      if (user.roles.includes('admin')) return undefined;
      await this.repository.grantRole(tx, id, 'admin', actor.actorId, this.clock.now());
      return { role: 'admin' };
    });
  }

  revokeAdmin(actor: Actor, id: string) {
    return this.change(
      actor,
      id,
      'user.role_revoked',
      async (tx, user) => {
        if (id === actor.actorId) throw conflictError(adminConflicts.selfOrLastAdmin);
        if (!user.roles.includes('admin')) return undefined;
        refuseExampleEscalation(actor.actorId);
        await this.ensureAnotherAdmin(tx, user);
        await this.repository.revokeRole(tx, id, 'admin');
        return { role: 'admin' };
      },
      true,
    );
  }

  createDoctorProfile(actor: Actor, id: string, input: DoctorProfileInput) {
    refuseExampleEscalation(actor.actorId);
    return this.change(actor, id, 'doctor_profile.created', async (tx, user) => {
      active(user);
      if (user.roles.includes('doctor')) throw conflictError(adminConflicts.profileExists);
      await this.saveDoctorProfile(tx, id, input);
      await this.repository.grantRole(tx, id, 'doctor', actor.actorId, this.clock.now());
      return { specialtyId: input.specialtyId, unitId: input.unitId };
    });
  }

  updateDoctorProfile(actor: Actor, id: string, input: UpdateDoctorProfileInput) {
    refuseExampleEscalation(actor.actorId);
    return this.change(actor, id, 'doctor_profile.updated', async (tx, user) => {
      if (!user.roles.includes('doctor')) throw notFound(doctorProfileNotFound);
      const changes = definedFields(input);
      const council = changes.specialtyId ? await this.availableCouncil(tx, changes.specialtyId) : undefined;
      if (changes.unitId) await this.ensureUnitAvailable(tx, changes.unitId);
      const current = await this.repository.profileRow(tx, id, true);
      if (!current) throw notFound(doctorProfileNotFound);
      const next = { ...current, ...changes };
      const moves = next.specialtyId !== current.specialtyId || next.unitId !== current.unitId;
      if (moves && (await this.hasFutureAppointments(tx, id))) throw conflictError(adminConflicts.futureAppointments);
      const { specialtyId, unitId, registryNumber, registryUf } = next;
      await this.repository.saveProfile(tx, id, {
        specialtyId,
        unitId,
        registryNumber,
        registryUf,
        council: council ?? current.council,
      });
      return { fields: Object.keys(changes) };
    });
  }

  deleteDoctorProfile(actor: Actor, id: string) {
    refuseExampleEscalation(actor.actorId);
    return this.change(actor, id, 'doctor_profile.deleted', async (tx, user, defer) => {
      if (!user.roles.includes('doctor')) throw notFound(doctorProfileNotFound);
      defer(await this.cancelBookings(tx, user, ['doctor'], actor));
      await this.repository.revokeRole(tx, id, 'doctor');
      return {};
    });
  }

  private async change(
    actor: Actor,
    id: string,
    action: AuditAction,
    work: (
      tx: Transaction,
      user: LockedUser,
      defer: (afterCommit: AfterCommit) => void,
    ) => Promise<Record<string, unknown> | undefined>,
    adminSet = false,
  ): Promise<AdminUserDetail> {
    const afterCommits: AfterCommit[] = [];
    const applied = await withConstraintConflicts(
      () =>
        this.repository.mutate(
          id,
          async (tx, user) => {
            if (!(await this.repository.isActiveAdmin(tx, actor.actorId))) throw forbidden();
            const metadata = await work(tx, user, (afterCommit) => afterCommits.push(afterCommit));
            if (metadata)
              await this.repository.audit({ ...actor, action, entityType: 'user', entityId: id, metadata }, tx);
            return true;
          },
          adminSet,
        ),
      { doctor_profiles_registry_key: adminConflicts.registryTaken },
    );
    if (!applied) throw notFound(userNotFound);
    this.sessions.invalidateUser(id);
    afterCommits.forEach(runAfterCommit);
    return this.detail(id);
  }

  private async ensureAnotherAdmin(tx: Transaction, user: LockedUser): Promise<void> {
    if (user.roles.includes('admin') && (await this.repository.otherActiveAdmins(tx, user.id)) === 0) {
      throw conflictError(adminConflicts.selfOrLastAdmin);
    }
  }

  private async saveDoctorProfile(
    tx: Transaction,
    id: string,
    input: DoctorProfileInput,
    at = sameField,
  ): Promise<void> {
    const council = await this.availableCouncil(tx, input.specialtyId, at);
    await this.ensureUnitAvailable(tx, input.unitId, at);
    await this.repository.saveProfile(tx, id, { ...input, council });
  }

  private async availableCouncil(tx: Transaction, specialtyId: string, at = sameField): Promise<string> {
    return (
      (await this.repository.activeSpecialtyCouncil(tx, specialtyId)) ??
      Promise.reject(unprocessableField(at(unavailable.specialty)))
    );
  }

  private async ensureUnitAvailable(tx: Transaction, unitId: string, at = sameField): Promise<void> {
    if (!(await this.repository.unitIsActive(tx, unitId))) throw unprocessableField(at(unavailable.unit));
  }

  private async cancelBookings(tx: Transaction, user: LockedUser, sides: BookingSide[], actor: Actor) {
    if (user.roles.includes('doctor')) await this.repository.profileRow(tx, user.id, true);
    return this.bookings.cancelForAccount(tx, user.id, sides, { role: 'admin', userId: actor.actorId });
  }

  private async hasFutureAppointments(tx: Transaction, id: string): Promise<boolean> {
    return (await this.repository.futureBookingCounts(id, this.clock.now(), tx)).futureAppointmentsAsDoctor > 0;
  }
}
