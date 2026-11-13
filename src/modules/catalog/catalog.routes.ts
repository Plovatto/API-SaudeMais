import type { ResponseConfig } from '@asteasolutions/zod-to-openapi';
import { idParams } from '../../lib/params.js';
import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { conflictResponse, forbiddenResponse, notFoundResponse } from '../../docs/common-schemas.js';
import { documentOperation, type OperationDoc } from '../../docs/operation.js';
import { tags } from '../../docs/tags.js';
import { paginationQuery } from '../../lib/pagination.js';
import { MINUTE } from '../../lib/time.js';
import { noStore } from '../../middleware/auth.js';
import { rateLimitDefaults } from '../../middleware/rate-limit.js';
import type { CatalogController } from './catalog.controller.js';
import {
  councilInUse,
  examTypeInactive,
  notFoundMessages,
  uniqueConflicts,
  type CatalogEntity,
} from './catalog.messages.js';
import {
  createExamTypeSchema,
  createSpecialtySchema,
  createUnitSchema,
  examOfferSchema,
  examTypePageSchema,
  examTypeSchema,
  offerParams,
  policyInputSchema,
  policySchema,
  saveOfferSchema,
  specialtyPageSchema,
  specialtySchema,
  unitPageSchema,
  unitSchema,
  unitsQuery,
  updateExamTypeSchema,
  updateSpecialtySchema,
  updateUnitSchema,
} from './catalog.model.js';

const notFoundOf = (entity: CatalogEntity) => notFoundResponse(notFoundMessages[entity]);

const specialtyConflict = conflictResponse(uniqueConflicts.specialties_name_key, councilInUse);
const unitConflict = conflictResponse(uniqueConflicts.units_name_key);
const examTypeConflict = conflictResponse(uniqueConflicts.exam_types_code_key, uniqueConflicts.exam_types_name_key);

interface Operation extends Omit<OperationDoc, 'tag' | 'errors' | 'success'> {
  method: 'get' | 'post' | 'patch' | 'put';
  admin?: boolean;
  entity?: CatalogEntity;
  success: { status: 200 | 201; description: string; schema: z.ZodType };
  conflict?: ResponseConfig;
}

function document({ admin = true, entity = 'unit', conflict, ...operation }: Operation) {
  documentOperation({
    ...operation,
    tag: admin ? tags.administration.name : tags.catalog.name,
    errors: {
      ...(admin && { 403: forbiddenResponse }),
      ...(operation.params && { 404: notFoundOf(entity) }),
      ...(conflict && { 409: conflict }),
    },
  });
}

const pageNote = 'Lista paginada, em ordem alfabética, incluindo os inativos.';

