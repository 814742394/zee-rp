# Axure RP 9 兼容开发计划

日期：2026-10-21  
适用范围：`zee-rp` 的 CLI、MCP、离线 `.rp` 读写及 macOS GUI 验证

## 目标与完成定义

在保留现有 RP 11 行为的前提下，为 Axure RP 9 建立**按能力声明、按版本拦截、按原生应用验收**的兼容路径。兼容不等于把现有 RP 11 命令全部开放给 RP 9。

- **首期目标（RP9 Core）**：读取与检查 RP9 文件；改写已有元件的文本；从同版本 `.rplib` 克隆基础元件；基于 RP9 原生空白工程创建工程和页面；每项写入均产生新文件，并能在 RP9 中打开、保存、关闭、重开。涉及交互行为的命令还须通过预览验证。
- **后续目标（RP9 Extended）**：逐项验证并开放交互、动态面板、母版、中继器、表格、自适应视图等能力。每个命令按具体参数组合验收，不按命令名称整体推定兼容。
- **明确不计入首期**：RP 11 的 `axvg paste` 剪贴板落画路线；未经 RP9 原生样本确认的 `apply-style` 动作；RP 10 与 Windows GUI 兼容。

## 当前基线与证据边界

| 项目 | 当前证据 | 结论 |
| --- | --- | --- |
| RP9 读取 | 本地 `work/rp9-source.rp`：5 页、15 元件、1 全局变量、0 个结构问题 | 可作为 RP9 读取回归样本，尚不能代表所有 RP9 文件 |
| 常规离线写入 | `set-widget-text`、`clone-library-widget` 已写出；既有接入记录称克隆结果在 RP9 Enterprise 中打开并显示按钮 | 作为首期候选，需建立可重复的保存、重开验收 |
| `apply-style` | 既有接入记录称 RP9 报 `Unrecognized Type: Axure:InteractionApplyStyleInfo` 并拒绝打开 | RP9 默认拒绝生成该动作，除非有新的 RP9 原生证据 |
| `axvg paste` | 使用 RP11 剪贴板格式 | 不向 RP9 宣称可用；单独研究 RP9 剪贴板格式才可能开放 |
| 其余写入命令 | 主要验收环境为 macOS / RP 11.0.0.4137 | 均标为 RP9 未验证，不能沿用 RP11 的证据等级 |

这些样本文件是本机私有测试输入，不纳入 npm 包或公开仓库。公开自动化应使用由 RP9 用户自行提供的模板与元件库；需要原生验收的报告记录样本来源、Axure 构建号、操作步骤及结果。

## 实施阶段

### 阶段 0：建立 RP9 基线与能力清单

1. 记录 RP9 原生空白 `.rp`、默认 `.rplib`、一份含基础控件与交互的测试工程；保留原件，只在允许的输出目录生成副本。
2. 比较 RP9 与 RP11 的文件头、manifest、记录类型、元件/动作类名、GUID 引用和保存后的差异。版本识别须以文件结构或可验证的元数据为依据，不能仅靠文件名或安装路径。
3. 为现有命令建 RP9 能力矩阵：`可读`、`结构通过`、`原生打开`、`预览通过`、`GUI 编辑并重开`、`拒绝`、`未验证`；附构建号和样本。

**阶段验收**：读写样本可稳定复现；每个候选命令有明确状态；未知文件格式和未知版本不会被归类为 RP11。

### 阶段 1：版本识别与写入保护

