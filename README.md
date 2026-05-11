# sub2socks5

一个基于 `Go + sing-box` 的本地代理管理器，用于把机场订阅、手动节点和节点组组织成可视化、可多端口分流的 `SOCKS5` 代理服务。

## 当前能力

- 拉取并解析订阅节点
- 支持多订阅地址
  - 多个订阅 URL 顺序拉取
  - 自动合并节点
  - 自动去重
- 支持 `vmess`、`vless`、`trojan`、`shadowsocks`、`hysteria2`、`tuic`
- 支持 Base64、URL Safe Base64、多行订阅文本
- 支持手动导入节点
  - 单行节点链接
  - 多行节点文本
  - 结构化 JSON
  - 带 `raw` 字段的 JSON
- 支持节点管理
  - 订阅节点
  - 手动节点
  - 节点组
  - 固定保留 `direct` 节点
- 支持多个本地 `SOCKS5` 服务
  - 每个端口可绑定不同节点或节点组
- 支持节点组策略
  - `urltest`
  - `fallback`（当前为应用层第一版）
- 支持内核管理
  - 检测系统架构
  - 获取 release 版本列表
  - 设置计划下载版本
  - 拉取匹配架构的 `sing-box` 内核
- 支持 DNS 防泄漏优化
  - 远端 DoH
  - Bootstrap DNS
  - 默认域名解析器单独配置
  - 每个 `SOCKS5` 目标出口绑定各自的 DoH server
- 支持运行状态与实时日志查看
- 支持保存配置后自动生成 `sing-box` 配置
- 支持运行中自动应用新配置
  - 当前实现方式为自动重启 `sing-box`

