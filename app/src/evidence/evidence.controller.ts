import { Controller, Get, Headers, Param } from '@nestjs/common';
import { CurrentUserId } from '../common/auth/current-user-id.decorator.js';
import { CORRELATION_ID_HEADER } from '../common/middleware/correlation-id.middleware.js';
import { ProjectTargets, RequireProjectRole } from '../project-access/access-policy.js';
import type { EvidenceBundleResponse } from './dto/evidence-bundle.response.js';
import { EvidenceService } from './evidence.service.js';

/**
 * WI-CORE-027 (INTEROP-2.7 §6.16): exportación de evidencia, solo Reader. El `correlationId` es el valor de
 * `x-correlation-id` que garantiza `CorrelationIdMiddleware`; no se persiste.
 */
@Controller()
export class EvidenceController {
  constructor(private readonly evidenceService: EvidenceService) {}

  @Get('analysis-runs/:id/evidence')
  @RequireProjectRole('READER', ProjectTargets.param('analysisRun', 'id'))
  getAnalysisRunEvidence(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
    @Headers(CORRELATION_ID_HEADER) correlationId: string,
  ): Promise<EvidenceBundleResponse> {
    return this.evidenceService.getAnalysisRunEvidence(id, userId, correlationId);
  }

  @Get('experiments/:id/evidence')
  @RequireProjectRole('READER', ProjectTargets.param('experiment', 'id'))
  getExperimentEvidence(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
    @Headers(CORRELATION_ID_HEADER) correlationId: string,
  ): Promise<EvidenceBundleResponse> {
    return this.evidenceService.getExperimentEvidence(id, userId, correlationId);
  }

  @Get('retrieval-comparisons/:id/evidence')
  @RequireProjectRole('READER', ProjectTargets.param('retrievalComparison', 'id'))
  getRetrievalComparisonEvidence(
    @Param('id') id: string,
    @Headers(CORRELATION_ID_HEADER) correlationId: string,
  ): Promise<EvidenceBundleResponse> {
    return this.evidenceService.getRetrievalComparisonEvidence(id, correlationId);
  }
}