1. 在 `scripts/rp-records.mjs` 与 `scripts/rp-read.mjs` 建立统一的版本识别结果，移除读取摘要中固定的 `Axure RP 11 .rp` 文案。先识别已验证的 RP9/RP11 变体；不能可靠判定时报告“未知”，并拒绝版本敏感写入。
2. 在 CLI 与 MCP 共同经过的调度路径执行能力检查。写入前检查目标 `.rp` 版本，以及导入 `.rplib`、空白模板与目标版本是否匹配；对多源命令同时检查所有来源。直接调用脚本的入口也必须执行相同检查，不能只在 MCP 层拦截。
3. 先将 RP9 的 `apply-style` 和 `axvg paste` 标为不可用。错误应指出文件版本、被拒绝的功能与原因，避免产出 RP9 无法打开的文件。
4. 保持既有 `AXURE_WRITE_ROOT`、`AXURE_PROTECTED_PATHS` 和不覆盖输出的约束；会话式连续编辑每一步都继承版本检查。

**阶段验收**：RP9 + 禁用动作、RP9 + RP11 模板/元件库、未知版本写入均在生成输出前明确失败；RP11 既有命令与安全测试通过。

### 阶段 2：RP9 Core 写入

按“一个能力、一份 RP9 原生样本、一组验收记录”推进：

1. 优先验证 `set-widget-text`、`clone-library-widget`、`create-blank-project`、`create-blank-page`。空白工程与新增页使用 **RP9 原生模板**；从 RP9 工程向 RP9 工程复制内容。
2. 整理 `scripts/blank-template.mjs`、`scripts/create-blank-page.mjs`、命令注册表中的 RP11 固定默认值与说明。模板未配置、模板版本不符或模板非单页空白时给出明确错误。
3. 对写出结果执行结构检查、源/目标差异检查和 RP9 原生打开、保存、关闭、重开；检查新增或修改的对象仍可在编辑器中选中和编辑。

**阶段验收**：Core 所列能力有可重复的 RP9 测试记录；输出保持 RP9 格式与预期内容；源文件字节不变；RP11 回归通过。

### 阶段 3：扩展写入与 GUI 验收

1. 按需求优先级逐类研究交互、面板、母版、中继器、表格和自适应视图。先用 RP9 GUI 保存最小正例，再比对其记录结构，最后实现写入。对 RP9 不认识的类名和动作做前置拒绝。
2. 将 `scripts/gui-roundtrip.swift` 中固定的 RP11 bundle ID、进程名和窗口标题改为受约束的版本配置；`scripts/jobs.mjs` 根据文件版本选用对应应用，并验证所启动的确是 RP9。禁止把 RP9 文件误交给 RP11 保存后再当作 RP9 验收。
3. 对交互类能力增加预览行为验证；结构检查与“能打开”只能证明文件可加载，不能证明交互正确。

**阶段验收**：每个开放的参数组合都达到其声明的证据等级；未验组合保持拒绝或标明未验证；失败样本不会污染原始文件。

### 阶段 4：接口、文档与发布

1. CLI/MCP 返回文件版本、命令在该版本的状态和验收等级；技能与 README 同步说明 RP9 支持矩阵，避免把 RP11 验收表当作 RP9 结论。
2. 将 RP9 检查分成无需原生软件的结构测试和需要 RP9 安装的原生验收；缺少模板、元件库或应用时报告缺失前提，不把跳过记作通过。
3. 发布前运行 `npm test`、RP11 原生回归、RP9 Core 原生验收、MCP 会话测试和 `npm pack --dry-run`；确认包中不含私有 `.rp`/`.rplib` 样本。

**发布门槛**：能力矩阵、用户文档和实际行为一致；RP9 Core 达到目标验收；RP11 无已知回归；所有未支持能力在调用前得到清晰拒绝。

## 主要代码落点

| 位置 | 计划改动 |
| --- | --- |
| `scripts/rp-records.mjs`、`scripts/rp-read.mjs` | 版本识别与正确的读取报告 |
| `scripts/engine.mjs`、`scripts/mcp-tools.mjs` | CLI/MCP 一致的版本能力检查与会话约束 |
| `scripts/ix-actions.mjs`、各写入脚本 | 版本专属动作和记录的前置检查；直接脚本调用也受保护 |
| `scripts/blank-template.mjs`、`scripts/create-blank-page.mjs` | 同版本模板选择、校验与文案 |
| `scripts/jobs.mjs`、`scripts/gui-roundtrip.swift` | 按版本启动和核验 Axure 应用 |
| `test/`、`docs/validation.md`、`references/capabilities.md` | 回归、验收流程和按版本的证据记录 |

