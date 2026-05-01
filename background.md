# sing-box Background

本文件用于保存当前项目实现所依赖的 `sing-box` 文档背景信息、配置概念与本项目中的映射关系，便于后续继续开发时快速对照。

## 参考来源

当前项目的实现目标基于以下官方来源：
- `https://sing-box.sagernet.org/zh/configuration/`
- `https://github.com/SagerNet/sing-box`

说明：
- 本文件保存的是为了工程实现整理出的背景知识摘要，不是官方文档的完整拷贝。
- 后续若继续扩展协议字段，应优先再次对照官方文档与源码行为。

## sing-box 的核心配置结构

当前项目主要围绕以下顶层配置块生成 `sing-box` 配置：
- `log`
- `dns`
- `inbounds`
- `outbounds`
- `route`
- `experimental`

这些配置块在本项目中的作用分别为：
- `log`：控制日志级别与输出时间戳
- `dns`：控制解析服务器、规则、最终解析器和缓存行为
- `inbounds`：定义本地监听入口，本项目使用 `socks` 入站
- `outbounds`：定义节点、逻辑节点组、直连和拦截出口
- `route`：根据入站、规则或目标把流量发往指定出站
- `experimental`：启用额外能力，例如缓存文件和兼容 API

## 本项目当前使用的入站模型

本项目当前为每个用户定义的端口生成一个 `socks` 入站。

### 目标

让用户可以在不同本地端口使用不同节点或节点组，例如：
- `127.0.0.1:1080` → `proxy`
- `127.0.0.1:1081` → `auto`
- `127.0.0.1:1082` → `某个具体节点`

### 当前实现方式

每个端口配置项会生成：
- 一个 `type: socks` 的入站
- 一条基于 `inbound` 匹配的路由规则

这样做的意义是：
- 入口端口和出口节点的绑定关系由配置控制
- 用户无需每次手动切换全局节点
- 可以同时提供多个用途不同的本地代理入口

## 本项目当前使用的出站模型

本项目当前生成的出站包括：
- `direct`
- `block`
- 订阅解析出的具体节点出站
- `proxy` 逻辑组
- `auto` 逻辑组

### `direct`

用于直连目标。

### `block`

用于拦截目标。

### 具体节点出站

由订阅中的单个节点转换而来。当前已处理的协议有：
- `vmess`
- `vless`
- `trojan`
- `shadowsocks`
- `hysteria2`
- `tuic`

### `proxy`

当前使用 `selector` 类型，表示手动选择节点的逻辑组。

### `auto`

当前使用 `urltest` 类型，表示自动测试延迟后选取较优节点的逻辑组。

## 本项目当前使用的 DNS 思路

为了尽量减少 DNS 泄漏风险，当前默认思路如下：
- 使用远程 DNS 作为默认解析器
- 远程 DNS 优先走代理 `detour`
- 保留直连 DNS 供显式直连规则使用
- 对入站启用流量嗅探，尽量让目标域名交给代理内核处理

### 当前默认 DNS 结构

项目默认包含三个逻辑 DNS 服务器：
- `dns-remote`
- `dns-direct`
- `dns-block`

#### `dns-remote`

特点：
- 使用远程安全 DNS
- 默认配置为 `tls://1.1.1.1`
- 配置 `detour: proxy`

作用：
- 尽量使解析流量通过代理出口发送
- 降低本机或本地网络直接发起 DNS 查询的概率

#### `dns-direct`

特点：
- 当前默认配置为 `https://1.1.1.1/dns-query`
- 配置 `detour: direct`

作用：
- 在明确直连策略下提供解析能力

#### `dns-block`

特点：
- 使用 `rcode://success`

作用：
- 用于需要直接阻断解析请求的场景

### 当前默认 DNS 规则

当前默认规则偏向：
- 普通流量优先使用远程 DNS
- 显式 Direct 模式下允许使用直连 DNS

说明：
- 后续如果加入更细粒度规则集，可以继续细分域名分类与不同 DNS 解析路径。

## 路由模型背景

本项目当前路由重点不是做完整分流面板，而是先实现“每个端口固定到一个出口”的模型。

