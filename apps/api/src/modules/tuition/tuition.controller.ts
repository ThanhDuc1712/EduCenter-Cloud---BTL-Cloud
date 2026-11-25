import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { CurrentPrincipal, Roles } from '../../common/authz/policy.decorator';
import type { Principal } from '../../common/context/principal';
import { PageQueryDto } from '../../common/http/pagination';
import { IsMoneyVnd, IsYmd } from '../../common/http/validators';
import { TuitionService } from './tuition.service';

const STATUSES = ['UNPAID', 'PARTIAL', 'PAID', 'CANCELLED'] as const;
const METHODS = ['CASH', 'BANK_TRANSFER', 'CARD', 'OTHER'] as const;

class InvoiceQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(STATUSES) status?: (typeof STATUSES)[number];
  @IsOptional() @IsUUID() studentId?: string;
  @IsOptional() @IsUUID() classroomId?: string;
  @IsOptional() @IsUUID() courseId?: string;
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() overdue?: boolean;
}

class CreateInvoiceDto {
  @IsUUID() studentId: string;
  @IsOptional() @IsUUID() classroomId?: string;
  @IsOptional() @IsUUID() courseId?: string;
  @IsString() @MinLength(2) @MaxLength(300) description: string;
  @IsMoneyVnd() amountVnd: string;
  @IsOptional() @IsMoneyVnd({ allowZero: true }) discountVnd?: string;
  @IsYmd() dueDate: string;
}

class UpdateInvoiceDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(300) description?: string;
  @IsOptional() @IsMoneyVnd({ allowZero: true }) discountVnd?: string;
  @IsOptional() @IsYmd() dueDate?: string;
}

class PaymentDto {
  @IsMoneyVnd() amountVnd: string;
  @IsIn(METHODS) method: (typeof METHODS)[number];
  @IsOptional() @IsISO8601({ strict: true }) paidAt?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

class PaymentQueryDto extends PageQueryDto {
  @IsOptional() @IsYmd() from?: string;
  @IsOptional() @IsYmd() to?: string;
  @IsOptional() @IsIn(METHODS) method?: (typeof METHODS)[number];
  @IsOptional() @IsUUID() studentId?: string;
}

/** Tuition: Admin manages; Student sees own invoices; Teacher has no access (V2 §6.2). */
@Controller()
export class TuitionController {
  constructor(private readonly tuition: TuitionService) {}

  @Get('invoices')
  @Roles('ADMIN', 'STUDENT')
  list(@CurrentPrincipal() p: Principal, @Query() q: InvoiceQueryDto) {
    return this.tuition.list(p, q);
  }

  @Post('invoices')
  @Roles('ADMIN')
  create(@CurrentPrincipal() p: Principal, @Body() dto: CreateInvoiceDto) {
    return this.tuition.create(p, dto);
  }

  @Get('invoices/:id')
  @Roles('ADMIN', 'STUDENT')
  get(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.tuition.get(p, id);
  }

  @Patch('invoices/:id')
  @Roles('ADMIN')
  update(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInvoiceDto) {
    return this.tuition.update(p, id, dto);
  }

  @Post('invoices/:id/cancel')
  @Roles('ADMIN')
  cancel(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.tuition.cancel(p, id);
  }

  @Post('invoices/:id/payments')
  @Roles('ADMIN')
  pay(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Headers('idempotency-key') key: string | undefined, @Body() dto: PaymentDto) {
    return this.tuition.pay(p, id, key, dto);
  }

  @Get('payments')
  @Roles('ADMIN', 'STUDENT')
  payments(@CurrentPrincipal() p: Principal, @Query() q: PaymentQueryDto) {
    return this.tuition.payments(p, q);
  }

  @Get('tuition/summary')
  @Roles('ADMIN', 'STUDENT')
  summary(@CurrentPrincipal() p: Principal) {
    return this.tuition.summary(p);
  }
}
