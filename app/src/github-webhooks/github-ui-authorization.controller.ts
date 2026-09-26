import { Body, Controller, Header, Headers, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Public } from '../common/auth/public.decorator.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { NoProjectRole } from '../project-access/access-policy.js';
import { GithubAuthorizationDecisionDto } from './dto/github-authorization-decision.dto.js';
import { GithubIntegrationAuthGuard } from './github-integration-auth.guard.js';
import { GithubUiAuthorizationService } from './github-ui-authorization.service.js';

@Controller('internal/v1/github')
@Public()
@UseGuards(GithubIntegrationAuthGuard)
export class GithubUiAuthorizationController {
  constructor(private readonly authorization: GithubUiAuthorizationService) {}

  @Post('authorization-decisions')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @NoProjectRole('Verifica en forma síncrona una identidad y una operación GitHub ya autenticadas por Integration; aplica la política local de Core.')
  decide(
    @Headers('x-platform-user-token') userTokenHeader: string | undefined,
    @Body() body: GithubAuthorizationDecisionDto,
  ) {
    const match = typeof userTokenHeader === 'string'
      ? /^Bearer ([^\s]+)$/.exec(userTokenHeader)
      : null;
    if (!match) {
      // La sesión de plataforma es independiente de la credencial de servicio GH→Core.
      throw new AppException(ErrorCode.AUTH_REQUIRED, 'Falta una sesión de plataforma válida.', HttpStatus.UNAUTHORIZED);
    }
    return this.authorization.decide(match[1], body);
  }
}