### 当前路由规则来源

路由规则主要来自两部分：
- 用户自定义的 `routing.rules`
- 由 `ports[]` 自动生成的“入站到目标出口”的规则

### 当前 `route.final`

默认使用 `proxy`，表示未命中更具体规则时，默认走代理逻辑组。

### 当前 `auto_detect_interface`

默认开启，用于帮助 `sing-box` 更好地识别网络接口环境。

## 订阅解析背景

本项目当前的订阅解析器采用“通用文本订阅 + 常见链接协议”的思路。

### 当前处理方式

1. 拉取订阅文本
2. 尝试判断是否为整体 base64 编码
3. 如果是则解码
4. 按行拆分节点链接
5. 根据协议头分别解析

### 已处理协议

#### `vmess`
- 订阅内容一般为 `vmess://` + base64 JSON
- 当前提取服务器地址、端口、UUID、TLS、传输层等基础信息

#### `vless`
- 使用标准 URL 形式
- 当前提取 UUID、服务器、端口、TLS、Reality 与部分 transport 参数

#### `trojan`
- 使用标准 URL 形式
- 当前提取密码、服务器、端口、TLS 信息

#### `ss`
- 当前支持常见 `ss://method:password@host:port` 和部分 base64 变体

#### `hysteria2`
- 当前提取密码、服务器、端口、TLS 及带宽参数

#### `tuic`
- 当前提取 UUID、密码、服务器、端口、TLS 和拥塞控制参数

### 当前限制

- 机场订阅常常带有私有扩展字段
- 不同客户端对 URI 参数容忍度不同
- 后续仍需按官方配置文档继续补齐字段映射

## 本项目与 sing-box 配置概念的映射

### 应用层配置

`data\app-config.json` 是本项目自己的业务配置，不是直接交给 `sing-box` 的最终配置。

其职责是保存：
- Web UI 的用户配置
- 订阅地址
- 多端口定义
- DNS 与路由偏好
- 本地 `sing-box` 可执行文件路径

### 运行层配置

`runtime\sing-box.json` 才是最终交给 `sing-box` 内核运行的配置文件。

转换过程为：
- 用户编辑 `app-config.json`
- 程序拉取并解析订阅
- 程序根据用户定义拼装 `sing-box` 配置
- 输出到 `runtime\sing-box.json`

## 内核下载背景

本项目支持通过 GitHub Releases 自动拉取内核。

### 当前识别字段

程序当前依赖：
- `process.platform`
- `process.arch`

并映射到 release 资产命名后缀，例如：
- `windows-amd64`
- `windows-arm64`
- `linux-amd64`
- `linux-arm64`
- `darwin-amd64`
- `darwin-arm64`

### 当前下载流程

1. 请求 `SagerNet/sing-box` 的最新 release 信息
2. 按平台后缀匹配压缩包
3. 下载到临时目录
4. 解压压缩包
5. 提取 `sing-box` 可执行文件
6. 放入 `bin` 目录
7. 更新本项目配置里的 `app.singBoxBinary`

## 后续开发时应重点核对的官方文档点

后续继续开发时，建议优先重新核对这些内容：
- 各协议出站字段是否与最新官方配置完全一致
- `transport` 字段命名是否有版本变化
- `tls` 与 `reality` 的最新结构
- `dns.rules` 的字段名与匹配能力
- `route.rules`、`rule_set`、`final`、`action` 的最新写法
- `selector`、`urltest`、`direct`、`block` 等出站结构是否有新增选项
- `experimental` 中 `cache_file`、兼容 API 的字段是否有变化

## 本文件的用途

本文件是后续实现时的工程背景笔记，主要用于：
- 帮助快速理解当前项目为什么这样组织
- 记录当前实现与 `sing-box` 概念的映射关系
- 提醒后续继续开发时哪些点必须重新对照官方文档

如果后续扩展了：
- 更多协议
- 更多 DNS 策略
- 更多规则集
- 更复杂的节点组
- 更完整的配置编辑器

应同步更新本文件，确保背景信息与代码实现保持一致。