## 关键风险与处理

- **文件可解析但类名不兼容**：用 RP9 原生正例建立动作/对象白名单，写入前拦截；`apply-style` 是已知反例。
- **跨版本模板或库带入 RP11 对象**：比较所有参与写入的文件版本；首期只接受同版本素材。
- **离线结构通过但 GUI 行为失败**：分别记录结构、加载、预览、GUI 保存重开结果，不合并为“已兼容”。
- **不同 RP9 构建或语言环境差异**：验收报告写明构建号与语言；仅对实际覆盖的构建和组合声明支持。

## 建议执行顺序

先完成阶段 0、1，以免继续产出 RP9 无法打开的文件；随后交付阶段 2 的 Core 能力。阶段 3 按真实使用需求逐项扩展，阶段 4 随每批能力同步更新，不等全部扩展能力完成才发布 Core。

## 实施状态（2026-10-21）

| 阶段 | 状态 | 落地物 | 未完成 / 阻塞 |
| --- | --- | --- | --- |
| 0 基线与能力清单 | 完成 | `docs/rp9-baseline.md`、`scripts/rp-fingerprint.mjs`（结构指纹，可复现） | 本机无 RP 11 样本，RP11 侧未做本地对比 |
| 1 版本识别与写入保护 | 完成 | `scripts/rp-version.mjs`、`scripts/version-guard.mjs`、`rp-read` 版本输出、`rp-records` 写原语二次拦截、会话编辑继承检查 | — |
| 2 RP9 Core 写入 | 完成（含原生打开 + 手工保存重开） | `blank-template.mjs`（按版本解析 + `derive`）、`create-blank-project`、`create-blank-page`、`set-widget-text`、`clone-library-widget`；`test/rp9-core-check.mjs` 12/12 | `create-blank-page` 产物还缺一次原生打开记录 |
| 3 扩展写入与 GUI 验收 | 部分（手工往返已通过） | `gui-roundtrip.swift` 按版本参数化、`jobs.mjs` 版本核验与 `editionPreserved`、`test/rp9-native-check.mjs`；2026-10-21 用户在 RP 9 中手工完成「打开 → 保存 → 关闭 → 重开」，内容不变、版本未升 | 脚本化往返缺「辅助功能/自动化」权限（`-10004`）；交互/面板/母版/中继器/表格/自适应视图仍为 `unverified` |
| 4 接口、文档与发布 | 完成 | CLI/MCP 返回 `edition` 与命令状态；`references/capabilities.md`、`docs/validation.md`、`docs/rp9-acceptance-runbook.md`、双语 README、`SKILL.md`、`CHANGELOG`、`registry.mjs`、`baseline-shas.json` | 只有脚本化原生往返待授权（手工往返已通过） |

原生验收补跑方法（授予权限后一条命令）：

```bash
AXURE_RP9_NATIVE_SOURCE=<rp9 交付文件> npm run test:rp9-native
```

### 2026-10-21 复验发现并修复的缺陷

`blank-template.mjs derive` 只重算了 manifest 的子节点部件（`package` / `thumbnail`），漏掉根节点自带的 `DesignDocument` 与 `<版本>.version` 部件，导致派生模板里这两个引用仍指向原工程的大偏移、越过文件尾部。后果：

- 从派生模板新建的工程无法再被 `create-blank-page` 写入（`replaceRecord` 找不到唯一引用，报 `Expected one manifest reference, found 0`）；`test/jobs-check.mjs` 的符号链接用例也因此失败。
- RP9 侧会用这个偏移读版本流，拿到空内容时报 `Root element is missing`（`RpFileStorage.CanLoadVersion`），即可能拒绝打开整个文件。

