import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../../common/auth/password';

const TENANT_SLUG = /^[a-z0-9-]{2,64}$/;
const PHONE = /^[0-9+ .-]{8,20}$/;
/** At least 8 characters with a letter and a digit. */
const STRONG_PASSWORD = /^(?=.*\p{L})(?=.*\d).{8,}$/u;
const normalizeEmail = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class LoginDto {
  /** D-24: the tenant (center) is part of the credentials. */
  @Transform(trim)
  @Matches(TENANT_SLUG, { message: 'Mã trung tâm không hợp lệ' })
  tenantSlug: string;

  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Email không hợp lệ' })
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(1, { message: 'Nhập mật khẩu' })
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}

export class RegisterDto {
  @Transform(trim)
  @Matches(TENANT_SLUG, { message: 'Mã trung tâm không hợp lệ' })
  tenantSlug: string;

  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Họ tên tối thiểu 2 ký tự' })
  @MaxLength(120)
  fullName: string;

  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Email không hợp lệ' })
  @MaxLength(254)
  email: string;

  @IsOptional()
  @Transform(trim)
  @Matches(PHONE, { message: 'Số điện thoại không hợp lệ' })
  phone?: string;

  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(STRONG_PASSWORD, { message: 'Mật khẩu tối thiểu 8 ký tự, gồm cả chữ và số' })
  password: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword: string;

  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(STRONG_PASSWORD, { message: 'Mật khẩu tối thiểu 8 ký tự, gồm cả chữ và số' })
  newPassword: string;
}
