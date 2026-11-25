using './main.bicep'

// Sửa 3 dòng dưới cho đúng tài khoản của bạn. Không ghi mật khẩu vào file này.
param location = readEnvironmentVariable('EDU_AZ_LOCATION', 'southeastasia')
param suffix = readEnvironmentVariable('EDU_SUFFIX', 'gdemo')
param operatorObjectId = readEnvironmentVariable('EDU_OPERATOR_OBJECT_ID')

// F1 = miễn phí khi chờ app; đặt $env:EDU_APP_SKU = "B1" khi Doanh deploy bản thật (Always On + health check)
param appServiceSku = readEnvironmentVariable('EDU_APP_SKU', 'F1')
param appServiceCapacity = 1
param linuxFxVersion = 'NODE|24-lts'
param pgSkuName = 'Standard_B1ms'
param pgTier = 'Burstable'
param pgVersion = '16'
param pgStorageGB = 32

// Đặt trong PowerShell trước khi deploy (xem hướng dẫn mục 4.3), không bao giờ commit:
param pgAdminPassword = readEnvironmentVariable('EDU_PG_ADMIN_PASSWORD') // gitleaks:allow (đọc từ biến môi trường)

param githubEnvironment = 'demo'

// Cấu hình ứng dụng. Đặt EDU_APP_ORIGIN = đúng default domain đang chạy (xem output webAppDefaultHostName).
param appOrigin = readEnvironmentVariable('EDU_APP_ORIGIN', '')
param logLevel = 'log'
param callbackHmacActiveKeyId = readEnvironmentVariable('EDU_CALLBACK_KEY_ID', 'k1')
param opsAllowedCidrs = readEnvironmentVariable('EDU_OPS_ALLOWED_CIDRS', '')
// Chỉ đặt khi bucket + secret oss-api-* đã có; trống = LOCAL.
param ossQuarantineBucket = readEnvironmentVariable('EDU_OSS_QUARANTINE_BUCKET', '')
param ossPublishedBucket = readEnvironmentVariable('EDU_OSS_PUBLISHED_BUCKET', '')
param slsProject = readEnvironmentVariable('EDU_SLS_PROJECT', '')