修复：`remap()` 递归重算所有节点部件；派生末尾新增两条自检——所有部件必须落在文件内、每条记录必须恰有一个 manifest 引用。`test/rp9-core-check.mjs` 增加「从 RP9 模板新建的工程可以继续加页（manifest 引用自洽）」用例，用旧模板跑该用例会稳定失败，可防回归。

**但这条修复还不够：用户在 RP9 中打开派生文件仍报「载入文件出错 / This file may be corrupted」。** 于是改用二分法（以用户实际打开结果为准）定位到 DesignDocument 重写：

| 变体 | 改动 | RP9 结果 |
| --- | --- | --- |
| 源副本 | 无 | 打开正常 |
| 只重写 DesignDocument（5 页记录保留） | sitemap / PackageInfos / tree 各改一处 | 报错 |
| 完整派生 | 重写 + 裁剪记录 | 报错 |
| 只裁剪不改写 | 删 4 页记录 | 打开正常（页面空白） |
| 单改 tree.children 5→1 | — | 打开正常 |
| 单改 node-table 5→1 | — | 报错 |
| 单改 PackageInfos 9→1 | — | 报错 |

由此得到 RP9 的两条硬约束（`RP9 Tour.rp`、源工程等健康文件互相印证；`RP9 Tour.rp` 是 Axure 安装包自带的教学工程，路径 `/Applications/Axure RP 9.app/Contents/Resources/DefaultSettings/Training/RP9 Tour.rp`，可随时复现）：

1. **DesignDocument 对象池里每个对象都必须被引用**（健康文件可达集 == 全集：源 47/47、RP9 Tour 70/70）。只删列表项留着对象 → 孤儿对象 → 判定损坏。
2. **`PackageInfos` 必须覆盖 manifest 的每个叶子包**，包括 HTML/Word/CSV/Print 四类生成器配置。RP9 按叶子包查 PackageInfo，缺一个即损坏。manifest 的子节点是嵌套树（`RP9 Tour.rp`：8 个节点 / 6 个叶子 / 6 个 PackageInfo），只有叶子对应 PackageInfo。

最终修法：`PackageInfos` 只删「页面类」条目、保留配置类；`node-table` / `tree.children` 只留目标页；随后按可达性修剪对象池（对象 id 显式存储，删除无需重编号）。`derive` 自检扩到 4 条（结构三零 / 部件在文件内且每条记录恰 1 个引用 / DD 池无孤儿 / manifest 叶子数 == PackageInfos 项数），`test/rp9-core-check.mjs` 增加「RP9 空白模板的 DesignDocument 自洽」用例——用旧模板跑会同时命中两条缺陷。

**原生结果**：`work/rp9-blank-template.rp`（39 294 B）与 `work/rp9-acceptance-demo.rp`（40 381 B，1 页 + 按钮 + 文字）在 Axure RP 9 中打开正常（2026-10-21 用户实测）；保存 → 关闭 → 重开也已由用户手工通过（结果见下节）。脚本化往返仍需系统授权，见 `docs/rp9-acceptance-runbook.md` 第 3B 层。


### 2026-10-21 原生往返结果（用户手工）

用户在 Axure RP 9 中对 `work/rp9-acceptance-demo.rp` 完成「打开 → 保存 → 关闭 → 重开」：页面、按钮、文字全部保留，版本仍是 9.0.0.0（`SavedEdition=2`）。保存后文件 41 908 B，记录从 7 条变 8 条——RP9 自动补了一条 `Axure:DocumentSettings` 记录与同名根部件（与 `RP9 Tour.rp` 同构）。这说明：

- 派生文件缺少 `DocumentSettings` 不影响打开，RP9 会在保存时自行补齐，**不要**把「记录数变化」误判为损坏；
- 保存后 DesignDocument 仍满足本仓库的两条不变量（`PackageInfos` 5 项 == manifest 叶子 5 个，池中孤儿 0），可作为「RP9 自己写出来的健康文件」参照样本。
