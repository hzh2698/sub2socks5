# sing-box Background

本文件用于记录当前阶段项目实际使用到的技术、参考材料、配置思路、实现映射和测试结论，方便后续继续开发时快速接手。

---

## 1. 当前使用到的技术

### 1.1 后端技术

- `Node.js 24+`
  - 作为项目主运行时
  - 用于提供本地 HTTP 服务、配置管理、订阅拉取、内核管理和进程控制

- Node.js 内置模块
  - `http`
    - 提供 Web UI 和 API
  - `fs/promises`
    - 读写配置、运行时文件、版本信息、订阅状态
  - `path`
    - 管理跨目录路径
  - `url`
    - 处理模块路径、URL 解析
  - `child_process`
    - 启动 `sing-box`
  - `buffer`
    - 处理订阅 Base64、`vmess` / `ss` 等内容解析

### 1.2 前端技术

- 原生 HTML / CSS / JavaScript
  - 当前没有引入前端框架
  - 使用静态页面 + 原生 DOM 事件实现 Web UI

- 前端交互方式
  - `fetch` 调用后端 API
  - `localStorage`
    - 用于节点管理页和主页之间的联动通知
  - 轮询刷新
    - 用于主页状态、运行日志、下载状态同步

### 1.3 代理内核技术

- `sing-box`
  - 作为核心代理引擎
  - 负责：
    - 启动 `SOCKS5` 入站
    - 节点连接
    - 出站转发
    - DNS 解析
    - 规则路由

### 1.4 配置与运行相关技术

- JSON 配置持久化
  - 项目业务配置保存在 `data\app-config.json`
  - 订阅状态保存在 `data\subscription-state.json`
  - 运行配置保存在 `runtime\sing-box.json`

- GitHub Releases
  - 用于下载匹配架构的 `sing-box` 内核

- PowerShell
  - 用于 Windows 环境下测试端口监听、启动内核、验证代理是否可用

---

## 2. 当前参考材料

当前实现主要参考以下资料：

- `sing-box` 官方中文配置文档
  - `https://sing-box.sagernet.org/zh/configuration/`

- `sing-box` 官方 GitHub 仓库
  - `https://github.com/SagerNet/sing-box`

- `sing-box` Release 页面
  - 用于版本列表同步和内核下载
  - `https://github.com/SagerNet/sing-box/releases`

- `v2rayN` 仓库
  - 用于参考节点解析兼容思路
  - `https://github.com/2dust/v2rayN`

说明：
- 项目实现不是直接复制官方文档，而是根据官方文档结构做工程化映射。
- 某些协议字段、URI 兼容逻辑、DNS 生成方式是在工程调试中逐步修正的。

---

## 3. 当前项目真实架构

项目当前采用：

**`Node.js 管理层 + sing-box 内核层 + 静态 Web UI 层`**

### 3.1 管理层

由 `Node.js` 提供：

- 配置读写
- 订阅拉取与解析
- 节点和节点组管理
- 版本列表管理
- 内核下载管理
- `sing-box` 配置生成
- `sing-box` 进程启动 / 停止
- 运行状态与日志 API

### 3.2 内核层

由 `sing-box` 提供：

- `SOCKS5` 入站监听
- 代理流量转发
- DNS 查询
- 路由与出站选择
- 节点连接与传输层处理

### 3.3 Web UI 层

由静态前端页面提供：

- 基础配置编辑
- 节点管理
- 内核检测与下载
- 运行状态查看
- 实时日志查看
- 表单 / JSON 双模式切换

---

## 4. 当前代码模块映射

### `D:\sub2socks5\src\server.js`

职责：
- HTTP 服务入口
- API 路由分发
- 提供静态页面

当前主要接口：
- `/api/config`
- `/api/subscription/refresh`
- `/api/nodes`
- `/api/kernel/*`
- `/api/runtime/*`

### `D:\sub2socks5\src\lib\storage.js`

