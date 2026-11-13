import type { Request, RequestHandler } from 'express';
import { idParams } from '../../lib/params.js';
import { clientIp } from '../../lib/client-ip.js';
import { paginationQuery } from '../../lib/pagination.js';
import { authOf } from '../../middleware/auth.js';
import {
  createExamTypeSchema,
  createSpecialtySchema,
  createUnitSchema,
  offerParams,
  policyInputSchema,
  saveOfferSchema,
  unitsQuery,
  updateExamTypeSchema,
  updateSpecialtySchema,
  updateUnitSchema,
} from './catalog.model.js';
import type { Actor } from './catalog.repository.js';
import type { CatalogService } from './catalog.service.js';

const actorOf = (req: Request): Actor => ({ actorId: authOf(req).user.id, ip: clientIp(req) });

export function createCatalogController(service: CatalogService) {
  return {
    activeSpecialties: (async (_req, res) => {
      res.json(await service.activeSpecialties());
    }) satisfies RequestHandler,
    activeExamTypes: (async (_req, res) => {
      res.json(await service.activeExamTypes());
    }) satisfies RequestHandler,
    activeUnits: (async (req, res) => {
      res.json(await service.activeUnits(unitsQuery.parse(req.query).examTypeId));
    }) satisfies RequestHandler,
    specialtyPage: (async (req, res) => {
      res.json(await service.specialtyPage(paginationQuery.parse(req.query)));
    }) satisfies RequestHandler,
    unitPage: (async (req, res) => {
      res.json(await service.unitPage(paginationQuery.parse(req.query)));
    }) satisfies RequestHandler,
    examTypePage: (async (req, res) => {
      res.json(await service.examTypePage(paginationQuery.parse(req.query)));
    }) satisfies RequestHandler,
    createSpecialty: (async (req, res) => {
      res.status(201).json(await service.createSpecialty(createSpecialtySchema.parse(req.body), actorOf(req)));
    }) satisfies RequestHandler,
    updateSpecialty: (async (req, res) => {
      const { id } = idParams.parse(req.params);
      res.json(await service.updateSpecialty(id, updateSpecialtySchema.parse(req.body), actorOf(req)));
    }) satisfies RequestHandler,
    createUnit: (async (req, res) => {
      res.status(201).json(await service.createUnit(createUnitSchema.parse(req.body), actorOf(req)));
    }) satisfies RequestHandler,
    updateUnit: (async (req, res) => {
      const { id } = idParams.parse(req.params);
      res.json(await service.updateUnit(id, updateUnitSchema.parse(req.body), actorOf(req)));
    }) satisfies RequestHandler,
    createExamType: (async (req, res) => {
      res.status(201).json(await service.createExamType(createExamTypeSchema.parse(req.body), actorOf(req)));
    }) satisfies RequestHandler,
    updateExamType: (async (req, res) => {
      const { id } = idParams.parse(req.params);
      res.json(await service.updateExamType(id, updateExamTypeSchema.parse(req.body), actorOf(req)));
    }) satisfies RequestHandler,
    offers: (async (req, res) => {
      res.json(await service.offersOf(idParams.parse(req.params).id));
    }) satisfies RequestHandler,
    saveOffer: (async (req, res) => {
      const { id, examTypeId } = offerParams.parse(req.params);
      res.json(await service.saveOffer(id, examTypeId, saveOfferSchema.parse(req.body), actorOf(req)));
    }) satisfies RequestHandler,
    policy: (async (_req, res) => {
      res.json(await service.policy());
    }) satisfies RequestHandler,
    savePolicy: (async (req, res) => {
      res.json(await service.savePolicy(policyInputSchema.parse(req.body), actorOf(req)));
    }) satisfies RequestHandler,
  };
}

export type CatalogController = ReturnType<typeof createCatalogController>;
