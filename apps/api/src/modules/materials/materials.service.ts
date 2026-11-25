import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { MaterialStatus, Prisma, ProcessorKind } from '../../generated/prisma/client';
import { ActivityService, type NotificationTarget } from '../../common/activity/activity.service';
import { badRequest, conflict, notFound, unprocessable } from '../../common/authz/scope';
import { AppConfigService } from '../../common/config/app-config.service';
import type { Principal } from '../../common/context/principal';
import { AppException } from '../../common/errors/app-exception';
import { pageArgs, toPage } from '../../common/http/pagination';
import { OpsLogService } from '../../common/observability/ops-log.service';
import { TelemetryService } from '../../common/observability/telemetry.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantTx, type Db } from '../../common/prisma/tenant-tx';
import { STORAGE_PROVIDER, storageKeys, type StorageProvider, type UploadTarget } from '../storage/storage.types';
import { canTransition } from './material-state';
import type { ProcessingResult } from './processing-result';

export type MaterialCategory = 'LECTURE' | 'SYLLABUS' | 'EXERCISE' | 'EXAM' | 'REFERENCE' | 'OTHER';
export type MaterialVisibility = 'COURSE' | 'CLASS' | 'PERSONAL';

export interface CreateMaterialInput {
  title: string;
  description?: string;
  category: MaterialCategory;
  visibility: MaterialVisibility;
  courseId?: string;
  classroomId?: string;
  studentId?: string;
  teacherId?: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface MaterialQuery {
  q?: string;
  status?: MaterialStatus;
  category?: MaterialCategory;
  visibility?: MaterialVisibility;
  courseId?: string;
  classroomId?: string;
  teacherId?: string;
  page: number;
  pageSize: number;
}

/** Dispatch hook implemented by the processing provider (LOCAL worker or Aliyun FC). */
export interface ProcessingDispatcher {
  readonly kind: ProcessorKind;
  dispatch(job: DispatchJob): Promise<{ sourceVersionId?: string | null }>;
}

export interface DispatchJob {
  tenantId: string;
  materialId: string;
  jobId: string;
  attempt: number;
  correlationId: string;
  sourceKey: string;
  isRetry: boolean;
}

export const PROCESSING_DISPATCHER = Symbol('PROCESSING_DISPATCHER');

const include = {
  course: { select: { id: true, code: true, name: true } },
  classroom: { select: { id: true, code: true, name: true } },
  teacher: { select: { id: true, fullName: true } },
  student: { select: { id: true, code: true, fullName: true } },
  jobs: { orderBy: { attempt: 'desc' }, take: 1 },
} satisfies Prisma.MaterialInclude;

type MaterialRow = Prisma.MaterialGetPayload<{ include: typeof include }>;

export function mapMaterial(m: MaterialRow) {
  const job = m.jobs[0];
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    category: m.category,
    visibility: m.visibility,
    status: m.status,
    course: m.course,
    classroom: m.classroom,
    teacher: m.teacher,
    student: m.student,
    storageProvider: m.storageProvider,
    originalFilename: m.originalFilename,
    contentType: m.contentType,
    sizeBytes: m.sizeBytes ?? m.declaredSize,
    checksumSha256: m.checksumSha256,
    sourceVersionId: m.sourceVersionId,
    pageCount: m.pageCount,
    pdfTitle: m.pdfTitle,
    pdfAuthor: m.pdfAuthor,
    hasPreview: Boolean(m.previewKey),
    previewType: m.previewType,
    rejectReason: m.rejectReason,
    version: m.version,
    uploadedBy: m.uploadedBy,
    downloadCount: m.downloadCount,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    processingAt: m.processingAt,
    readyAt: m.readyAt,
    latestJob: job ? { id: job.id, attempt: job.attempt, processor: job.processor, status: job.status, correlationId: job.correlationId, durationMs: job.durationMs, errorCode: job.errorCode } : null,
  };
}

const newCorrelationId = (materialId: string, attempt: number) => `mat-${materialId.slice(0, 8)}-a${attempt}-${randomBytes(3).toString('hex')}`;
const safeFilename = (name: string) => [...name].map((c) => (c < ' ' || '\\/:*?"<>|'.includes(c) ? '_' : c)).join('').slice(0, 200);