职责：
- 初始化 `data / runtime / bin`
- 保存和读取业务配置
- 持久化订阅状态、架构、版本列表、计划版本
- 维护默认配置

### `D:\sub2socks5\src\lib\subscription.js`

职责：
- 拉取机场订阅
- 自动识别和处理：
  - 普通链接列表
  - Base64 订阅
  - URL Safe Base64
- 解析常见节点协议

### `D:\sub2socks5\src\lib\singbox-config.js`

职责：
- 将业务配置转换成 `sing-box` 配置
- 合并：
  - 订阅节点
  - 手动节点
  - 节点组
- 生成：
  - `dns`
  - `inbounds`
  - `outbounds`
  - `route`
  - `experimental`

### `D:\sub2socks5\src\lib\singbox-manager.js`

职责：
- 启动 / 停止 `sing-box`
- 保存运行日志
- 提供当前运行状态

### `D:\sub2socks5\src\lib\singbox-release.js`

职责：
- 检测系统平台和架构
- 从 GitHub Release 获取版本信息
- 选择匹配资产
- 下载并安装内核

### `D:\sub2socks5\src\public\app.js`

职责：
- 主页交互逻辑
- 表单模式和 JSON 模式切换
- 保存配置
- 更新订阅
- 生成配置
- 启动 / 停止 `sing-box`
- 架构检测、版本检测、版本更新、计划版本选择、内核下载
- 日志和状态刷新

### `D:\sub2socks5\src\public\nodes.js`

职责：
- 节点管理页逻辑
- 添加手动节点
- 添加节点组
- 节点组成员选择
- 保存节点配置
- 通过 `localStorage` 通知主页刷新可选出口

---

## 5. 当前使用到的 sing-box 配置概念

当前项目实际生成和使用的 `sing-box` 顶层配置有：

- `log`
- `dns`
- `inbounds`
- `outbounds`
- `route`
- `experimental`

### 5.1 `log`

用途：
- 控制日志级别
- 开启时间戳

### 5.2 `dns`

用途：
- 定义 DNS 服务器
- 指定默认解析器
- 定义 DNS 规则
- 尽量降低 DNS 泄漏

### 5.3 `inbounds`

当前仅使用：
- `type: socks`

用途：
- 为本地不同端口提供多个 `SOCKS5` 入口

### 5.4 `outbounds`

当前使用的出站包括：

- `direct`
- `block`
- 订阅节点出站
- 手动节点出站
- 节点组出站
- `proxy`
- `auto`

### 5.5 `route`

用途：
- 根据入站匹配把流量发到指定出站
- 控制默认出口
- 控制默认域名解析器

### 5.6 `experimental`

当前使用：
- `cache_file`
- `clash_api`

用途：
- 提供缓存和兼容控制接口

---

## 6. 当前节点与节点组模型

### 6.1 节点来源

当前节点分为三类：

- 内置节点
  - `direct`
- 订阅节点
  - 从机场订阅解析而来
- 手动节点
  - 用户在节点管理页自行添加

### 6.2 节点组

当前节点组支持：

- `urltest`
- `fallback`

说明：
- `urltest` 已直接映射为 `sing-box` 的 `urltest`
- `fallback` 当前为了兼容和稳定，暂时映射为更安全的选择器式行为，不完全等价于复杂原生 fallback 行为

### 6.3 主页可选出口

主页的默认路由出口和 `SOCKS5` 目标出口下拉框来自统一的可选出口列表。

当前包含：
- `proxy`
- `auto`
- `direct`
- `block`
- 所有订阅节点
- 所有手动节点
- 所有节点组

---

## 7. 当前 DNS 实现思路

这是当前阶段最重要的实现背景之一。

### 7.1 早期问题

此前出现过这些实际问题：

- 使用旧版 DNS 结构，`sing-box` 新版本报弃用或直接报错
- 使用 `rcode://` 等旧形式会报：
  - `unknown transport type: rcode`
