import type { RequestHandler } from 'express';
import { clientIp } from '../../lib/client-ip.js';
import { paginationQuery } from '../../lib/pagination.js';
import { idParams } from '../../lib/params.js';
import { clientOf } from '../../middleware/api-key.js';
import { actorOf } from '../../middleware/auth.js';
import { createClientSchema, resultInputSchema, worklistQuery } from './lab-integration.model.js';
import type { LabIntegrationService } from './lab-integration.service.js';

export function createLabIntegrationController(service: LabIntegrationService) {
  return {
    clientPage: (async (req, res) => {
      res.json(await service.clientPage(paginationQuery.parse(req.query)));
    }) satisfies RequestHandler,
    createClient: (async (req, res) => {
      res.status(201).json(await service.createClient(createClientSchema.parse(req.body), actorOf(req)));
    }) satisfies RequestHandler,
    revokeClient: (async (req, res) => {
      res.json(await service.revokeClient(idParams.parse(req.params).id, actorOf(req)));
    }) satisfies RequestHandler,
    worklist: (async (req, res) => {
      res.json(await service.worklist(worklistQuery.parse(req.query).date));
    }) satisfies RequestHandler,
    publish: (async (req, res) => {
      const receipt = await service.publish(resultInputSchema.parse(req.body), {
        clientId: clientOf(req),
        ip: clientIp(req),
      });
      res.status(receipt.outcome === 'created' ? 201 : 200).json(receipt);
    }) satisfies RequestHandler,
  };
}

export type LabIntegrationController = ReturnType<typeof createLabIntegrationController>;
