import { Controller, Get, Param } from '@nestjs/common';
import { AnalysisRunsService } from '../analysis-runs/analysis-runs.service.js';
import { GeneratedTestProposalsRepository } from './generated-test-proposals.repository.js';
import {
  toGeneratedTestProposalResponse,
  type GeneratedTestProposalSetResponse,
} from './dto/generated-test-proposal.response.js';
import { CurrentUserId } from '../common/auth/current-user-id.decorator.js';

@Controller()
export class AnalysisRunValidationController {
  constructor(
    private readonly analysisRunsService: AnalysisRunsService,
    private readonly generatedTestProposalsRepository: GeneratedTestProposalsRepository,
  ) {}

  @Get('analysis-runs/:analysisRunId/test-proposals')
  async listProposals(
    @Param('analysisRunId') analysisRunId: string,
    @CurrentUserId() userId: string,
  ): Promise<GeneratedTestProposalSetResponse> {
    const run = await this.analysisRunsService.getById(analysisRunId, userId);
    const proposals = await this.generatedTestProposalsRepository.findByAnalysisRun(analysisRunId);

    return {
      analysisRunId: run.id,
      headSha: run.headSha,
      items: proposals.map(toGeneratedTestProposalResponse),
    };
  }
}