- 使用旧 inbound 字段会报：
  - `legacy inbound fields are deprecated`
- 代理端口虽能监听，但访问 Google 时 DNS 查询超时

### 7.2 当前解决方案

当前实际采用：

- 远程 DoH：
  - `https://cloudflare-dns.com/dns-query`
- 引导 DNS：
  - `223.5.5.5:53`
- `dns-remote`
  - 走代理出站
- `dns-bootstrap`
  - 作为域名解析引导器
- `dns-direct`
  - 本地直连解析器

### 7.3 当前关键修复点

真实修复过程里确认了以下结论：

- 直接用 `https://1.1.1.1/dns-query` 作为默认 DoH 容易出现证书 / SNI / 解析问题
- 给 `dns-bootstrap` 显式设置 `detour: direct` 会导致：
  - `detour to an empty direct outbound makes no sense`
- 将 `route.default_domain_resolver.server` 切到 `dns-bootstrap` 后，Google / Gstatic 代理访问恢复正常

### 7.4 当前最终策略

- 默认流量仍走代理出口
- 域名首次解析优先使用引导 DNS
- 远程 DoH 作为代理环境下的远程解析器
- 这样兼顾了：
  - 出网成功率
  - 远程 DNS 使用
  - 降低本机 DNS 泄漏风险

---

## 8. 当前订阅解析背景

### 8.1 当前支持的输入形式

- 普通按行分发的节点链接
- Base64 编码订阅文本
- URL Safe Base64 订阅
- 混合内容

### 8.2 当前支持协议

- `vmess`
- `vless`
- `trojan`
- `shadowsocks`
- `hysteria2`
- `tuic`

### 8.3 当前已修复的典型问题

- `shadowsocks` 某些 `userinfo` 为 Base64 的格式此前会被识别失败
- 现在已支持类似：
  - `ss://<base64-userinfo>@host:port#tag`

### 8.4 当前限制

- 不同机场会加入私有字段
- 私有参数可能仍需继续兼容
- 某些非常规 URI 仍可能需要追加解析规则

---

## 9. 当前内核下载背景

### 9.1 当前识别方式

当前通过：

- `process.platform`
- `process.arch`

映射到：

- `windows-amd64`
- `windows-arm64`
- `linux-amd64`
- `linux-arm64`
- `darwin-amd64`
- `darwin-arm64`

### 9.2 当前下载逻辑

- 检测架构
- 获取版本列表
- 选择计划版本
- 匹配当前架构资产
- 下载压缩包
- 解压安装内核
- 更新 `app.singBoxBinary`

### 9.3 版本列表策略

当前版本列表会固化到文件：

- `D:\sub2socks5\data\release-list.json`

策略：
- 有本地版本列表时优先读取本地
- 用户点击“检查版本更新”时再主动从 GitHub 同步

---

## 10. 当前 Web UI 交互模型

### 10.1 主页

当前主页包含：

- 架构检测
- 内核状态查看
- 版本列表选择
- 拉取内核
- 基础配置编辑
- 订阅更新
- 节点管理入口
- 运行状态
- 生成结果
- 实时日志选项卡

### 10.2 视图模式

当前大部分区域支持：

- 表单模式
- JSON 模式

说明：
- 高频字段优先在表单模式下编辑
- 复杂结构可切换到 JSON 模式查看

### 10.3 节点管理页

当前节点管理页支持：

- 手动节点管理
- 节点组管理
- 节点组成员按行添加
- 保存后主页自动刷新出口列表

---

## 11. 当前测试材料与测试方法

### 11.1 当前测试材料

当前已经用于实际联调的材料包括：

- 真实机场订阅链接
- 已安装的 `sing-box.exe`
- 生成后的 `runtime\sing-box.json`
- PowerShell
- `curl.exe`
- Google / Gstatic 的 `generate_204` 接口

### 11.2 当前测试指标

