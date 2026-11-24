# 接入 AI Agent

zee-rp 提供一个本地 MCP 服务和一个 CLI。MCP 客户端通过 stdio 启动 `zee-rp-mcp`。CLI 可用于脚本和没有 MCP 支持的 Agent。Studio 提供可选的浏览器画布。

## 安装与配置

按[安装说明](../../README.md#quickstart)准备 Node.js、Python 和依赖。在要用的 Axure 版本里新建单页空白工程并另存。生成含原生输入等元件的原型还会用到相应版本的 Axure 元件库。

将 [MCP 配置示例](mcp.example.json) 填入客户端。替换安装路径、Python 路径和已有的模板路径，并创建输出目录。只用一个 Axure 版本时，可省略另一版本的模板变量。安装 npm 包的用户也可将 `command` 设置为已安装的 `zee-rp-mcp`，省略脚本参数。

- 采用 `mcpServers` JSON 的客户端可使用示例里的 `zee-rp` 条目。
- DeepSeek Harness 使用 [Cordis 配置](deepseek-harness.md)。
- Windows 上可使用 `C:/work/zee-rp/bin/mcp.mjs` 和 `C:/work/zee-rp/.venv/Scripts/python.exe`。客户端找不到 Node 时，给 `command` 填 Node 可执行文件的绝对路径。

## 第一次调用

1. 调用 `runtime_info({})`。查看 `python` 和 `host.targets`，确认目标版本的 `template.status` 为 `ready`，需要用到原生输入时也检查 `defaultLibraryAvailable`。`host.capabilities` 提供文件写入范围和 GUI 入口信息。
2. 用 [双版本示例](../../examples/rp-language/dual-target-basic.json) 调用 `generate_prototype`。参数包含源码的绝对路径、`targetVersion: 9` 或 `11`，以及新输出路径。分别生成两个版本时，为每次调用指定不同的 `.rp` 文件名。
3. 用 `rp_read` 读回工程。可以用 `axure_open`、`edit_text`、`axure_save` 修改现有文件并另存，也可以用 `revise_prototype` 按 RP/1 逻辑 ID 改稿。

```json
{
  "source": "/absolute/path/zee-rp/examples/rp-language/dual-target-basic.json",
  "targetVersion": 11,
  "output": "dual-target-rp11.rp"
}
```

RP11 文件生成目前覆盖基础元件、输入和交互。动态面板、母版、中继器、自适应视图等能力见[双版本架构](../dual-target-architecture.md)。需要在画布中与人共同修改时，调用 `studio_open_project`，打开返回的浏览器地址。

## 安装技能

技能提供 Agent 操作说明，可配合 MCP 或 CLI 使用。运行下面的命令，将仓库的技能和配套文件同步到客户端的技能目录。若目标已存在，`--replace` 会把旧版备份到技能扫描目录之外，并打印备份位置。

```sh
node tools/install-agent-skill.mjs /absolute/path/to/client/skills/zee-rp --replace
```

从仓库维护 [SKILL.md](../../SKILL.md) 及引用资料。更新代码后重新运行同步命令，再按客户端的方式重新加载技能和 MCP。

## 验证接入

- `npm run test:mcp-connect` 通过 stdio 验证握手、工具发现、能力查询和模板诊断，无需 Axure。
- `npm run test:mcp-targets` 使用本机 RP9/RP11 空白模板和元件库，验证双版本生成、读回、改字另存和原件保留。
- 发布时记录提交 SHA、客户端版本、操作系统和 Axure 构建号。协议和文件结构测试可自动复跑，Axure 打开、保存、重开与预览按[原生验收流程](../dual-target-architecture.md#验证与交付要求)逐项记录。
