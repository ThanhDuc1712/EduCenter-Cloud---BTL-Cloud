import { plainToInstance, Type } from 'class-transformer';
import { Equals, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested, validateSync } from 'class-validator';

/**
 * Contract shared by the API, the LOCAL worker and Function Compute (functions/material-processor):
 * the worker writes this JSON to `results/<tenant>/<material>/<attempt>/<versionTag>.json` in the published bucket and POSTs
 * the identical bytes to /api/v1/internal/material-callback (HMAC-signed). The reconciler replays the
 * stored JSON when a callback was lost.
 */
export const RESULT_SCHEMA = 'educenter.material-result/v1';

export class ResultDetailsDto {
  @IsInt() @Min(0) sizeBytes: number;
  @Matches(/^[0-9a-f]{64}$/) sha256: string;
  @IsInt() @Min(1) @Max(100000) pageCount: number;
  @IsOptional() @IsString() @MaxLength(300) title?: string | null;
  @IsOptional() @IsString() @MaxLength(300) author?: string | null;
  @IsString() @MaxLength(400) documentKey: string;
  @IsOptional() @IsString() @MaxLength(400) previewKey?: string | null;
  @IsOptional() @IsIn(['image/png', 'application/pdf']) previewContentType?: string | null;
}

export class ResultErrorDto {
  @Matches(/^[A-Z0-9_]{2,60}$/) code: string;
  @IsString() @MaxLength(500) message: string;
}

export class ProcessingResultDto {
  @Equals(RESULT_SCHEMA) schema: string;
  @Matches(/^[A-Za-z0-9:._-]{8,100}$/) eventId: string;
  @IsUUID() tenantId: string;
  @IsUUID() materialId: string;
  @IsString() @MaxLength(400) sourceKey: string;
  @IsOptional() @IsString() @MaxLength(200) sourceVersionId?: string | null;
  @IsOptional() @Matches(/^[A-Za-z0-9:._-]{1,64}$/) correlationId?: string | null;
  @IsIn(['READY', 'REJECTED', 'FAILED']) status: 'READY' | 'REJECTED' | 'FAILED';
  @IsIn(['ALIYUN_FC', 'LOCAL_MOCK']) processor: 'ALIYUN_FC' | 'LOCAL_MOCK';
  @IsISO8601() startedAt: string;
  @IsISO8601() finishedAt: string;
  @IsInt() @Min(0) @Max(3_600_000) durationMs: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) attempt?: number;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => ResultDetailsDto) result?: ResultDetailsDto | null;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => ResultErrorDto) error?: ResultErrorDto | null;
}

export type ProcessingResult = ProcessingResultDto;

export function parseProcessingResult(raw: unknown): { ok: true; value: ProcessingResult } | { ok: false; problems: string[] } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, problems: ['body must be a JSON object'] };
  const dto = plainToInstance(ProcessingResultDto, raw);
  const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: false });
  if (errors.length) return { ok: false, problems: errors.map((e) => e.property) };
  if (dto.status === 'READY' && !dto.result) return { ok: false, problems: ['result'] };
  if (dto.status !== 'READY' && !dto.error) return { ok: false, problems: ['error'] };
  return { ok: true, value: dto };
}