## 社区链接
- [LINUX DO](https://linux.do/)

## 项目结构

- `D:\sub2socks5\main.go`
  - 程序入口
  - 嵌入 `internal/public` 静态资源并启动应用
- `D:\sub2socks5\internal\app\app.go`
  - HTTP 服务入口
  - 提供 Web UI 与后端 API
  - 配置管理、订阅解析、运行时控制、内核下载管理
- `D:\sub2socks5\internal\public\index.html`
  - 主页
- `D:\sub2socks5\internal\public\app.js`
  - 主页交互逻辑
- `D:\sub2socks5\internal\public\nodes.html`
  - 节点管理页
- `D:\sub2socks5\internal\public\nodes.js`
  - 节点管理逻辑
- `D:\sub2socks5\internal\public\style.css`
  - 页面样式

### 持久化目录

- `D:\sub2socks5\internal\data`
  - 业务配置
  - 订阅状态
  - 架构信息
  - 版本列表缓存
  - 计划下载版本
- `D:\sub2socks5\internal\runtime`
  - 生成后的 `sing-box.json`
- `D:\sub2socks5\internal\bin`
  - 已安装的 `sing-box` 内核

## 工作流程

1. 启动 Web UI
   - `go run .`
2. 在主页保存基础配置
3. 更新订阅，或在节点管理页导入手动节点
4. 配置节点组与多个本地 `SOCKS5` 服务
5. 保存配置后自动生成 `sing-box` 配置
6. 如果 `sing-box` 正在运行，则自动重启应用新配置
7. 不同本地端口分别通过不同节点或节点组提供代理服务

## DNS 策略

当前支持：

- DoH 服务器预设
  - `https://dns.google/dns-query`
  - `https://cloudflare-dns.com/dns-query`
  - 自定义
- DoH 引导解析 DNS 预设
  - `1.1.1.1`
  - `8.8.8.8`
  - `223.5.5.5`
  - 自定义

当前设计目标：

- 尽量减少本机直连 DNS 泄漏
- 主解析使用远端 DoH
- 用 Bootstrap DNS 解析 DoH 域名
- 每个本地 `SOCKS5` 服务的 DNS 请求跟随其目标出口，而不是统一走默认出口

## 节点组说明

### `urltest`

- 使用 `sing-box` 原生 `urltest`
- 支持测试地址预设
  - `https://www.gstatic.com/generate_204`
  - `https://www.google.com/generate_204`
  - `https://cp.cloudflare.com/generate_204`
  - 自定义
- 定时对组内节点进行延迟测试
- 自动选择更优节点转发流量

### `fallback`

- 当前不是 `sing-box` 原生出站类型
- 目前实现为应用层故障转移第一版
- 后端维护当前活跃节点
- 周期性通过探测结果切换可用节点
- 节点管理页可查看当前活跃成员和最近切换时间

## Web UI 页面

### 首页

支持：

- 检测当前架构
- 检查内核版本
- 检查版本更新
- 设置计划版本
- 拉取 `sing-box` 内核
- 保存基础配置
- 更新订阅
- 启动 / 停止 `sing-box`
- 配置多个订阅地址
- 配置多个 `SOCKS5` 服务
- 配置 DoH 服务器与 Bootstrap DNS 预设
- 查看状态、生成结果和实时日志

首页当前布局：

- 第一行：`Web UI 监听地址`、`Web UI 端口`、`sing-box 二进制路径`、`日志级别`
- 第二行：`DNS 策略`、`DOH 服务器`、`DoH 引导解析 DNS`
- 第三行：`默认路由出口`、`自动启动`

运行状态区域：

- `状态`：显示运行摘要
- `日志`：显示 `sing-box` 实时日志

### 节点管理页

支持：

- 导入手动节点
- 查看 / 删除手动节点
- 添加节点组
- 为节点组设置策略与测试参数
- 按行添加节点组成员
- 查看 `fallback` 当前活跃节点状态
- 现有节点以卡片形式展示
  - 第一行显示节点名称
  - 第二行显示协议和来源标签
- 节点组使用可展开卡片展示
  - 折叠态显示组名、策略、成员数量
  - 展开后显示组内节点与编辑项

## 手动导入节点格式

### 单行节点链接

```text
vless://uuid@example.com:443?security=tls&sni=example.com#my-node
```

### 多行节点文本

```text
vless://...
trojan://...
ss://...
```

### 结构化 JSON

```json
{
  "type": "vless",
  "tag": "my-node",
  "server": "example.com",
  "server_port": 443,
  "uuid": "..."
}
```

### 带 `raw` 的 JSON

```json
{
  "raw": "vless://uuid@example.com:443?security=tls#my-node"
}
```

处理逻辑：

1. 先判断输入是否为 JSON
2. 如果是 JSON，优先按结构化节点处理
3. 如果不是 JSON，则按订阅 / 链接文本解析
4. 先识别协议，再套用对应协议模板解析

## API 列表

### 配置相关

- `GET /api/config`
- `POST /api/config`
  - 保存业务配置
  - 自动生成新的 `sing-box` 配置
  - 如果运行中则自动重启应用新配置

### 订阅相关

- `POST /api/subscription/refresh`

### 节点相关

- `GET /api/nodes`
- `POST /api/nodes`
- `POST /api/nodes/import`

### 内核相关

- `GET /api/kernel/status`
- `POST /api/kernel/architecture`
- `GET /api/kernel/releases`
- `POST /api/kernel/releases/update`
- `POST /api/kernel/plan`
- `GET /api/kernel/download`
- `POST /api/kernel/download`

### 运行时相关

- `POST /api/runtime/generate`
- `POST /api/runtime/start`
- `POST /api/runtime/stop`
- `GET /api/runtime/generated`
- `GET /api/runtime/logs`

## API 调用与测试方法

以下示例以 Windows PowerShell 为准。

### 1. 启动服务

```powershell
node src/server.js
```

访问：

```text
http://127.0.0.1:18080
```

### 2. 获取当前配置

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:18080/api/config"
```

### 3. 获取节点列表

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:18080/api/nodes"
```

### 4. 手动导入节点

```powershell
$body = @{
  raw = "vless://uuid@example.com:443?security=tls&sni=example.com#my-node"
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri "http://127.0.0.1:18080/api/nodes/import" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body
```

### 5. 更新订阅

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:18080/api/subscription/refresh" `
  -Method Post `
  -ContentType "application/json" `
  -Body "{}"
```

### 6. 保存配置并自动应用

```powershell
$config = Invoke-RestMethod -Uri "http://127.0.0.1:18080/api/config"

Invoke-RestMethod `
  -Uri "http://127.0.0.1:18080/api/config" `
  -Method Post `
  -ContentType "application/json" `
  -Body ($config.config | ConvertTo-Json -Depth 20)
```

### 7. 启动 `sing-box`

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:18080/api/runtime/start" `
  -Method Post `
  -ContentType "application/json" `
  -Body "{}"
```

### 8. 查看运行日志

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:18080/api/runtime/logs"
```

### 9. 测试本地 `SOCKS5` 端口是否监听

假设当前端口为 `53456`：

```powershell
Test-NetConnection -ComputerName 127.0.0.1 -Port 53456
```

### 10. 测试是否能通过代理访问 Google

```powershell
curl.exe --socks5-hostname 127.0.0.1:53456 --max-time 25 https://www.google.com/generate_204 -I -s -o NUL -w "%{http_code}"
```

预期：

```text
204
```

### 11. 测试是否能通过代理访问 Gstatic

```powershell
curl.exe --socks5-hostname 127.0.0.1:53456 --max-time 25 https://www.gstatic.com/generate_204 -I -s -o NUL -w "%{http_code}"
```

预期：

```text
204
```

## 当前已验证结果

- Web UI 可正常启动在 `18080`
- `GET /api/config` 正常返回
- `GET /api/nodes` 正常返回
- `POST /api/nodes/import` 已验证可成功导入 `vless://...`
- `SOCKS5` 端口已验证可监听
- 已验证可通过代理访问 Google / Gstatic 并返回 `204`
- 已验证多出口 DNS server 生成逻辑正确
- 已验证节点组排序在普通节点前面

## 注意事项

- `fallback` 目前仍是第一版应用层实现
- 某些机场私有字段仍可能需要继续兼容
- 当前“运行中应用新配置”采用重启 `sing-box` 的方式，而不是热重载
- 不建议把运行期文件和本地状态文件提交到 Git

## 打包方法

当前项目使用 Go 原生构建产出单文件可执行程序，程序逻辑与 `internal/public` 静态资源会一起打包进二进制。

### 前置要求

- 已安装 Go 1.23+
- 在项目根目录执行命令

### 构建 Windows 可执行文件

```powershell
go build -trimpath -ldflags "-s -w" -o dist/sub2socks5-windows-x64.exe .
```

### 输出文件

构建完成后会生成：

- `D:\sub2socks5\dist\sub2socks5-windows-x64.exe`

### 运行方式

```powershell
cd D:\sub2socks5\dist
.\sub2socks5-windows-x64.exe
```

默认 Web UI 地址：

```text
http://127.0.0.1:18080
```

### 首次运行行为

- 如果不存在配置文件，程序会自动生成默认配置
- 运行目录为可执行文件所在目录
- 默认会创建或使用以下子目录：
  - `internal/data`
  - `internal/runtime`
  - `internal/bin`

### 打包说明

- 可执行文件会包含全部 Go 业务逻辑和 `internal/public` 静态资源
- `sing-box` 内核不会嵌入到 exe 中
- 首次运行后，用户可以通过 Web UI 按系统架构下载对应的 `sing-box` 内核
- 因此发布时通常只需要提供：
  - `sub2socks5-sea.exe`
  - 或者由用户首次运行后自行下载内核

### 注意事项

- 用户配置与运行时状态不会嵌入二进制，仍保存在 `internal/data` 和 `internal/runtime`
- 如用于正式分发，建议对可执行文件进行代码签名

## GitHub Actions

项目已提供 GitHub Actions 工作流，支持手动触发全平台构建，以及手动触发构建后发布到 GitHub Release。

### 工作流文件

- `D:\sub2socks5\.github\workflows\reusable-build.yml`
  - 可复用构建模板
  - 统一维护平台与架构矩阵
  - 内置可选 smoke test，用于验证首页 `http://127.0.0.1:18080/` 可访问
- `D:\sub2socks5\.github\workflows\build.yml`
  - 手动触发
  - 只构建，不发布
- `D:\sub2socks5\.github\workflows\release.yml`
  - 手动触发
  - 先构建，再发布到 GitHub Release

### 当前构建目标

- `linux-x64`
- `linux-arm64`
- `windows-x64`
- `windows-arm64`
- `macos-x64`
- `macos-arm64`

### 产物规则

- 每个平台/架构单独构建一个二进制文件
- 每个平台/架构单独打包为一个 zip
- 每个 zip 中只包含一个二进制文件

产物命名示例：

- `sub2socks5-linux-x64.zip`
- `sub2socks5-linux-arm64.zip`
- `sub2socks5-windows-x64.zip`
- `sub2socks5-windows-arm64.zip`
- `sub2socks5-macos-x64.zip`
- `sub2socks5-macos-arm64.zip`

### 手动构建

1. 打开 GitHub 仓库的 `Actions`
2. 选择 `Build`
3. 点击 `Run workflow`

构建完成后，可在该次 workflow 的 `Artifacts` 中下载各平台单个二进制文件。

说明：

- `Build` 工作流不会先手动打 zip
- GitHub Actions 下载 artifact 时仍会以 GitHub 自身的 artifact 压缩形式提供
- 因此 `Build` 用于验证构建是否成功，而不是提供最终发布压缩包

### 手动发布 Release

1. 打开 GitHub 仓库的 `Actions`
2. 选择 `Release`
3. 点击 `Run workflow`
4. 填写：
   - `release_tag_prefix`
   - `release_name`

`Release` 工作流会：

- 自动构建全部平台/架构产物
- 自动按平台/架构分别打包 zip
- 自动收集所有 zip
- 自动创建或更新对应的 GitHub Release
- 自动把所有 zip 上传到 Release 附件

### 说明

- `Build` 适合日常验证构建是否正常
- `Release` 适合正式生成发布附件
- 如果后续要增减平台或架构，只需要修改 `D:\sub2socks5\.github\workflows\reusable-build.yml`
- 当前构建为 Go 单文件模式，`internal/public` 通过 `embed` 打包进二进制
