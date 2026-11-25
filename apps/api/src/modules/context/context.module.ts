import { Body, Controller, Get, Module, Put, Query, Res } from '@nestjs/common';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { AnyRole, CurrentPrincipal } from '../../common/authz/policy.decorator';
import { DemoContextService } from '../../common/context/demo-context.service';
import type { Principal } from '../../common/context/principal';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppConfigService } from '../../common/config/app-config.service';
import { contextPayload } from './context.payload';

class SwitchPersonaDto {
  @Matches(/^(admin|teacher:[A-Z0-9-]{1,32}|student:[A-Z0-9-]{1,32})$/)
  personaKey: string;
}

class PersonaQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

/**
 * GET returns who the server thinks the caller is (login session, or the I-01 demo context when
 * AUTH_MODE=demo). PUT switches the demo persona (AUTH_MODE=demo + DEMO_MODE=true only) — the server
 * validates the persona against seeded records.
 */
@Controller('context')
@AnyRole()
export class ContextController {
  constructor(
    private readonly demo: DemoContextService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  @Get()
  current(@CurrentPrincipal() p: Principal) {
    return contextPayload(p, this.demo, this.config);
  }

  @Get('personas')
  async personas(@CurrentPrincipal() p: Principal, @Query() query: PersonaQueryDto) {
    if (!this.demo.demoMode) return { items: [] };
    const q = query.q?.trim();
    const nameFilter = q ? { OR: [{ fullName: { contains: q, mode: 'insensitive' as const } }, { code: { contains: q.toUpperCase() } }] } : {};
    const [teachers, students] = await Promise.all([
      this.prisma.teacher.findMany({ where: { tenantId: p.tenantId, status: { not: 'INACTIVE' }, ...nameFilter }, orderBy: { code: 'asc' }, take: 20, select: { code: true, fullName: true, specialization: true } }),
      this.prisma.student.findMany({ where: { tenantId: p.tenantId, status: { not: 'ARCHIVED' }, ...nameFilter }, orderBy: { code: 'asc' }, take: 20, select: { code: true, fullName: true } }),
    ]);
    return {
      items: [
        { personaKey: 'admin', role: 'ADMIN', displayName: 'Quản trị trung tâm', detail: 'Toàn quyền trong trung tâm' },
        ...teachers.map((t) => ({ personaKey: `teacher:${t.code}`, role: 'TEACHER', displayName: t.fullName, detail: `${t.code} · ${t.specialization}` })),
        ...students.map((s) => ({ personaKey: `student:${s.code}`, role: 'STUDENT', displayName: s.fullName, detail: s.code })),
      ],
    };
  }

  @Put()
  async switch(@Body() dto: SwitchPersonaDto, @Res({ passthrough: true }) res: Response) {
    const principal = await this.demo.switchPersona(res, dto.personaKey);
    return { principal, demoMode: true };
  }
}

@Module({ controllers: [ContextController] })
export class ContextModule {}