@Injectable()
export class MaterialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tx: TenantTx,
    private readonly activity: ActivityService,
    private readonly config: AppConfigService,
    private readonly ops: OpsLogService,
    private readonly telemetry: TelemetryService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(PROCESSING_DISPATCHER) private readonly dispatcher: ProcessingDispatcher,
  ) {}

  /** Materials a principal may see. Students only ever see READY materials they are entitled to. */
  scope(p: Principal): Prisma.MaterialWhereInput {
    if (p.role === 'ADMIN') return { tenantId: p.tenantId };
    if (p.role === 'TEACHER') {
      return {
        tenantId: p.tenantId,
        OR: [{ teacherId: p.teacherId }, { classroom: { teacherId: p.teacherId } }, { visibility: 'COURSE', course: { classrooms: { some: { teacherId: p.teacherId } } } }],
      };
    }
    const enrolled = { some: { studentId: p.studentId, status: { in: ['ACTIVE' as const, 'COMPLETED' as const] } } };
    return {
      tenantId: p.tenantId,
      status: 'READY',
      OR: [
        { visibility: 'COURSE', course: { classrooms: { some: { enrollments: enrolled } } } },
        { visibility: 'CLASS', classroom: { enrollments: enrolled } },
        { visibility: 'PERSONAL', studentId: p.studentId },
      ],
    };
  }

  async list(p: Principal, q: MaterialQuery) {
    const search = q.q?.trim();
    const where: Prisma.MaterialWhereInput = {
      AND: [
        this.scope(p),
        q.status ? { status: q.status } : { status: { not: 'DELETED' } },
        q.category ? { category: q.category } : {},
        q.visibility ? { visibility: q.visibility } : {},
        q.courseId ? { OR: [{ courseId: q.courseId }, { classroom: { courseId: q.courseId } }] } : {},
        q.classroomId ? { classroomId: q.classroomId } : {},
        q.teacherId ? { teacherId: q.teacherId } : {},
        search ? { OR: [{ title: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }, { originalFilename: { contains: search, mode: 'insensitive' } }] } : {},
      ],
    };
    const [rows, total, byStatus] = await Promise.all([
      this.prisma.material.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q), include }),
      this.prisma.material.count({ where }),
      this.prisma.material.groupBy({ by: ['status'], where: this.scope(p), _count: true }),
    ]);
    return { ...toPage(rows.map(mapMaterial), total, q), countsByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])) };
  }

  async get(p: Principal, id: string) {
    const m = await this.prisma.material.findFirst({ where: { AND: [this.scope(p), { id }] }, include });
    if (!m) throw notFound('tài liệu');
    return mapMaterial(m);
  }

  async history(p: Principal, id: string) {
    await this.get(p, id);
    const [jobs, events] = await Promise.all([
      this.prisma.materialProcessingJob.findMany({ where: { tenantId: p.tenantId, materialId: id }, orderBy: { attempt: 'desc' } }),
      this.prisma.materialProcessingEvent.findMany({ where: { tenantId: p.tenantId, materialId: id }, orderBy: { createdAt: 'asc' } }),
    ]);
    return { jobs, events: events.map((e) => ({ id: e.id, type: e.type, source: e.source, fromStatus: e.fromStatus, toStatus: e.toStatus, detail: e.detail, createdAt: e.createdAt })) };
  }

  /** Validates links and the uploader's right to publish to them. */
  private async resolveLinks(db: Db, p: Principal, dto: CreateMaterialInput) {
    let courseId = dto.courseId ?? null;
    const classroomId = dto.classroomId ?? null;
    let studentId = dto.studentId ?? null;
    let teacherId = p.role === 'TEACHER' ? p.teacherId! : dto.teacherId ?? null;

    if (classroomId) {
      const c = await db.classroom.findFirst({ where: { tenantId: p.tenantId, id: classroomId } });
      if (!c) throw notFound('lớp học');
      if (p.role === 'TEACHER' && c.teacherId !== p.teacherId) throw new AppException('FORBIDDEN', HttpStatus.FORBIDDEN, 'Chỉ được tải tài liệu cho lớp mình phụ trách');
      courseId = courseId ?? c.courseId;
      if (courseId !== c.courseId) throw badRequest('Lớp không thuộc khóa học đã chọn', 'classroomId');
      teacherId = teacherId ?? c.teacherId;
    }
    if (courseId) {
      const course = await db.course.findFirst({ where: { tenantId: p.tenantId, id: courseId } });
      if (!course) throw notFound('khóa học');
      if (p.role === 'TEACHER' && !(await db.classroom.findFirst({ where: { tenantId: p.tenantId, courseId, teacherId: p.teacherId }, select: { id: true } }))) {
        throw new AppException('FORBIDDEN', HttpStatus.FORBIDDEN, 'Chỉ được tải tài liệu cho khóa học có lớp mình phụ trách');
      }
    }
    if (dto.visibility === 'COURSE' && !courseId) throw badRequest('Tài liệu khóa học cần chọn khóa học', 'courseId');
    if (dto.visibility === 'CLASS' && !classroomId) throw badRequest('Tài liệu lớp học cần chọn lớp', 'classroomId');
    if (dto.visibility === 'PERSONAL') {
      if (!studentId) throw badRequest('Tài liệu cá nhân cần chọn học viên được cấp quyền', 'studentId');
      const s = await db.student.findFirst({ where: { tenantId: p.tenantId, id: studentId } });
      if (!s) throw notFound('học viên');
      if (p.role === 'TEACHER' && !(await db.enrollment.findFirst({ where: { tenantId: p.tenantId, studentId, classroom: { teacherId: p.teacherId } }, select: { id: true } }))) {
        throw new AppException('FORBIDDEN', HttpStatus.FORBIDDEN, 'Học viên không thuộc lớp mình phụ trách');
      }
    } else studentId = null;
    if (teacherId && !(await db.teacher.findFirst({ where: { tenantId: p.tenantId, id: teacherId }, select: { id: true } }))) throw notFound('giáo viên');
    return { courseId, classroomId, studentId, teacherId };
  }

  /** Step 1: metadata row + processing job (QUEUED) + direct-upload policy for the quarantine bucket. */
  async create(p: Principal, dto: CreateMaterialInput): Promise<{ material: ReturnType<typeof mapMaterial>; upload: UploadTarget }> {
    const max = this.config.get('UPLOAD_MAX_BYTES');
    if (dto.contentType !== 'application/pdf' || !/\.pdf$/i.test(dto.filename)) throw unprocessable('UNSUPPORTED_FILE_TYPE', 'Chỉ hỗ trợ tài liệu PDF (.pdf)');
    if (dto.size > max) throw new AppException('PAYLOAD_TOO_LARGE', HttpStatus.PAYLOAD_TOO_LARGE, `Tệp vượt quá ${Math.round(max / 1024 / 1024)} MB`);

    const id = randomUUID();
    const quarantineKey = storageKeys.quarantine(p.tenantId, id);
    const correlationId = newCorrelationId(id, 1);
    const processor: ProcessorKind = this.dispatcher.kind;
    const created = await this.tx.run(p, async (db) => {
      const links = await this.resolveLinks(db, p, dto);
      const m = await db.material.create({
        data: {
          id,
          tenantId: p.tenantId,
          title: dto.title,
          description: dto.description,
          category: dto.category,
          visibility: dto.visibility,
          ...links,
          storageProvider: this.storage.kind,
          originalFilename: safeFilename(dto.filename),
          contentType: dto.contentType,
          declaredSize: dto.size,
          quarantineKey,
          uploadedBy: p.displayName,
        },
        include,
      });
      const job = await db.materialProcessingJob.create({ data: { tenantId: p.tenantId, materialId: id, attempt: 1, processor, status: 'QUEUED', correlationId } });
      await db.materialProcessingEvent.create({ data: { tenantId: p.tenantId, materialId: id, jobId: job.id, eventId: `api:create:${id}`, type: 'material.created', source: 'API', toStatus: 'UPLOADING', detail: { filename: m.originalFilename, size: dto.size, storage: this.storage.kind } } });
      await this.activity.record(db, p, { action: 'material.created', entityType: 'material', entityId: id, summary: `Tạo tài liệu "${dto.title}" – chờ tải lên ${this.storage.kind}` });
      return m;
    });

    // Network call after the transaction commits (never inside it).
    const upload = await this.storage.createUploadTarget(quarantineKey, {
      contentType: 'application/pdf',
      maxBytes: max,
      expiresInSeconds: this.config.get('UPLOAD_POLICY_TTL_SECONDS'),
      metadata: { 'tenant-id': p.tenantId, 'material-id': id, 'correlation-id': correlationId, attempt: '1' },
    });
    await this.ops.write({ provider: this.storage.kind === 'OSS' ? 'ALIYUN' : 'LOCAL', service: this.storage.kind === 'OSS' ? 'OSS' : 'LOCAL_STORAGE', level: 'INFO', event: 'upload.policy.issued', message: `Cấp upload policy ${this.config.get('UPLOAD_POLICY_TTL_SECONDS')}s cho "${dto.title}"`, tenantId: p.tenantId, materialId: id, correlationId, detail: { bucket: this.storage.bucketName('quarantine'), maxBytes: max } });
    return { material: mapMaterial(created), upload };
  }

  /** New upload policy for a material still in UPLOADING (e.g. the first one expired). */
  async renewUpload(p: Principal, id: string): Promise<UploadTarget> {
    const m = await this.prisma.material.findFirst({ where: { AND: [this.scope(p), { id }] }, include: { jobs: { orderBy: { attempt: 'desc' }, take: 1 } } });
    if (!m) throw notFound('tài liệu');
    if (m.status !== 'UPLOADING') throw unprocessable('MATERIAL_NOT_UPLOADING', 'Tài liệu không còn ở trạng thái chờ tải lên');
    return this.storage.createUploadTarget(m.quarantineKey, {
      contentType: 'application/pdf',
      maxBytes: this.config.get('UPLOAD_MAX_BYTES'),
      expiresInSeconds: this.config.get('UPLOAD_POLICY_TTL_SECONDS'),
      metadata: { 'tenant-id': p.tenantId, 'material-id': id, 'correlation-id': m.jobs[0]?.correlationId ?? newCorrelationId(id, 1), attempt: String(m.jobs[0]?.attempt ?? 1) },
    });
  }

  /** Step 2: the browser reports the upload finished; we verify the object really is in quarantine. */
  async complete(p: Principal, id: string) {
    const m = await this.prisma.material.findFirst({ where: { AND: [this.scope(p), { id }] } });
    if (!m) throw notFound('tài liệu');
    if (m.status !== 'UPLOADING') return this.get(p, id); // idempotent (callback may already have arrived)
    const head = await this.storage.head('quarantine', m.quarantineKey);
    if (!head) throw unprocessable('UPLOAD_NOT_FOUND', 'Chưa tìm thấy tệp trong vùng quarantine. Hãy tải lên lại.');
    await this.markUploaded(m.tenantId, id, head.size, head.versionId, 'API', p);
    return this.get(p, id);
  }

  /** UPLOADING → PROCESSING, start the current job and hand it to the processing provider. Also used by the reconciler. */
  async markUploaded(tenantId: string, materialId: string, size: number, versionId: string | null, source: 'API' | 'RECONCILER', actor?: Principal) {
    const max = this.config.get('UPLOAD_MAX_BYTES');
    const job = await this.prisma.$transaction(async (db) => {
      const m = await db.material.findFirst({ where: { tenantId, id: materialId }, include: { jobs: { orderBy: { attempt: 'desc' }, take: 1 } } });
      if (!m || m.status !== 'UPLOADING') return null;
      if (size > max) {
        await this.transition(db, m, 'REJECTED', { rejectReason: 'Tệp vượt quá dung lượng cho phép', sizeBytes: size }, { type: 'upload.too_large', source, detail: { size, max } });
        return null;
      }
      await this.transition(db, m, 'PROCESSING', { sizeBytes: size, sourceVersionId: versionId, processingAt: new Date() }, { type: 'upload.completed', source, jobId: m.jobs[0]?.id, detail: { size, versionId } });
      const j = m.jobs[0];
      const started = await db.materialProcessingJob.update({ where: { id: j.id }, data: { status: 'RUNNING', startedAt: new Date(), sourceVersionId: versionId } });
      if (actor) await this.activity.record(db, actor, { action: 'material.uploaded', entityType: 'material', entityId: materialId, summary: `Đã tải lên "${m.title}" (${Math.round(size / 1024)} KB) – bắt đầu xử lý` });
      return { ...started, quarantineKey: m.quarantineKey };
    });
    if (!job) return;
    await this.ops.write({ provider: this.storage.kind === 'OSS' ? 'ALIYUN' : 'LOCAL', service: this.storage.kind === 'OSS' ? 'OSS' : 'LOCAL_STORAGE', level: 'INFO', event: 'upload.verified', message: `Tệp đã có trong quarantine (${size} bytes, version ${versionId ?? '-'})`, tenantId, materialId, correlationId: job.correlationId });
    await this.dispatch({ tenantId, materialId, jobId: job.id, attempt: job.attempt, correlationId: job.correlationId, sourceKey: job.quarantineKey, isRetry: false });
  }

  async dispatch(job: DispatchJob): Promise<void> {
    try {
      const res = await this.dispatcher.dispatch(job);
      if (res.sourceVersionId) {
        await this.prisma.material.updateMany({ where: { tenantId: job.tenantId, id: job.materialId }, data: { sourceVersionId: res.sourceVersionId } });
        await this.prisma.materialProcessingJob.update({ where: { id: job.jobId }, data: { sourceVersionId: res.sourceVersionId } });
      }
    } catch (err) {
      await this.ops.write({ provider: this.dispatcher.kind === 'ALIYUN_FC' ? 'ALIYUN' : 'LOCAL', service: this.dispatcher.kind === 'ALIYUN_FC' ? 'FUNCTION_COMPUTE' : 'LOCAL_PROCESSOR', level: 'ERROR', event: 'processing.dispatch_failed', message: `Không kích hoạt được xử lý: ${(err as Error).name}`, tenantId: job.tenantId, materialId: job.materialId, correlationId: job.correlationId });
    }
  }

  /** Guarded state change: allowed transition + optimistic version check + processing event. */
  async transition(
    db: Db,
    m: { id: string; tenantId: string; status: MaterialStatus; version: number },
    to: MaterialStatus,
    data: Prisma.MaterialUncheckedUpdateManyInput,
    event: { type: string; source: string; eventId?: string; jobId?: string | null; detail?: Record<string, unknown> },
  ): Promise<void> {
    if (!canTransition(m.status, to)) throw unprocessable('INVALID_MATERIAL_TRANSITION', `Không thể chuyển tài liệu từ ${m.status} sang ${to}`);
    const res = await db.material.updateMany({ where: { id: m.id, version: m.version, status: m.status }, data: { ...data, status: to, version: { increment: 1 } } });
    if (res.count === 0) throw conflict('MATERIAL_CONCURRENT_UPDATE', 'Tài liệu vừa được cập nhật bởi tiến trình khác');
    await db.materialProcessingEvent.create({
      data: { tenantId: m.tenantId, materialId: m.id, jobId: event.jobId ?? null, eventId: event.eventId ?? `${event.source.toLowerCase()}:${randomUUID()}`, type: event.type, source: event.source, fromStatus: m.status, toStatus: to, detail: (event.detail ?? undefined) as Prisma.InputJsonValue | undefined },
    });
  }

  /**
   * Applies a worker result (callback or reconciler replay). Idempotent: a repeated eventId is
   * reported as duplicate; a result for an outdated source version or a deleted material is ignored.
   */
  async applyResult(r: ProcessingResult, source: 'CALLBACK' | 'RECONCILER'): Promise<{ applied: boolean; duplicate?: boolean; reason?: string; status?: MaterialStatus }> {
    const receivedAt = Date.now();
    if (await this.prisma.materialProcessingEvent.findUnique({ where: { eventId: r.eventId }, select: { id: true } })) return { applied: false, duplicate: true };
    const expectedDoc = storageKeys.document(r.tenantId, r.materialId);
    const allowedPreviews = [storageKeys.preview(r.tenantId, r.materialId, 'png'), storageKeys.preview(r.tenantId, r.materialId, 'pdf')];
    if (r.sourceKey !== storageKeys.quarantine(r.tenantId, r.materialId)) return { applied: false, reason: 'SOURCE_KEY_MISMATCH' };
    if (r.result && (r.result.documentKey !== expectedDoc || (r.result.previewKey && !allowedPreviews.includes(r.result.previewKey)))) return { applied: false, reason: 'OUTPUT_KEY_MISMATCH' };

    const outcome = await this.prisma.$transaction(async (db) => {
      const m = await db.material.findFirst({ where: { tenantId: r.tenantId, id: r.materialId }, include: { jobs: { orderBy: { attempt: 'desc' }, take: 1 } } });
      if (!m) return { applied: false, reason: 'MATERIAL_NOT_FOUND' } as const;
      const record = async (type: string, reason: string) => {
        await db.materialProcessingEvent.create({ data: { tenantId: m.tenantId, materialId: m.id, eventId: r.eventId, type, source, fromStatus: m.status, toStatus: m.status, detail: { reason, sourceVersionId: r.sourceVersionId ?? null } } });
        return { applied: false, reason, status: m.status } as const;
      };
      if (m.status === 'DELETED') return record('callback.ignored', 'MATERIAL_DELETED');
      if (m.status === 'READY' || m.status === 'REJECTED') return record('callback.ignored', 'ALREADY_FINAL');
      if (m.sourceVersionId && r.sourceVersionId && m.sourceVersionId !== r.sourceVersionId) return record('callback.stale', 'STALE_SOURCE_VERSION');

      let job = m.jobs[0];
      if (!job || job.status === 'SUCCEEDED' || job.status === 'REJECTED') {
        job = await db.materialProcessingJob.create({ data: { tenantId: m.tenantId, materialId: m.id, attempt: (job?.attempt ?? 0) + 1, processor: r.processor, status: 'RUNNING', correlationId: r.correlationId ?? newCorrelationId(m.id, (job?.attempt ?? 0) + 1) } });
      }
      const callbackLatencyMs = Math.max(0, receivedAt - new Date(r.finishedAt).getTime());
      await db.materialProcessingJob.update({
        where: { id: job.id },
        data: {
          status: r.status === 'READY' ? 'SUCCEEDED' : r.status === 'REJECTED' ? 'REJECTED' : 'FAILED',
          processor: r.processor,
          startedAt: new Date(r.startedAt),
          finishedAt: new Date(r.finishedAt),
          durationMs: r.durationMs,
          callbackLatencyMs: source === 'CALLBACK' ? callbackLatencyMs : null,
          errorCode: r.error?.code ?? null,
          errorMessage: r.error?.message ?? null,
          sourceVersionId: r.sourceVersionId ?? job.sourceVersionId,
        },
      });
      const data: Prisma.MaterialUncheckedUpdateManyInput =
        r.status === 'READY'
          ? {
              sizeBytes: r.result!.sizeBytes,
              checksumSha256: r.result!.sha256,
              pageCount: r.result!.pageCount,
              pdfTitle: r.result!.title?.slice(0, 300) ?? null,
              pdfAuthor: r.result!.author?.slice(0, 300) ?? null,
              publishedKey: r.result!.documentKey,
              previewKey: r.result!.previewKey ?? null,
              previewType: r.result!.previewContentType ?? null,
              resultKey: storageKeys.result(m.tenantId, m.id),
              sourceVersionId: r.sourceVersionId ?? m.sourceVersionId,
              readyAt: new Date(),
              rejectReason: null,
            }
          : { rejectReason: r.error!.message.slice(0, 300), resultKey: storageKeys.result(m.tenantId, m.id) };
      await this.transition(db, m, r.status, data, { type: `processing.${r.status.toLowerCase()}`, source, eventId: r.eventId, jobId: job.id, detail: { processor: r.processor, durationMs: r.durationMs, error: r.error?.code ?? null, pageCount: r.result?.pageCount ?? null } });

      const targets = await this.audience(db, m);
      if (r.status === 'READY') {
        await this.activity.notify(db, m.tenantId, { type: 'MATERIAL', title: `Tài liệu mới: ${m.title}`, body: `Tài liệu "${m.title}" (${r.result!.pageCount} trang) đã sẵn sàng để xem và tải xuống.`, link: `/materials/${m.id}` }, targets.readers);
      }
      await this.activity.notify(
        db,
        m.tenantId,
        { type: 'MATERIAL', title: r.status === 'READY' ? `Đã xử lý xong "${m.title}"` : `Tài liệu "${m.title}" bị ${r.status === 'REJECTED' ? 'từ chối' : 'lỗi xử lý'}`, body: r.status === 'READY' ? `Xử lý bởi ${r.processor === 'ALIYUN_FC' ? 'Alibaba Function Compute' : 'bộ xử lý LOCAL (mô phỏng)'} trong ${r.durationMs} ms.` : `Lý do: ${r.error!.message}`, link: `/materials/${m.id}` },
        targets.owners,
      );
      return { applied: true, status: r.status, callbackLatencyMs, correlationId: job.correlationId } as const;
    });

    if (outcome.applied) {
      if (source === 'CALLBACK') this.telemetry.metric('callback.latency', outcome.callbackLatencyMs);
      this.telemetry.metric(r.processor === 'ALIYUN_FC' ? 'fc.duration' : 'local.processor.duration', r.durationMs, r.status !== 'FAILED');
      this.telemetry.event('material.processed', { status: r.status, processor: r.processor, durationMs: r.durationMs, source });
      await this.ops.write({ provider: r.processor === 'ALIYUN_FC' ? 'ALIYUN' : 'LOCAL', service: source === 'CALLBACK' ? 'CALLBACK' : 'RECONCILER', level: r.status === 'READY' ? 'INFO' : 'WARN', event: `material.${r.status.toLowerCase()}`, message: r.status === 'READY' ? `Tài liệu READY (${r.result!.pageCount} trang, ${r.durationMs} ms)` : `Tài liệu ${r.status}: ${r.error!.code}`, tenantId: r.tenantId, materialId: r.materialId, correlationId: outcome.correlationId, durationMs: r.durationMs, detail: { eventId: r.eventId, callbackLatencyMs: source === 'CALLBACK' ? outcome.callbackLatencyMs : null } });
    }
    return { applied: outcome.applied, reason: 'reason' in outcome ? outcome.reason : undefined, status: outcome.status };
  }

  /** Readers (students entitled + teacher) and owners (uploader teacher / admins). */
  private async audience(db: Db, m: { tenantId: string; visibility: string; courseId: string | null; classroomId: string | null; studentId: string | null; teacherId: string | null }) {
    let readers: NotificationTarget[] = [];
    if (m.visibility === 'PERSONAL' && m.studentId) readers = [{ role: 'STUDENT', studentId: m.studentId }];
    else if (m.visibility === 'CLASS' && m.classroomId) readers = await this.activity.classAudience(db, m.tenantId, m.classroomId);
    else if (m.courseId) {
      const classes = await db.classroom.findMany({ where: { tenantId: m.tenantId, courseId: m.courseId, status: { in: ['ACTIVE', 'PLANNED'] } }, select: { id: true } });
      for (const c of classes) readers.push(...(await this.activity.classAudience(db, m.tenantId, c.id)));
    }
    const owners: NotificationTarget[] = m.teacherId ? [{ role: 'TEACHER', teacherId: m.teacherId }, { role: 'ADMIN' }] : [{ role: 'ADMIN' }];
    return { readers: readers.filter((t) => t.role === 'STUDENT'), owners };
  }

  /** Short-lived signed URL for preview or download (published bucket only). */
  async access(p: Principal, id: string, kind: 'preview' | 'download') {
    const m = await this.prisma.material.findFirst({ where: { AND: [this.scope(p), { id }] } });
    if (!m) throw notFound('tài liệu');
    if (m.status !== 'READY' || !m.publishedKey) throw unprocessable('MATERIAL_NOT_READY', 'Tài liệu chưa sẵn sàng');
    const ttl = this.config.get('SIGNED_URL_TTL_SECONDS');
    const key = kind === 'preview' ? m.previewKey ?? m.publishedKey : m.publishedKey;
    const contentType = kind === 'preview' ? m.previewType ?? 'application/pdf' : 'application/pdf';
    const started = performance.now();
    const url = await this.storage.signedGetUrl('published', key, { expiresInSeconds: ttl, filename: kind === 'download' ? m.originalFilename : `preview-${m.originalFilename.replace(/\.pdf$/i, '')}.${contentType === 'image/png' ? 'png' : 'pdf'}`, disposition: kind === 'download' ? 'attachment' : 'inline', contentType });
    this.telemetry.dependency({ name: 'storage.sign', type: this.storage.kind === 'OSS' ? 'OSS' : 'LocalStorage', target: this.storage.bucketName('published'), durationMs: performance.now() - started, success: true });
    if (kind === 'download') {
      await this.tx.run(p, async (db) => {
        await db.material.update({ where: { id }, data: { downloadCount: { increment: 1 } } });
        await this.activity.record(db, p, { action: 'material.downloaded', entityType: 'material', entityId: id, summary: `Tải xuống tài liệu "${m.title}"` });
      });
    }
    return { kind, url, contentType, expiresAt: new Date(Date.now() + ttl * 1000).toISOString(), ttlSeconds: ttl, provider: this.storage.kind };
  }

  private async assertCanModify(p: Principal, id: string) {
    const m = await this.prisma.material.findFirst({ where: { tenantId: p.tenantId, id }, include: { classroom: { select: { teacherId: true } } } });
    if (!m) throw notFound('tài liệu');
    if (p.role === 'TEACHER' && m.teacherId !== p.teacherId && m.classroom?.teacherId !== p.teacherId) throw new AppException('FORBIDDEN', HttpStatus.FORBIDDEN, 'Chỉ người tải lên hoặc giáo viên phụ trách lớp được thao tác');
    return m;
  }

  async update(p: Principal, id: string, dto: { title?: string; description?: string; category?: MaterialCategory }) {
    await this.assertCanModify(p, id);
    await this.tx.run(p, async (db) => {
      await db.material.update({ where: { id }, data: dto });
      await this.activity.record(db, p, { action: 'material.updated', entityType: 'material', entityId: id, summary: `Cập nhật thông tin tài liệu "${dto.title ?? id}"` });
    });
    return this.get(p, id);
  }

  /** Soft delete in DB, then remove objects from both buckets (outside the transaction). */
  async remove(p: Principal, id: string) {
    const m = await this.assertCanModify(p, id);
    if (m.status === 'DELETED') return { deleted: true };
    await this.tx.run(p, async (db) => {
      await this.transition(db, m, 'DELETED', { deletedAt: new Date() }, { type: 'material.deleted', source: 'API' });
      await this.activity.record(db, p, { action: 'material.deleted', entityType: 'material', entityId: id, summary: `Xóa tài liệu "${m.title}"` });
    });
    const keys: [('quarantine' | 'published'), string | null][] = [['quarantine', m.quarantineKey], ['published', m.publishedKey], ['published', m.previewKey], ['published', storageKeys.result(m.tenantId, m.id)]];
    for (const [role, key] of keys) {
      if (!key) continue;
      try {
        await this.storage.delete(role, key);
      } catch (err) {
        await this.ops.write({ provider: this.storage.kind === 'OSS' ? 'ALIYUN' : 'LOCAL', service: this.storage.kind === 'OSS' ? 'OSS' : 'LOCAL_STORAGE', level: 'WARN', event: 'storage.delete_failed', message: `Không xóa được object (${(err as Error).name}) — lifecycle sẽ dọn`, tenantId: m.tenantId, materialId: id });
      }
    }
    await this.ops.write({ provider: this.storage.kind === 'OSS' ? 'ALIYUN' : 'LOCAL', service: this.storage.kind === 'OSS' ? 'OSS' : 'LOCAL_STORAGE', level: 'INFO', event: 'material.objects_deleted', message: `Đã xóa object của tài liệu "${m.title}" (phiên bản cũ do versioning/lifecycle quản lý)`, tenantId: m.tenantId, materialId: id });
    return { deleted: true };
  }

  /** Manual retry for FAILED (or stuck PROCESSING) materials: new job attempt, re-dispatch. */
  async retry(p: Principal, id: string, source: 'API' | 'RECONCILER' = 'API') {
    const m = source === 'API' ? await this.assertCanModify(p, id) : await this.prisma.material.findFirstOrThrow({ where: { tenantId: p.tenantId, id } });
    if (m.status !== 'FAILED' && m.status !== 'PROCESSING') throw unprocessable('MATERIAL_NOT_RETRYABLE', 'Chỉ thử lại tài liệu đang lỗi hoặc xử lý quá lâu');
    const max = this.config.get('PROCESSING_MAX_ATTEMPTS');
    const job = await this.prisma.$transaction(async (db) => {
      const current = await db.material.findFirstOrThrow({ where: { id }, include: { jobs: { orderBy: { attempt: 'desc' }, take: 1 } } });
      const last = current.jobs[0];
      if (source === 'RECONCILER' && last && last.attempt >= max) return null;
      if (last && (last.status === 'RUNNING' || last.status === 'QUEUED')) await db.materialProcessingJob.update({ where: { id: last.id }, data: { status: 'TIMED_OUT', finishedAt: new Date(), errorCode: 'SUPERSEDED', errorMessage: 'Được thay bằng lần xử lý mới' } });
      const attempt = (last?.attempt ?? 0) + 1;
      const j = await db.materialProcessingJob.create({ data: { tenantId: current.tenantId, materialId: id, attempt, processor: this.dispatcher.kind, status: 'RUNNING', startedAt: new Date(), correlationId: newCorrelationId(id, attempt), sourceVersionId: current.sourceVersionId } });
      await this.transition(db, current, 'PROCESSING', { processingAt: new Date(), rejectReason: null, sourceVersionId: null }, { type: 'processing.retry', source, jobId: j.id, detail: { attempt } });
      if (source === 'API') await this.activity.record(db, p, { action: 'material.retry', entityType: 'material', entityId: id, summary: `Thử xử lý lại tài liệu "${current.title}" (lần ${attempt})` });
      return j;
    });
    if (!job) return null;
    await this.ops.write({ provider: this.dispatcher.kind === 'ALIYUN_FC' ? 'ALIYUN' : 'LOCAL', service: source === 'API' ? (this.dispatcher.kind === 'ALIYUN_FC' ? 'FUNCTION_COMPUTE' : 'LOCAL_PROCESSOR') : 'RECONCILER', level: 'WARN', event: 'processing.retry', message: `Xử lý lại lần ${job.attempt}`, tenantId: m.tenantId, materialId: id, correlationId: job.correlationId });
    await this.dispatch({ tenantId: m.tenantId, materialId: id, jobId: job.id, attempt: job.attempt, correlationId: job.correlationId, sourceKey: m.quarantineKey, isRetry: true });
    return source === 'API' ? this.get(p, id) : job;
  }
}
