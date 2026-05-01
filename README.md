# sub2socks5

一个在当前目录下运行的 `sing-box` 配置管理器：
- 从机场订阅拉取节点
- 生成符合 `sing-box` 配置结构的 JSON
- 用本地 `sing-box` 内核启动多个 socks5 入口端口
- 通过 Web UI 编辑配置与查看运行状态
- 通过 Web UI 自动识别系统架构并下载对应 `sing-box` release
- 默认采用远程 DNS 出站与代理 detour，尽量降低 DNS 泄漏风险

## 当前实现

- 运行环境：Node.js 24+
- 启动命令：`node src/server.js`
- Web UI：`http://127.0.0.1:18080`
- 默认 `sing-box` 二进制路径：`D:\sub2socks5\bin\sing-box.exe`

## 当前架构

当前项目采用“单进程管理器 + 本地 sing-box 内核 + 静态 Web UI”的结构。

### 模块划分

- `D:\sub2socks5\src\server.js`
  - HTTP 服务入口
  - 提供 Web UI 静态文件
  - 提供配置、订阅、内核、运行时相关 API
- `D:\sub2socks5\src\lib\storage.js`
  - 管理默认配置
  - 管理 `data`、`runtime`、`bin` 目录
  - 读写应用配置与生成后的 `sing-box` 配置
- `D:\sub2socks5\src\lib\subscription.js`
  - 拉取机场订阅
  - 尝试 base64 解码订阅文本
  - 解析 `vmess`、`vless`、`trojan`、`ss`、`hysteria2`、`tuic` 节点
- `D:\sub2socks5\src\lib\singbox-config.js`
  - 将应用配置和订阅节点转换为 `sing-box` JSON 配置
  - 生成 `inbounds`、`outbounds`、`dns`、`route`、`experimental`
- `D:\sub2socks5\src\lib\singbox-manager.js`
  - 启动和停止本地 `sing-box` 进程
  - 缓存运行日志与状态
- `D:\sub2socks5\src\lib\singbox-release.js`
  - 检测当前系统架构
  - 查询 `SagerNet/sing-box` GitHub Releases 最新版本
  - 下载、解压并安装对应平台二进制到 `bin`
- `D:\sub2socks5\src\public\index.html`
  - Web UI 页面结构
- `D:\sub2socks5\src\public\app.js`
  - 前端交互逻辑
  - 调用后端 API 完成保存配置、刷新订阅、下载内核、启动服务等动作
- `D:\sub2socks5\src\public\style.css`
  - Web UI 样式

### 目录职责

- `D:\sub2socks5\data`
  - 持久化应用主配置 `app-config.json`
- `D:\sub2socks5\runtime`
  - 保存生成的 `sing-box.json`
- `D:\sub2socks5\bin`
  - 保存自动下载或手动放入的 `sing-box` 内核
  - 保存 `sing-box-version.json` 记录已安装 release 信息

### 运行时关系

1. 用户在 Web UI 修改配置。
2. 前端将配置提交到后端 API。
3. 后端把配置保存到 `data\app-config.json`。
4. 用户刷新订阅后，后端拉取订阅并解析出节点列表。
5. 用户生成配置后，后端把当前配置和节点列表组合成 `runtime\sing-box.json`。
6. 用户启动内核后，后端调用本地 `bin\sing-box.exe` 执行 `run -c runtime\sing-box.json`。
7. `sing-box` 根据入站端口和路由规则对外提供多个 socks5 代理入口。

## 工作流程

### 首次使用流程

1. 启动服务：`node src/server.js`
2. 打开 Web UI：`http://127.0.0.1:18080`
3. 点击 `检查内核版本` 查看当前架构和远端最新版本
4. 点击 `拉取 sing-box 内核` 自动下载适配当前系统的内核
5. 在配置编辑区填入订阅地址 `subscription.url`
6. 点击 `保存配置`
7. 点击 `刷新订阅`
8. 检查节点列表是否成功解析
9. 按需修改 `ports[]`，为不同端口指定不同 `target`
10. 点击 `生成 sing-box 配置`
11. 点击 `启动 sing-box`