当前关注：

- Web UI 是否可访问
- 节点是否能解析成功
- 节点组保存后主页是否立即可见
- `sing-box` 是否能正常启动
- `SOCKS5` 端口是否监听成功
- 通过代理访问外部站点是否成功

### 11.3 当前已验证通过的结果

已经真实验证通过：

- `SOCKS5` 端口监听成功
- 通过代理访问：
  - `https://www.google.com/generate_204`
  - `https://www.gstatic.com/generate_204`
- 返回码均为：
  - `204`

说明：
- 这代表当前代理链路、DNS、出站转发在现阶段已经可以正常工作

---

## 12. 当前已知限制

- `singbox-manager.js` 在当前某些沙箱环境下直接 `spawn` `sing-box.exe` 会遇到 `EPERM`
  - 这属于当前测试环境限制，不是最终 Windows 实机必然问题
- 节点组 `fallback` 还不是完整高级语义实现
- 手动节点表单仍比较基础
- 某些复杂协议私有参数还未完全补齐
- 目前更偏向“可用原型 + 持续修正”，不是最终成熟版控制面板

---

## 13. 后续继续开发时优先关注

建议继续优先核对：

- 官方 `sing-box` 最新 DNS 配置结构
- 各协议出站字段是否继续变化
- `route.rules` / `action` 的最新写法
- `selector` / `urltest` / `direct` / `block` 是否新增字段
- 节点组高级能力是否可继续完善
- 手动节点表单是否按协议细分

---

## 14. 本文件用途

本文件不是官方文档副本，而是当前项目阶段的工程背景记录。

它主要用于：

- 记录当前真正用到了哪些技术
- 记录实现过程中参考了哪些材料
- 记录项目与 `sing-box` 配置概念之间的映射关系
- 记录当前已经踩过和修掉的关键问题
- 方便后续继续开发时减少重复排查成本

---

## 15. SEA 打包信息

当前项目支持使用 Node.js SEA（Single Executable Applications）打包为 Windows 单文件可执行程序。

### 前置要求

- Node.js 24.x
- 在项目根目录执行打包命令

### 安装依赖

```powershell
npm install
```

### 构建命令

```powershell
npm run build:sea
```

### 输出位置

- `D:\sub2socks5\dist\sub2socks5-sea.exe`

### 当前 SEA 打包链路

当前流程涉及以下文件：

- `scripts/build-sea.mjs`
  - 负责收集静态资源、生成 SEA blob，并向 `node.exe` 注入 blob
- `scripts/sea-entry.cjs`
  - 作为 SEA 的 CommonJS bootstrap 入口
  - 通过动态 `import()` 启动真正的服务端逻辑
- `src/server.js`
  - 已改为可复用的 `startServer()` 启动形式
- `src/lib/storage.js`
  - 已兼容源码模式与 SEA 模式下的运行目录解析

### SEA 模式运行特征

- 可执行文件只内嵌：
  - Node.js 应用代码
  - `src/public` 下的静态资源
- `sing-box` 内核不会嵌入 exe
- 首次运行时如果缺少配置文件，会自动生成默认配置
- 可执行文件运行后会在同级目录创建或使用：
  - `data`
  - `runtime`
  - `bin`

### 已处理的问题

- 首次运行缺少配置文件时自动生成默认配置
- 修复 SEA 模式下误把新建的 `data/runtime/bin` 当作旧目录迁移的问题
- 使用 CJS bootstrap 兼容 Node SEA 的入口要求

### 当前注意事项

- 构建后可能出现 `signature seems corrupted` 提示
  - 这是将应用 blob 注入 `node.exe` 后的常见现象
  - 不代表构建失败
  - 如果用于正式分发，建议重新进行代码签名
- 构建阶段可能出现与 `import.meta` 相关的 warning
  - 当前版本通过入口隔离规避了运行时问题
  - 现阶段不影响生成可执行文件
