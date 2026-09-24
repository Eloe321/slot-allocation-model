import {
  CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable,
  SetMetadata, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DemoSessionService, type DemoPrincipal, type DemoRole } from './demo-session.service.js';

const PUBLIC_KEY = 'demo:public';
const ROLES_KEY = 'demo:roles';

export const DemoPublic = () => SetMetadata(PUBLIC_KEY, true);
export const DemoRoles = (...roles: DemoRole[]) => SetMetadata(ROLES_KEY, roles);

export interface DemoRequest {
  headers: { authorization?: string };
  ip?: string;
  demoPrincipal: DemoPrincipal;
}

@Injectable()
export class DemoGuard implements CanActivate {
  constructor(
    @Inject(DemoSessionService) private readonly sessions: DemoSessionService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    const request = context.switchToHttp().getRequest<DemoRequest>();
    const principal = await this.sessions.resolve(request.headers.authorization);
    if (!principal) throw new UnauthorizedException('Choose a demo role to continue');
    const roles = this.reflector.getAllAndOverride<DemoRole[]>(ROLES_KEY, targets);
    if (roles && !roles.includes(principal.role)) throw new ForbiddenException('This demo role cannot use this action');
    request.demoPrincipal = principal;
    return true;
  }
}
