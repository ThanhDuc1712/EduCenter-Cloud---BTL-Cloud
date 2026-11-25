-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TeacherStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ClassroomStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'DROPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

-- CreateEnum
CREATE TYPE "AssessmentType" AS ENUM ('QUIZ', 'ASSIGNMENT', 'MIDTERM', 'FINAL', 'OTHER');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SCHEDULE', 'CLASS', 'TUITION', 'MATERIAL', 'GRADE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "RecipientRole" AS ENUM ('ADMIN', 'TEACHER', 'STUDENT');

-- CreateEnum
CREATE TYPE "MaterialCategory" AS ENUM ('LECTURE', 'SYLLABUS', 'EXERCISE', 'EXAM', 'REFERENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "MaterialVisibility" AS ENUM ('COURSE', 'CLASS', 'PERSONAL');

-- CreateEnum
CREATE TYPE "MaterialStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'REJECTED', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "StorageProviderKind" AS ENUM ('LOCAL', 'OSS');

-- CreateEnum
CREATE TYPE "ProcessorKind" AS ENUM ('LOCAL_MOCK', 'ALIYUN_FC');

-- CreateEnum
CREATE TYPE "ProcessingJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'REJECTED', 'FAILED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "CloudProvider" AS ENUM ('AZURE', 'ALIYUN', 'LOCAL');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "full_name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(20),
    "date_of_birth" DATE,
    "gender" VARCHAR(10),
    "address" VARCHAR(300),
    "guardian_name" VARCHAR(120),
    "guardian_phone" VARCHAR(20),
    "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
    "note" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teachers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "full_name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(20),
    "specialization" VARCHAR(200) NOT NULL,
    "qualification" VARCHAR(200),
    "bio" VARCHAR(2000),
    "hired_at" DATE,
    "status" "TeacherStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teachers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "content" TEXT,
    "level" VARCHAR(50),
    "tuition_vnd" BIGINT NOT NULL,
    "duration_hours" INTEGER NOT NULL,
    "total_sessions" INTEGER NOT NULL,
    "status" "CourseStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "location" VARCHAR(200),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classrooms" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "course_id" UUID NOT NULL,
    "teacher_id" UUID,
    "room_id" UUID,
    "capacity" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "ClassroomStatus" NOT NULL DEFAULT 'PLANNED',
    "tuition_vnd" BIGINT,
    "note" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "classrooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_schedule_slots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "classroom_id" UUID NOT NULL,
    "day_of_week" SMALLINT NOT NULL,
    "start_minute" SMALLINT NOT NULL,
    "duration_minutes" SMALLINT NOT NULL,
    "room_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_schedule_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "classroom_id" UUID NOT NULL,
    "teacher_id" UUID,
    "room_id" UUID,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "topic" VARCHAR(300),
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "note" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "class_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "classroom_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "enrolled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendances" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "note" VARCHAR(300),
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "classroom_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "type" "AssessmentType" NOT NULL,
    "weight" INTEGER NOT NULL,
    "max_score" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "held_on" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grades" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "score" DECIMAL(5,2) NOT NULL,
    "comment" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_bands" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "label" VARCHAR(50) NOT NULL,
    "min_score" DECIMAL(4,2) NOT NULL,

    CONSTRAINT "grade_bands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "student_id" UUID NOT NULL,
    "classroom_id" UUID,
    "course_id" UUID,
    "description" VARCHAR(300) NOT NULL,
    "amount_vnd" BIGINT NOT NULL,
    "discount_vnd" BIGINT NOT NULL DEFAULT 0,
    "paid_vnd" BIGINT NOT NULL DEFAULT 0,
    "due_date" DATE NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'UNPAID',
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount_vnd" BIGINT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "paid_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" VARCHAR(300),
    "received_by" VARCHAR(120),
    "idempotency_key" VARCHAR(64) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "link" VARCHAR(300),
    "recipient_role" "RecipientRole" NOT NULL,
    "recipient_teacher_id" UUID,
    "recipient_student_id" UUID,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_role" VARCHAR(20) NOT NULL,
    "actor_name" VARCHAR(120) NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "entity_type" VARCHAR(40) NOT NULL,
    "entity_id" UUID,
    "summary" VARCHAR(500) NOT NULL,
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "category" "MaterialCategory" NOT NULL,
    "visibility" "MaterialVisibility" NOT NULL,
    "course_id" UUID,
    "classroom_id" UUID,
    "teacher_id" UUID,
    "student_id" UUID,
    "status" "MaterialStatus" NOT NULL DEFAULT 'UPLOADING',
    "storage_provider" "StorageProviderKind" NOT NULL,
    "original_filename" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "declared_size" INTEGER NOT NULL,
    "size_bytes" INTEGER,
    "checksum_sha256" CHAR(64),
    "quarantine_key" VARCHAR(400) NOT NULL,
    "source_version_id" VARCHAR(200),
    "published_key" VARCHAR(400),
    "preview_key" VARCHAR(400),
    "preview_type" VARCHAR(60),
    "result_key" VARCHAR(400),
    "page_count" INTEGER,
    "pdf_title" VARCHAR(300),
    "pdf_author" VARCHAR(300),
    "reject_reason" VARCHAR(300),
    "version" INTEGER NOT NULL DEFAULT 1,
    "uploaded_by" VARCHAR(120) NOT NULL,
    "download_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "processing_at" TIMESTAMPTZ(3),
    "ready_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_processing_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "processor" "ProcessorKind" NOT NULL,
    "status" "ProcessingJobStatus" NOT NULL DEFAULT 'QUEUED',
    "correlation_id" VARCHAR(64) NOT NULL,
    "source_version_id" VARCHAR(200),
    "queued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "duration_ms" INTEGER,
    "callback_latency_ms" INTEGER,
    "error_code" VARCHAR(60),
    "error_message" VARCHAR(500),

    CONSTRAINT "material_processing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_processing_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "job_id" UUID,
    "event_id" VARCHAR(100) NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "from_status" "MaterialStatus",
    "to_status" "MaterialStatus",
    "detail" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_processing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_log_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "provider" "CloudProvider" NOT NULL,
    "service" VARCHAR(40) NOT NULL,
    "level" "LogLevel" NOT NULL,
    "event" VARCHAR(80) NOT NULL,
    "message" VARCHAR(1000) NOT NULL,
    "correlation_id" VARCHAR(64),
    "material_id" UUID,
    "duration_ms" INTEGER,
    "detail" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "background_job_runs" (
    "id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "status" VARCHAR(20) NOT NULL,
    "summary" JSONB,

    CONSTRAINT "background_job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "students_tenant_id_status_full_name_idx" ON "students"("tenant_id", "status", "full_name");

-- CreateIndex
CREATE UNIQUE INDEX "students_tenant_id_id_key" ON "students"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "students_tenant_id_code_key" ON "students"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "teachers_tenant_id_status_full_name_idx" ON "teachers"("tenant_id", "status", "full_name");

-- CreateIndex
CREATE UNIQUE INDEX "teachers_tenant_id_id_key" ON "teachers"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "teachers_tenant_id_code_key" ON "teachers"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "courses_tenant_id_status_idx" ON "courses"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "courses_tenant_id_id_key" ON "courses"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "courses_tenant_id_code_key" ON "courses"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_tenant_id_id_key" ON "rooms"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_tenant_id_name_key" ON "rooms"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "classrooms_tenant_id_status_idx" ON "classrooms"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "classrooms_tenant_id_teacher_id_idx" ON "classrooms"("tenant_id", "teacher_id");

-- CreateIndex
CREATE INDEX "classrooms_tenant_id_course_id_idx" ON "classrooms"("tenant_id", "course_id");

-- CreateIndex
CREATE UNIQUE INDEX "classrooms_tenant_id_id_key" ON "classrooms"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "classrooms_tenant_id_code_key" ON "classrooms"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "class_schedule_slots_tenant_id_classroom_id_idx" ON "class_schedule_slots"("tenant_id", "classroom_id");

-- CreateIndex
CREATE UNIQUE INDEX "class_schedule_slots_tenant_id_id_key" ON "class_schedule_slots"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "class_sessions_tenant_id_starts_at_idx" ON "class_sessions"("tenant_id", "starts_at");

-- CreateIndex
CREATE INDEX "class_sessions_tenant_id_teacher_id_starts_at_idx" ON "class_sessions"("tenant_id", "teacher_id", "starts_at");

-- CreateIndex
CREATE INDEX "class_sessions_tenant_id_room_id_starts_at_idx" ON "class_sessions"("tenant_id", "room_id", "starts_at");

-- CreateIndex
CREATE INDEX "class_sessions_tenant_id_classroom_id_starts_at_idx" ON "class_sessions"("tenant_id", "classroom_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "class_sessions_tenant_id_id_key" ON "class_sessions"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "enrollments_tenant_id_student_id_idx" ON "enrollments"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "enrollments_tenant_id_status_idx" ON "enrollments"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_tenant_id_id_key" ON "enrollments"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_tenant_id_classroom_id_student_id_key" ON "enrollments"("tenant_id", "classroom_id", "student_id");

-- CreateIndex
CREATE INDEX "attendances_tenant_id_student_id_idx" ON "attendances"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendances_tenant_id_id_key" ON "attendances"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "attendances_tenant_id_session_id_student_id_key" ON "attendances"("tenant_id", "session_id", "student_id");

-- CreateIndex
CREATE INDEX "assessments_tenant_id_classroom_id_idx" ON "assessments"("tenant_id", "classroom_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessments_tenant_id_id_key" ON "assessments"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "grades_tenant_id_student_id_idx" ON "grades"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "grades_tenant_id_id_key" ON "grades"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "grades_tenant_id_assessment_id_student_id_key" ON "grades"("tenant_id", "assessment_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_bands_tenant_id_label_key" ON "grade_bands"("tenant_id", "label");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_status_due_date_idx" ON "invoices"("tenant_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_student_id_idx" ON "invoices"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_id_key" ON "invoices"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_code_key" ON "invoices"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "payments_tenant_id_paid_at_idx" ON "payments"("tenant_id", "paid_at");

-- CreateIndex
CREATE INDEX "payments_tenant_id_invoice_id_idx" ON "payments"("tenant_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_id_key" ON "payments"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_idempotency_key_key" ON "payments"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_recipient_role_recipient_teacher_id_idx" ON "notifications"("tenant_id", "recipient_role", "recipient_teacher_id", "recipient_student_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_created_at_idx" ON "notifications"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_logs_tenant_id_created_at_idx" ON "activity_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_logs_tenant_id_entity_type_entity_id_idx" ON "activity_logs"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "materials_tenant_id_status_created_at_idx" ON "materials"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "materials_tenant_id_course_id_idx" ON "materials"("tenant_id", "course_id");

-- CreateIndex
CREATE INDEX "materials_tenant_id_classroom_id_idx" ON "materials"("tenant_id", "classroom_id");

-- CreateIndex
CREATE INDEX "materials_status_updated_at_idx" ON "materials"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "materials_tenant_id_id_key" ON "materials"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "materials_quarantine_key_key" ON "materials"("quarantine_key");

-- CreateIndex
CREATE INDEX "material_processing_jobs_tenant_id_status_queued_at_idx" ON "material_processing_jobs"("tenant_id", "status", "queued_at");

-- CreateIndex
CREATE INDEX "material_processing_jobs_correlation_id_idx" ON "material_processing_jobs"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "material_processing_jobs_tenant_id_id_key" ON "material_processing_jobs"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "material_processing_jobs_material_id_attempt_key" ON "material_processing_jobs"("material_id", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "material_processing_events_event_id_key" ON "material_processing_events"("event_id");

-- CreateIndex
CREATE INDEX "material_processing_events_tenant_id_material_id_created_at_idx" ON "material_processing_events"("tenant_id", "material_id", "created_at");

-- CreateIndex
CREATE INDEX "ops_log_entries_created_at_idx" ON "ops_log_entries"("created_at");

-- CreateIndex
CREATE INDEX "ops_log_entries_provider_service_created_at_idx" ON "ops_log_entries"("provider", "service", "created_at");

-- CreateIndex
CREATE INDEX "ops_log_entries_correlation_id_idx" ON "ops_log_entries"("correlation_id");

-- CreateIndex
CREATE INDEX "ops_log_entries_level_created_at_idx" ON "ops_log_entries"("level", "created_at");

-- CreateIndex
CREATE INDEX "background_job_runs_name_started_at_idx" ON "background_job_runs"("name", "started_at");

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_tenant_id_course_id_fkey" FOREIGN KEY ("tenant_id", "course_id") REFERENCES "courses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_tenant_id_teacher_id_fkey" FOREIGN KEY ("tenant_id", "teacher_id") REFERENCES "teachers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_tenant_id_room_id_fkey" FOREIGN KEY ("tenant_id", "room_id") REFERENCES "rooms"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_schedule_slots" ADD CONSTRAINT "class_schedule_slots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_schedule_slots" ADD CONSTRAINT "class_schedule_slots_tenant_id_classroom_id_fkey" FOREIGN KEY ("tenant_id", "classroom_id") REFERENCES "classrooms"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_schedule_slots" ADD CONSTRAINT "class_schedule_slots_tenant_id_room_id_fkey" FOREIGN KEY ("tenant_id", "room_id") REFERENCES "rooms"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_tenant_id_classroom_id_fkey" FOREIGN KEY ("tenant_id", "classroom_id") REFERENCES "classrooms"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_tenant_id_teacher_id_fkey" FOREIGN KEY ("tenant_id", "teacher_id") REFERENCES "teachers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_tenant_id_room_id_fkey" FOREIGN KEY ("tenant_id", "room_id") REFERENCES "rooms"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_tenant_id_classroom_id_fkey" FOREIGN KEY ("tenant_id", "classroom_id") REFERENCES "classrooms"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_tenant_id_session_id_fkey" FOREIGN KEY ("tenant_id", "session_id") REFERENCES "class_sessions"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_tenant_id_classroom_id_fkey" FOREIGN KEY ("tenant_id", "classroom_id") REFERENCES "classrooms"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_tenant_id_assessment_id_fkey" FOREIGN KEY ("tenant_id", "assessment_id") REFERENCES "assessments"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_bands" ADD CONSTRAINT "grade_bands_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_classroom_id_fkey" FOREIGN KEY ("tenant_id", "classroom_id") REFERENCES "classrooms"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_course_id_fkey" FOREIGN KEY ("tenant_id", "course_id") REFERENCES "courses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_invoice_id_fkey" FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "invoices"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_recipient_teacher_id_fkey" FOREIGN KEY ("tenant_id", "recipient_teacher_id") REFERENCES "teachers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_recipient_student_id_fkey" FOREIGN KEY ("tenant_id", "recipient_student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_tenant_id_course_id_fkey" FOREIGN KEY ("tenant_id", "course_id") REFERENCES "courses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_tenant_id_classroom_id_fkey" FOREIGN KEY ("tenant_id", "classroom_id") REFERENCES "classrooms"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_tenant_id_teacher_id_fkey" FOREIGN KEY ("tenant_id", "teacher_id") REFERENCES "teachers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_processing_jobs" ADD CONSTRAINT "material_processing_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_processing_jobs" ADD CONSTRAINT "material_processing_jobs_tenant_id_material_id_fkey" FOREIGN KEY ("tenant_id", "material_id") REFERENCES "materials"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_processing_events" ADD CONSTRAINT "material_processing_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_processing_events" ADD CONSTRAINT "material_processing_events_tenant_id_material_id_fkey" FOREIGN KEY ("tenant_id", "material_id") REFERENCES "materials"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_processing_events" ADD CONSTRAINT "material_processing_events_tenant_id_job_id_fkey" FOREIGN KEY ("tenant_id", "job_id") REFERENCES "material_processing_jobs"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── Business invariants enforced by the database (schema v1) ─────────────
ALTER TABLE "courses"   ADD CONSTRAINT "courses_tuition_nonneg"      CHECK ("tuition_vnd" >= 0),
                        ADD CONSTRAINT "courses_duration_positive"   CHECK ("duration_hours" > 0 AND "total_sessions" > 0);
ALTER TABLE "rooms"     ADD CONSTRAINT "rooms_capacity_positive"     CHECK ("capacity" > 0);
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_capacity_positive" CHECK ("capacity" > 0 AND "capacity" <= 500),
                        ADD CONSTRAINT "classrooms_dates_ordered"    CHECK ("end_date" >= "start_date"),
                        ADD CONSTRAINT "classrooms_tuition_nonneg"   CHECK ("tuition_vnd" IS NULL OR "tuition_vnd" >= 0);
ALTER TABLE "class_schedule_slots"
                        ADD CONSTRAINT "slots_day_valid"             CHECK ("day_of_week" BETWEEN 1 AND 7),
                        ADD CONSTRAINT "slots_time_valid"            CHECK ("start_minute" BETWEEN 0 AND 1439 AND "duration_minutes" BETWEEN 15 AND 600);
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_time_ordered" CHECK ("ends_at" > "starts_at");
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_weight_valid"  CHECK ("weight" BETWEEN 0 AND 100),
                        ADD CONSTRAINT "assessments_max_positive"    CHECK ("max_score" > 0);
ALTER TABLE "grades"    ADD CONSTRAINT "grades_score_nonneg"         CHECK ("score" >= 0);
ALTER TABLE "grade_bands" ADD CONSTRAINT "grade_bands_min_valid"     CHECK ("min_score" BETWEEN 0 AND 10);
ALTER TABLE "invoices"  ADD CONSTRAINT "invoices_amounts_valid"      CHECK ("amount_vnd" > 0 AND "discount_vnd" >= 0 AND "discount_vnd" <= "amount_vnd" AND "paid_vnd" >= 0 AND "paid_vnd" <= "amount_vnd" - "discount_vnd");
ALTER TABLE "payments"  ADD CONSTRAINT "payments_amount_positive"    CHECK ("amount_vnd" > 0);
ALTER TABLE "materials" ADD CONSTRAINT "materials_size_valid"        CHECK ("declared_size" > 0 AND ("size_bytes" IS NULL OR "size_bytes" >= 0));

-- ───────────── Least privilege for the runtime role (D-25) ─────────────
-- Audit-style tables are append-only for edu_runtime (INSERT/SELECT only).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edu_runtime') THEN
    REVOKE UPDATE, DELETE ON "activity_logs", "material_processing_events" FROM edu_runtime;
    REVOKE UPDATE ON "ops_log_entries" FROM edu_runtime; -- DELETE kept for the retention job
    REVOKE DELETE ON "payments" FROM edu_runtime;
  END IF;
END $$;
