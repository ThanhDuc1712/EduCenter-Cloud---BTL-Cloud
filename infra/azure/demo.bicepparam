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
