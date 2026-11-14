import { runAfterCommit, type AfterCommit, type Transaction } from '../../database/pg-client.js';
import { AppError, conflictError, unprocessableField } from '../../lib/app-error.js';
import { withConstraintConflicts } from '../../lib/constraint-conflicts.js';
import { definedFields } from '../../lib/defined.js';
import type { Actor } from '../../lib/audit.js';
import type { Clock } from '../../lib/clock.js';
import { forbidden, protectedAccount } from '../../middleware/auth.js';
import type { BookingSide } from '../bookings/bookings.repository.js';
import type { BookingsService } from '../bookings/bookings.service.js';
import type { PasswordResetService } from '../password-reset/password-reset.service.js';
import type { UpdateProfileInput } from '../users/user.model.js';
import type { SessionCache } from '../users/user.session-cache.js';
import { adminConflicts, doctorProfileNotFound, unavailable, userNotFound } from './admin-users.messages.js';
import type {
  AdminUserDetail,
  DeactivationImpact,
  DoctorProfileInput,
  UpdateDoctorProfileInput,
  UsersQuery,
} from './admin-users.model.js';
import type { AdminUserRepository, LockedUser } from './admin-users.repository.js';

const notFound = (message = userNotFound) => new AppError(404, 'NOT_FOUND', message);

function editable(user: LockedUser): LockedUser {
  if (user.isProtected) throw protectedAccount();
  return user;
}

function active(user: LockedUser): LockedUser {
  if (user.deactivatedAt) throw conflictError(adminConflicts.inactive);
  return user;
}

export class AdminUserService {
  constructor(
    private readonly repository: AdminUserRepository,
    private readonly passwordReset: PasswordResetService,
    private readonly bookings: BookingsService,
    private readonly sessions: SessionCache,
    private readonly clock: Clock,
  ) {}

  page(query: UsersQuery) {
    return this.repository.page(query);
  }

  async detail(id: string): Promise<AdminUserDetail> {
    return (await this.repository.detail(id)) ?? Promise.reject(notFound());
  }

  async impact(id: string): Promise<DeactivationImpact> {
    await this.detail(id);
    return this.repository.futureBookingCounts(id, this.clock.now());
  }

  update(actor: Actor, id: string, { fullName, phone }: UpdateProfileInput) {
    return this.change(actor, id, 'user.updated', async (tx, user) => {
      editable(user);
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
        editable(user);
        if (user.deactivatedAt) return undefined;
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
      editable(user);
      if (!user.deactivatedAt) return undefined;
      await this.repository.setDeactivated(tx, id, null);
      return {};
    });
  }

  async sendPasswordReset(actor: Actor, id: string): Promise<void> {
    const user = await this.detail(id);
    if (user.isProtected) throw protectedAccount();
    if (user.deactivatedAt) throw conflictError(adminConflicts.inactive);
    if (!(await this.repository.isActiveAdmin(this.repository.reader, actor.actorId))) throw forbidden();
    const audit = { ...actor, action: 'user.password_reset_sent', entityType: 'user', entityId: id };
    if (!(await this.passwordReset.sendLink(user, actor.actorId, audit)))
      throw conflictError(adminConflicts.resetNotSent);
  }

  grantAdmin(actor: Actor, id: string) {
    return this.change(actor, id, 'user.role_granted', async (tx, user) => {
      active(editable(user));
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
        editable(user);
        if (!user.roles.includes('admin')) return undefined;
        await this.ensureAnotherAdmin(tx, user);
        await this.repository.revokeRole(tx, id, 'admin');
        return { role: 'admin' };
      },
      true,
    );
  }

  createDoctorProfile(actor: Actor, id: string, input: DoctorProfileInput) {
    return this.change(actor, id, 'doctor_profile.created', async (tx, user) => {
      active(editable(user));
      if (user.roles.includes('doctor')) throw conflictError(adminConflicts.profileExists);
      const council = await this.availableCouncil(tx, input.specialtyId);
      await this.ensureUnitAvailable(tx, input.unitId);
      await this.repository.saveProfile(tx, id, { ...input, council });
      await this.repository.grantRole(tx, id, 'doctor', actor.actorId, this.clock.now());
      return { specialtyId: input.specialtyId, unitId: input.unitId };
    });
  }

  updateDoctorProfile(actor: Actor, id: string, input: UpdateDoctorProfileInput) {
    return this.change(actor, id, 'doctor_profile.updated', async (tx, user) => {
      editable(user);
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
    return this.change(actor, id, 'doctor_profile.deleted', async (tx, user, defer) => {
      editable(user);
      if (!user.roles.includes('doctor')) throw notFound(doctorProfileNotFound);
      defer(await this.cancelBookings(tx, user, ['doctor'], actor));
      await this.repository.revokeRole(tx, id, 'doctor');
      return {};
    });
  }

  private async change(
    actor: Actor,
    id: string,
    action: string,
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
    if (!applied) throw notFound();
    this.sessions.invalidateUser(id);
    afterCommits.forEach(runAfterCommit);
    return this.detail(id);
  }

  private async ensureAnotherAdmin(tx: Transaction, user: LockedUser): Promise<void> {
    if (user.roles.includes('admin') && (await this.repository.otherActiveAdmins(tx, user.id)) === 0) {
      throw conflictError(adminConflicts.selfOrLastAdmin);
    }
  }

  private async availableCouncil(tx: Transaction, specialtyId: string): Promise<string> {
    return (
      (await this.repository.activeSpecialtyCouncil(tx, specialtyId)) ??
      Promise.reject(unprocessableField(unavailable.specialty))
    );
  }

  private async ensureUnitAvailable(tx: Transaction, unitId: string): Promise<void> {
    if (!(await this.repository.unitIsActive(tx, unitId))) throw unprocessableField(unavailable.unit);
  }

  private async cancelBookings(tx: Transaction, user: LockedUser, sides: BookingSide[], actor: Actor) {
    if (user.roles.includes('doctor')) await this.repository.profileRow(tx, user.id, true);
    return this.bookings.cancelForAccount(tx, user.id, sides, { role: 'admin', userId: actor.actorId });
  }

  private async hasFutureAppointments(tx: Transaction, id: string): Promise<boolean> {
    return (await this.repository.futureBookingCounts(id, this.clock.now(), tx)).futureAppointmentsAsDoctor > 0;
  }
}
