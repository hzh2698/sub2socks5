# sub2socks5

一个基于 `Node.js + sing-box` 的本地代理管理器，用于把机场订阅、手动节点和节点组组织成可视化、可多端口分流的 `SOCKS5` 代理服务。

## 当前能力

- 拉取并解析订阅节点
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
- 支持运行状态与实时日志查看

## 项目结构

- `D:\sub2socks5\src\server.js`
  - HTTP 服务入口
  - 提供 Web UI 与后端 API
- `D:\sub2socks5\src\lib\subscription.js`
  - 订阅拉取与节点解析
  - 手动节点原始输入解析
- `D:\sub2socks5\src\lib\singbox-config.js`
  - 业务配置转换为 `sing-box` 配置
- `D:\sub2socks5\src\lib\singbox-manager.js`
  - `sing-box` 进程控制
- `D:\sub2socks5\src\lib\singbox-release.js`
  - release 获取、版本筛选、下载
- `D:\sub2socks5\src\lib\storage.js`
  - 默认配置与持久化
- `D:\sub2socks5\src\public\index.html`
  - 主页
- `D:\sub2socks5\src\public\app.js`
  - 主页交互逻辑
- `D:\sub2socks5\src\public\nodes.html`
  - 节点管理页
- `D:\sub2socks5\src\public\nodes.js`
  - 节点管理逻辑
- `D:\sub2socks5\src\public\style.css`
  - 页面样式

### 持久化目录

- `D:\sub2socks5\data`
  - 业务配置
  - 订阅状态
  - 架构信息
  - 版本列表缓存
  - 计划下载版本
- `D:\sub2socks5\runtime`
  - 生成后的 `sing-box.json`
- `D:\sub2socks5\bin`
  - 已安装的 `sing-box` 内核

## 工作流程

1. 启动 Web UI
   - `node src/server.js`
2. 在主页保存基础配置
3. 更新订阅，或在节点管理页导入手动节点
4. 配置节点组与多个本地 `SOCKS5` 服务
5. 生成 `sing-box` 运行配置
6. 启动 `sing-box`
7. 不同本地端口分别通过不同节点或节点组提供代理服务

## DNS 策略

当前默认配置：

- 远端 DoH：`https://cloudflare-dns.com/dns-query`
- Bootstrap DNS：`223.5.5.5:53`

设计目标：

- 尽量减少本机直连 DNS 泄漏
- 由远端 DoH 完成主要解析
- 用 Bootstrap DNS 解析 DoH 域名，保证首跳稳定

## 节点组说明

### `urltest`

- 使用 `sing-box` 原生 `urltest`
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
- 生成配置
- 启动 / 停止 `sing-box`
- 配置多个 `SOCKS5` 服务
- 查看状态、生成结果和实时日志

### 节点管理页

支持：

- 导入手动节点
- 查看 / 删除手动节点
- 添加节点组
- 为节点组设置策略与测试参数
- 按行添加节点组成员
- 查看 `fallback` 当前活跃节点状态

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

### 6. 生成运行配置

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:18080/api/runtime/generate" `
  -Method Post `
  -ContentType "application/json" `
  -Body "{}"
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

## 注意事项

- `fallback` 目前仍是第一版应用层实现
- 某些机场私有字段仍可能需要继续兼容
- 不建议把运行期文件和本地状态文件提交到 Git

## 后续建议

- 给手动导入增加导入预览
- 给结构化 JSON 输入补全更多协议默认字段
- 继续增强 Mihomo 风格 `fallback`
- 为节点健康检查增加更直观的 UI 展示
