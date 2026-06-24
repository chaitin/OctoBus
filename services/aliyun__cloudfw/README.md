# Alibaba Cloud Cloud Firewall

OctoBus service package for Alibaba Cloud Cloud Firewall asset, address book, internet ACL, VPC ACL, and NAT ACL APIs.

## Import

Service root: `services/aliyun__cloudfw`.

```bash
octobus service import --id aliyun-cloudfw ./services/aliyun__cloudfw
```

## Bindings

Configuration:

- `endpoint`: CloudFW endpoint, for example `cloudfw.cn-hangzhou.aliyuncs.com`.
- `regionId`: Alibaba Cloud region ID.
- `protocol`: optional, defaults to `HTTPS`.
- `lang`: optional default language passed to CloudFW requests when the RPC request omits `lang`.
- `connectTimeout`, `readTimeout`, `timeoutMs`: optional SDK timeouts in milliseconds.

Secrets:

- `accessKeyId`
- `accessKeySecret`
- `securityToken`: optional STS token.

## RPC Methods

- `aliyun.cloudfw.v1.AliyunCloudFWService/ListAssets`
- `aliyun.cloudfw.v1.AliyunCloudFWService/ListAddressBooks`
- `aliyun.cloudfw.v1.AliyunCloudFWService/CreateAddressBook`
- `aliyun.cloudfw.v1.AliyunCloudFWService/DeleteAddressBook`
- `aliyun.cloudfw.v1.AliyunCloudFWService/ListInternetControlPolicies`
- `aliyun.cloudfw.v1.AliyunCloudFWService/CreateInternetControlPolicy`
- `aliyun.cloudfw.v1.AliyunCloudFWService/UpdateInternetControlPolicy`
- `aliyun.cloudfw.v1.AliyunCloudFWService/DeleteInternetControlPolicy`
- `aliyun.cloudfw.v1.AliyunCloudFWService/ListVpcFirewalls`
- `aliyun.cloudfw.v1.AliyunCloudFWService/ListVpcControlPolicies`
- `aliyun.cloudfw.v1.AliyunCloudFWService/CreateVpcControlPolicy`
- `aliyun.cloudfw.v1.AliyunCloudFWService/UpdateVpcControlPolicy`
- `aliyun.cloudfw.v1.AliyunCloudFWService/DeleteVpcControlPolicy`
- `aliyun.cloudfw.v1.AliyunCloudFWService/ListNatControlPolicies`
- `aliyun.cloudfw.v1.AliyunCloudFWService/CreateNatControlPolicy`
- `aliyun.cloudfw.v1.AliyunCloudFWService/UpdateNatControlPolicy`
- `aliyun.cloudfw.v1.AliyunCloudFWService/DeleteNatControlPolicy`

## Validation

```bash
cd services
npm run validate -- --service-dir aliyun__cloudfw
npm test -- --service-dir aliyun__cloudfw --coverage
npm run pack:check
```