document({
  method: 'get',
  path: '/api/specialties',
  operationId: 'listSpecialties',
  admin: false,
  summary: 'Listar especialidades ativas',
  description: 'Especialidades disponíveis para agendar, em ordem alfabética.',
  success: { status: 200, description: 'Especialidades ativas.', schema: z.array(specialtySchema) },
});
document({
  method: 'get',
  path: '/api/units',
  operationId: 'listUnits',
  admin: false,
  summary: 'Listar unidades ativas',
  description: 'Unidades ativas com os horários. Com `examTypeId`, só as que oferecem o exame no momento.',
  query: unitsQuery,
  success: { status: 200, description: 'Unidades ativas.', schema: z.array(unitSchema) },
});
document({
  method: 'get',
  path: '/api/exam-types',
  operationId: 'listExamTypes',
  admin: false,
  summary: 'Listar tipos de exame ativos',
  description: 'Exames disponíveis para agendar, com duração e orientações de preparo.',
  success: { status: 200, description: 'Tipos de exame ativos.', schema: z.array(examTypeSchema) },
});
document({
  method: 'get',
  path: '/api/admin/specialties',
  operationId: 'adminListSpecialties',
  summary: 'Listar especialidades',
  description: pageNote,
  query: paginationQuery,
  success: { status: 200, description: 'Página de especialidades.', schema: specialtyPageSchema },
});
document({
  method: 'post',
  path: '/api/admin/specialties',
  operationId: 'adminCreateSpecialty',
  summary: 'Criar especialidade',
  description: 'Cria uma especialidade ativa com o conselho e a duração padrão da consulta (30 minutos se omitida).',
  body: createSpecialtySchema,
  success: { status: 201, description: 'Especialidade criada.', schema: specialtySchema },
  conflict: specialtyConflict,
});
document({
  method: 'patch',
  path: '/api/admin/specialties/{id}',
  operationId: 'adminUpdateSpecialty',
  summary: 'Alterar ou ativar e desativar especialidade',
  description: 'Altera só os campos enviados. A nova duração vale para agendamentos futuros criados depois da mudança.',
  params: idParams,
  entity: 'specialty',
  body: updateSpecialtySchema,
  success: { status: 200, description: 'Especialidade atualizada.', schema: specialtySchema },
  conflict: specialtyConflict,
});
document({
  method: 'get',
  path: '/api/admin/units',
  operationId: 'adminListUnits',
  summary: 'Listar unidades',
  description: pageNote,
  query: paginationQuery,
  success: { status: 200, description: 'Página de unidades.', schema: unitPageSchema },
});
document({
  method: 'post',
  path: '/api/admin/units',
  operationId: 'adminCreateUnit',
  summary: 'Criar unidade',
  description: 'Cria uma unidade ativa com endereço, telefone e o horário de cada dia em que abre.',
  body: createUnitSchema,
  success: { status: 201, description: 'Unidade criada.', schema: unitSchema },
  conflict: unitConflict,
});
document({
  method: 'patch',
  path: '/api/admin/units/{id}',
  operationId: 'adminUpdateUnit',
  summary: 'Alterar ou ativar e desativar unidade',
  description: 'Altera só os campos enviados. `hours`, quando enviado, substitui todos os horários da unidade.',
  params: idParams,
  body: updateUnitSchema,
  success: { status: 200, description: 'Unidade atualizada.', schema: unitSchema },
  conflict: unitConflict,
});
document({
  method: 'get',
  path: '/api/admin/exam-types',
  operationId: 'adminListExamTypes',
  summary: 'Listar tipos de exame',
  description: pageNote,
  query: paginationQuery,
  success: { status: 200, description: 'Página de tipos de exame.', schema: examTypePageSchema },
});
document({
  method: 'post',
  path: '/api/admin/exam-types',
  operationId: 'adminCreateExamType',
  summary: 'Criar tipo de exame',
  description: 'Cria um tipo de exame ativo, laboratorial ou de imagem, com código estável, duração e preparo.',
  body: createExamTypeSchema,
  success: { status: 201, description: 'Tipo de exame criado.', schema: examTypeSchema },
  conflict: examTypeConflict,
});
document({
  method: 'patch',
  path: '/api/admin/exam-types/{id}',
  operationId: 'adminUpdateExamType',
  summary: 'Alterar ou ativar e desativar tipo de exame',
  description: 'Altera só os campos enviados.',
  params: idParams,
  entity: 'exam_type',
  body: updateExamTypeSchema,
  success: { status: 200, description: 'Tipo de exame atualizado.', schema: examTypeSchema },
  conflict: examTypeConflict,
});
document({
  method: 'get',
  path: '/api/admin/units/{id}/exam-offers',
  operationId: 'adminListExamOffers',
  summary: 'Listar exames oferecidos pela unidade',
  description: 'Exames que a unidade faz, com a capacidade por horário e se a oferta está ativa.',
  params: idParams,
  success: { status: 200, description: 'Ofertas da unidade.', schema: z.array(examOfferSchema) },
});
document({
  method: 'put',
  path: '/api/admin/units/{id}/exam-offers/{examTypeId}',
  operationId: 'adminSaveExamOffer',
  summary: 'Oferecer um exame na unidade',
  description:
    'Cria ou altera a oferta do exame na unidade. Um tipo de exame inativo só pode ter oferta inativa. Devolve todas as ofertas da unidade.',
  params: offerParams,
  body: saveOfferSchema,
  success: { status: 200, description: 'Ofertas da unidade.', schema: z.array(examOfferSchema) },
  conflict: conflictResponse(examTypeInactive),
});
document({
  method: 'get',
  path: '/api/admin/policy',
  operationId: 'adminGetPolicy',
  summary: 'Ver a política de agendamento',
  description: 'Janelas de cancelamento tardio, limite de reagendamentos, horizonte e antecedência mínima.',
  success: { status: 200, description: 'Política em vigor.', schema: policySchema },
});
document({
  method: 'put',
  path: '/api/admin/policy',
  operationId: 'adminUpdatePolicy',
  summary: 'Alterar a política de agendamento',
  description: 'Substitui todos os valores da política. Vale para as próximas ações de pacientes e médicos.',
  body: policyInputSchema,
  success: { status: 200, description: 'Política atualizada.', schema: policySchema },
});

export interface CatalogRouterDeps {
  controller: CatalogController;
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
}

export function createCatalogRouter({ controller, requireAuth, requireAdmin }: CatalogRouterDeps): Router {
  const readLimit = rateLimit({ ...rateLimitDefaults, windowMs: MINUTE, limit: 120 });
  const adminLimit = rateLimit({ ...rateLimitDefaults, windowMs: MINUTE, limit: 120 });
  const adminOnly = [noStore, requireAuth, requireAdmin];

  const router = Router();
  router.get('/api/specialties', readLimit, requireAuth, controller.activeSpecialties);
  router.get('/api/units', readLimit, requireAuth, controller.activeUnits);
  router.get('/api/exam-types', readLimit, requireAuth, controller.activeExamTypes);
  router.get('/api/admin/specialties', adminLimit, ...adminOnly, controller.specialtyPage);
  router.post('/api/admin/specialties', adminLimit, ...adminOnly, controller.createSpecialty);
  router.patch('/api/admin/specialties/:id', adminLimit, ...adminOnly, controller.updateSpecialty);
  router.get('/api/admin/units', adminLimit, ...adminOnly, controller.unitPage);
  router.post('/api/admin/units', adminLimit, ...adminOnly, controller.createUnit);
  router.patch('/api/admin/units/:id', adminLimit, ...adminOnly, controller.updateUnit);
  router.get('/api/admin/exam-types', adminLimit, ...adminOnly, controller.examTypePage);
  router.post('/api/admin/exam-types', adminLimit, ...adminOnly, controller.createExamType);
  router.patch('/api/admin/exam-types/:id', adminLimit, ...adminOnly, controller.updateExamType);
  router.get('/api/admin/units/:id/exam-offers', adminLimit, ...adminOnly, controller.offers);
  router.put('/api/admin/units/:id/exam-offers/:examTypeId', adminLimit, ...adminOnly, controller.saveOffer);
  router.get('/api/admin/policy', adminLimit, ...adminOnly, controller.policy);
  router.put('/api/admin/policy', adminLimit, ...adminOnly, controller.savePolicy);
  return router;
}