### 日常使用流程

1. 修改订阅地址、端口映射、DNS 或路由规则
2. 保存配置
3. 刷新订阅
4. 重新生成配置
5. 重启 `sing-box` 使新配置生效

### 多端口 socks5 工作方式

当前通过 `ports[]` 定义多个本地 socks5 入站，例如：
- 端口 `1080` → `target: proxy`
- 端口 `1081` → `target: auto`
- 端口 `1082` → `target: 某个具体节点 tag`

生成配置时：
- 每个 `ports[]` 条目都会生成一个 `socks` 入站
- 每个入站都会追加一条 `route.rules`，将该入站流量发往对应 `target`
- `target` 可以是：
  - `proxy`：手动选择器节点组
  - `auto`：自动测速节点组
  - 某个具体节点 tag：固定走单节点
  - `direct`：直连
  - `block`：拦截

## 内核自动拉取

Web UI 新增两个操作：
- `检查内核版本`：读取本地已安装状态，并查询 GitHub Releases 最新版本
- `拉取 sing-box 内核`：自动检测当前系统与架构，从 `SagerNet/sing-box` 的 Releases 下载对应压缩包并解压到 `D:\sub2socks5\bin`

当前支持的架构映射：
- Windows `x64` → `windows-amd64`
- Windows `arm64` → `windows-arm64`
- Linux `x64` → `linux-amd64`
- Linux `arm64` → `linux-arm64`
- macOS `x64` → `darwin-amd64`
- macOS `arm64` → `darwin-arm64`

内核下载流程：
1. 后端读取 `process.platform` 和 `process.arch`
2. 映射为 sing-box release 资产命名规则
3. 请求 GitHub Releases latest API
4. 匹配当前平台对应压缩包
5. 下载到临时目录
6. 自动解压并提取 `sing-box` 可执行文件
7. 移动到 `D:\sub2socks5\bin`
8. 将 `app.app.singBoxBinary` 自动更新为下载后的路径

## 配置说明

主配置文件会保存到：`D:\sub2socks5\data\app-config.json`

重点字段：
- `subscription.url`：机场订阅地址
- `ports[]`：每个 socks5 监听口，以及绑定到哪个出站，如 `proxy`、`auto`、某个具体节点 tag
- `dns`：优先使用远程 DoT/DoH，并通过代理 detour 解析
- `routing.ruleSetUrls`：可继续补充官方支持的远程规则集

## 生成配置的大致结构

当前生成的 `sing-box` 配置包含：
- `log`
- `dns`
- `inbounds`
- `outbounds`
- `route`
- `experimental`

其中：
- `outbounds` 默认包含 `direct`、`block`
- 订阅节点会被转换为对应协议出站
- 额外生成两个逻辑组：
  - `proxy`：`selector`
  - `auto`：`urltest`
- `inbounds` 来自 `ports[]`
- `route.rules` 会将每个入站绑定到对应目标出站

## 注意事项

- 目前实现了常见订阅协议解析：`vmess`、`vless`、`trojan`、`ss`、`hysteria2`、`tuic`
- 订阅格式差异很大，不同机场私有字段可能需要继续兼容
- 该工具会生成 `D:\sub2socks5\runtime\sing-box.json`，你可以在 UI 中查看
- 自动下载依赖 GitHub Releases 可访问；若网络受限，下载会失败
- 当前是可运行原型，尚未覆盖 sing-box 全部协议细节与全部订阅变体

## DNS 防泄漏策略

默认生成配置时：
- `dns.final` 指向远程 DNS
- 远程 DNS 使用 `detour: proxy`
- 入站启用 `sniff` 与 `sniff_override_destination`
- 保留 `direct` DNS 仅供显式直连模式使用

## 后续可继续增强的方向

- 增加“指定 sing-box 版本下载”而不仅是 latest
- 增加下载进度展示与失败重试
- 增加节点组图形化编辑器，而不是直接编辑 JSON
- 增加定时订阅刷新与自动热重载
- 更完整对齐 sing-box 官方最新配置字段与传输层参数
