# sing-box Background

本文档记录当前阶段项目使用到的技术、参考材料、实现思路、策略选择与测试经验，方便后续继续迭代。

## 1. 当前技术栈

### 后端

- `Node.js 24+`
- Node.js 内置模块
  - `http`
  - `fs/promises`
  - `path`
  - `url`
  - `buffer`
  - `child_process`

### 前端

- 原生 HTML / CSS / JavaScript
- `fetch`
- 简单轮询刷新
- 表单模式与 JSON 模式切换

### 代理内核

- `sing-box`

### 测试环境

- Windows 11
- PowerShell
- `curl.exe`
- `Test-NetConnection`

## 2. 主要参考材料

### sing-box 官方资料

- 配置文档
  - [https://sing-box.sagernet.org/zh/configuration/](https://sing-box.sagernet.org/zh/configuration/)
- 官方仓库
  - [https://github.com/SagerNet/sing-box](https://github.com/SagerNet/sing-box)
- Release 页面
  - [https://github.com/SagerNet/sing-box/releases](https://github.com/SagerNet/sing-box/releases)

### 节点解析参考

- `v2rayN`
  - [https://github.com/2dust/v2rayN](https://github.com/2dust/v2rayN)

说明：

- 订阅与单行节点解析逻辑参考了 `v2rayN` 的协议兼容思路
- `sing-box` 配置字段以官方文档为准，不直接照搬旧版示例

## 3. 当前架构

当前项目分为三层：

- 管理层：`Node.js`
- 代理层：`sing-box`
- 展示层：静态 Web UI

### 管理层职责

- 读写业务配置
- 拉取并解析订阅
- 手动导入并解析节点
- 维护节点组
- 获取并缓存内核版本列表
- 自动检测架构并规划下载版本
- 下载与替换 `sing-box` 内核
- 生成运行时配置
- 控制 `sing-box` 进程
- 维护运行日志和 fallback 状态

### 代理层职责

- 提供多个本地 `SOCKS5` 入站
- 连接远端节点
- 执行出站转发
- 处理 DNS 查询
- 执行路由与出站绑定

### 展示层职责

- 编辑基础配置
- 编辑多个 `SOCKS5` 服务
- 查看和管理节点
- 管理节点组
- 管理内核版本
- 查看运行状态与实时日志

## 4. 当前关键模块

- `D:\sub2socks5\src\server.js`
  - HTTP 服务入口与 API 路由
- `D:\sub2socks5\src\lib\subscription.js`
  - 订阅解析、原始节点导入解析、协议识别
- `D:\sub2socks5\src\lib\singbox-config.js`
  - 业务配置转 `sing-box` 配置
- `D:\sub2socks5\src\lib\storage.js`
  - 默认配置、文件持久化、状态缓存
- `D:\sub2socks5\src\lib\singbox-manager.js`
  - `sing-box` 启停与日志收集
- `D:\sub2socks5\src\lib\singbox-release.js`
  - release 版本读取、过滤、下载、解压
- `D:\sub2socks5\src\public\app.js`
  - 首页交互逻辑
- `D:\sub2socks5\src\public\nodes.js`
  - 节点管理页交互逻辑

## 5. 节点输入与解析策略

### 订阅解析

当前支持：

- 多行节点文本
- Base64 订阅
- URL Safe Base64 订阅

当前支持协议：

- `vmess`
- `vless`
- `trojan`
- `shadowsocks`
- `hysteria2`
- `tuic`

### 手动节点导入

当前支持输入类型：

1. 单行节点链接
2. 多行节点文本
3. 结构化 JSON
4. 带 `raw` 字段的 JSON

解析流程：

1. 先判断是否为 JSON
2. 如果是 JSON，优先按结构化节点处理
3. 如果不是 JSON，则当作原始订阅 / 链接文本解析
4. 先识别协议，再按协议模板做字段映射

补充说明：

- 已修复 Base64 订阅内容中 `raw` 字段导致的误判问题
- 已兼容 `ss://base64-userinfo@host:port#tag` 这一类形式

## 6. 多 SOCKS5 服务模型

当前不再只支持一个端口。

每个 `SOCKS5` 服务包含：

- `tag`
- `listen`
- `port`
- `target`

配置保存位置：

- `config.ports[]`

生成运行配置时：

- 每个 `ports[]` 条目生成一个 `socks` 入站
- 每个入站按 tag 绑定到对应目标出站

用途说明：

- 一个本地软件可指向一个固定端口
- 不同端口可分别使用不同节点或节点组出网

## 7. DNS 方案与防泄漏思路

当前默认配置：

- 远端 DoH：`https://cloudflare-dns.com/dns-query`
- Bootstrap DNS：`223.5.5.5:53`

设计目标：

- 尽量避免本机直接 DNS 泄漏
- 使用远端 DoH 完成主解析
- 使用 Bootstrap DNS 解析 DoH 域名

当前实践结论：

- 直接使用 `https://1.1.1.1/dns-query` 容易在部分环境出现证书、SNI 或超时问题
- 采用 `cloudflare-dns.com` + Bootstrap DNS 的方案后，代理访问 Google / Gstatic 更稳定

## 8. 节点组策略

### `urltest`

- 映射为 `sing-box` 原生 `urltest`
- 支持参数：
  - 测试地址
  - 测试间隔
  - 超时毫秒

当前默认测试地址：

- `https://www.gstatic.com/generate_204`

### `fallback`

目标语义参考 Mihomo 风格故障转移：

- 优先使用前面的节点
- 定时探测可用性
- 当前节点失效时切到下一个可用节点

当前实现状态：

- 不是 `sing-box` 原生出站类型
- 当前为应用层第一版
- 后端通过 `runtimeState.fallbackGroups` 维护状态
- 节点管理页可显示：
  - 当前活跃节点
  - 最近切换时间

当前探测思路：

- 使用 `clash_api` 的延迟检测能力
- 后端轮询组成员健康状态
- 必要时改写当前选择并重新生成运行配置

## 9. UI 交互经验与修复点

### 表单失焦问题

历史问题：

- 编辑 `SOCKS5` 服务时输入框失焦
- 打开节点下拉框后快速消失
- 保存配置时出现状态被轮询覆盖

根因：

- 首页轮询刷新时重绘了表单与服务列表

处理方式：

- 增加交互态标记
- 用户编辑中暂停表单回填
- 避免在交互中重绘关键表单区域

### 日志展示

- 实时日志不再单独占主页窗口
- 调整为主页选项卡
- 日志与状态查看都保留在同一页面内

### 下载进度展示

- 不再保留顶部全局下载条
- 仅在实际下载内核时，将进度写入原消息区域

## 10. API 能力

### 配置

- `GET /api/config`
- `POST /api/config`

### 订阅

- `POST /api/subscription/refresh`

### 节点

- `GET /api/nodes`
- `POST /api/nodes`
- `POST /api/nodes/import`

### 内核

- `GET /api/kernel/status`
- `POST /api/kernel/architecture`
- `GET /api/kernel/releases`
- `POST /api/kernel/releases/update`
- `POST /api/kernel/plan`
- `GET /api/kernel/download`
- `POST /api/kernel/download`

### 运行时

- `POST /api/runtime/generate`
- `POST /api/runtime/start`
- `POST /api/runtime/stop`
- `GET /api/runtime/generated`
- `GET /api/runtime/logs`

## 11. 当前测试方法

### 获取配置

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:18080/api/config"
```

### 获取节点

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:18080/api/nodes"
```

### 导入手动节点

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

### 生成运行配置

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:18080/api/runtime/generate" `
  -Method Post `
  -ContentType "application/json" `
  -Body "{}"
```

### 启动运行时

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:18080/api/runtime/start" `
  -Method Post `
  -ContentType "application/json" `
  -Body "{}"
```

### 检查 SOCKS5 端口

```powershell
Test-NetConnection -ComputerName 127.0.0.1 -Port 53456
```

### 通过代理访问 Google

```powershell
curl.exe --socks5-hostname 127.0.0.1:53456 --max-time 25 https://www.google.com/generate_204 -I -s -o NUL -w "%{http_code}"
```

### 通过代理访问 Gstatic

```powershell
curl.exe --socks5-hostname 127.0.0.1:53456 --max-time 25 https://www.gstatic.com/generate_204 -I -s -o NUL -w "%{http_code}"
```

## 12. 当前测试结论

已完成验证：

- Web UI 启动正常
- `GET /api/config` 正常
- `GET /api/nodes` 正常
- `POST /api/nodes/import` 可成功导入 `vless://...`
- `SOCKS5` 端口监听正常
- 代理访问 Google / Gstatic 返回 `204`

环境说明：

- 当前在本地 PowerShell 环境中可验证真实代理链路
- 某些沙箱环境中 `sing-box` 子进程可能触发 `spawn EPERM`
- 这类问题属于环境限制，不等同于程序逻辑错误

## 13. 当前已知限制

- `fallback` 仍是第一版，不是完整 Mihomo 语义
- 某些机场私有字段仍可能需要继续兼容
- 结构化 JSON 输入仍可继续补全协议默认字段
- 内核下载速度仍受 GitHub 网络质量影响

## 14. 后续建议

- 给手动导入增加预览与校验结果提示
- 为节点健康检查增加更直观的 UI 展示
- 增强 `fallback` 的回切逻辑
- 增加更多代理链路诊断工具
