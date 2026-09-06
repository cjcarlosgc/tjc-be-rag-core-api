import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ExperimentsService } from './experiments.service.js';
import { CreateExperimentDto } from './dto/create-experiment.dto.js';
import type {
  ExperimentAcceptedResponse,
  ExperimentResultsResponse,
  ExperimentStatusResponse,
} from './dto/experiment.response.js';

@Controller('experiments')
export class ExperimentsController {
  constructor(private readonly experimentsService: ExperimentsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(@Body() dto: CreateExperimentDto): Promise<ExperimentAcceptedResponse> {
    return this.experimentsService.createRun(dto);
  }

  @Get(':id')
  getStatus(@Param('id') id: string): Promise<ExperimentStatusResponse> {
    return this.experimentsService.getStatus(id);
  }

  @Get(':id/results')
  getResults(@Param('id') id: string): Promise<ExperimentResultsResponse> {
    return this.experimentsService.getResults(id);
  }
}
