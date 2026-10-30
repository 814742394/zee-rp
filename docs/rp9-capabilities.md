# Axure RP 9 能力矩阵

更新：2026-10-21  
适用范围：zee-rp 的 CLI、MCP 与直接脚本调用。级别只描述**本机实际验收过的东西**，不按命令名整体推定。

## 证据等级

| 等级 | 含义 |
| --- | --- |
| `rp9-core` | 首期交付：有可重复的 RP9 样本记录，结构与源/目标差异全部通过 |
| `unverified` | 脚本能跑，但没有任何 RP9 验收记录；调用时返回提示，禁止对外宣称可用 |
| `blocked` | 在 RP9 上生成输出前直接拒绝（会让 RP9 拒绝打开文件或行为不成立） |
| `structure` | 只证明「解析通过、结构三零、源文件未变」 |
| `diff` | `structure` + 目标计数/文本按预期变化、问题数不比源文件多 |
| `native-open` | 另有 Axure RP 9 实际打开该文件的记录 |
| `gui-roundtrip` | 另有 RP9 GUI 保存 → 关闭 → 重开记录 |

## 命令矩阵

| 命令 | RP9 状态 | 已有证据 | 说明 |
| --- | --- | --- | --- |
| `rp-read` | `rp9-core` | structure（样本 A/B/C，0 条不可解析记录） | 只读；版本按容器头 `acef0900`/`acef0b00` 识别，返回 `version: 9`/`11` |
| `set-widget-text` | `rp9-core` | structure + diff + native-open + gui-roundtrip（2026-10-21 用户打开→保存→关闭→重开，改写后的文字保留） | 只改目标文本；输出仍是 RP9；问题数不增加 |
| `clone-library-widget` | `rp9-core` | structure + diff + native-open + gui-roundtrip（RP9 Enterprise 中确认按钮渲染，并在保存重开后仍保留几何与文字） | 素材与目标必须同版本 |
| `create-blank-project` | `rp9-core` | structure + diff + native-open + gui-roundtrip（产物即模板副本；模板已在 RP9 打开保存重开） | 需要 RP9 单页空白模板；版本不符即拒绝 |
| `create-blank-page` | `rp9-core` | structure + diff | 同上；新页 GUID 全部重排 |
| `blank-template derive` | `rp9-core` | structure + diff + native-open + gui-roundtrip（派生模板与派生样本均能打开；样本保存重开正常） | 派生受 RP9 两条硬约束：DD 池无孤儿对象、PackageInfos 覆盖所有叶子包 |
| `axvg build` / `axvg selftest` | `rp9-core` | 与版本无关的确定性编码自检 | 不写 `.rp` |
| `duplicate-page` | `unverified` | — | 可用，但没有任何 RP9 原生验收；调用时返回提示 |
| `create-global-variable` | `unverified` | — | 同上 |
| `add-interaction` / `remove-interaction` / `add-click-link` | `unverified` | — | 动作类型 `apply-style` 在 RP9 上被单独拒绝，其余动作未验证 |
| `set-widget-richtext` | `unverified` | — | 字阶/配色写法沿用 RP11 结构，未在 RP9 验证 |
| `set-native-table` | `unverified` | — | 表格记录结构未比对 |
| `create-panel-clone` / `fill-panel-state` / `remove-panel-state-content` / `set-panel-fit-to-content` | `unverified` | — | 动态面板类 |
| `create-master` / `place-master` / `set-master-overrides` | `unverified` | — | 母版类；样本 A/B/C 都没有母版，缺正例 |
| `clone-library-page-content` / `clone-native-connector` / `set-connector-anchors` | `unverified` | — | 闭包克隆与连接线 |
| `add-adaptive-view` | `unverified` | — | 自适应视图 |
| `set-combobox-options` / `set-listbox-options` / `name-widget` | `unverified` | — | 表单与命名 |
| `patch-link-window` / `patch-string` | `unverified` | — | 字节级研究工具 |
| `axvg paste` | `blocked`（默认） | 2026-10-20 本机实测：RP9 画布粘贴后无内容 | 目标版本取 `AXURE_TARGET_VERSION` > 运行中进程 > 已安装应用；`AXURE_ALLOW_RP9_PASTE=1` 可放行为 `unverified` 强试 |
| `add-interaction --action apply-style` | `blocked` | 用户实测：RP9 报 `Unrecognized Type: Axure:InteractionApplyStyleInfo` 并拒绝打开文件 | 两道拦截：`version-guard` 命令级（写出前）+ `ix-actions` 类型级 |

`unverified` 不等于「不可用」，也不等于「兼容」：命令会执行，并在 CLI stderr / MCP 返回值里带上 `「命令」在 Axure RP 9 上未经验证` 的提示。需要把某个命令升级为 `core`，按 `docs/rp9-baseline.md` 第 6 节跑一遍：一个 RP9 原生样本 + 一份验收记录（structure → diff → native-open → gui-roundtrip）。

## 拦截规则

1. **版本判定失败即拒绝**：读不出 `rp9`/`rp11` 时，凡带输出的命令不执行；`rp-read` 仍可跑（只读）。
2. **跨版本组合直接拒绝**：一次调用里出现 RP9 与 RP11 项目、或「RP9 工程 + 非 RP9 元件库/模板」。
3. **素材同版本**：`clone-library-*`、`create-blank-*` 要求 `.rplib` / 模板与目标工程同版本；素材版本无法判定时，RP9 侧拒绝。
4. **动作级拒绝**：`apply-style` 在 RP9 工程的 `--action` 与 `--json` spec 两处都会被识别。
5. **绕过 CLI/MCP 也拦得住**：`scripts/rp-records.mjs` 在写原语层对记录字节做一次廉价搜索（只在命中 `InteractionApplyStyle` 时才去判版本），因此 `node scripts/add-interaction.mjs ...` 这类直接调用同样被拒绝。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `AXURE_BLANK_TEMPLATE_RP9` / `_RP11` | 版本专属空白模板；优先于 `AXURE_BLANK_TEMPLATE` |
| `AXURE_BLANK_TEMPLATE` | 兼容旧配置；必须与目标版本一致，否则拒绝 |
| `AXURE_TARGET_VERSION` | `9` / `11` 显式声明目标版本；用于 `axvg paste`、版本读不出时的逃生阀（会被标记为「声明」而非文件证据） |
| `AXURE_ALLOW_RP9_PASTE` | `1` 时把 RP9 的 `axvg paste` 从 `blocked` 降为 `unverified` 放行，供强试通道 |
| `AXURE_RP9_SAMPLE` / `AXURE_RP9_LIBRARY` / `AXURE_RP9_BLANK_PAGE` | `npm run test:rp9` 的外部输入 |
| `AXURE_RP9_NATIVE_SOURCE` | `npm run test:rp9-native` 的外部输入（建议用 `test:rp9` 产出的交付文件） |

## 已知盲区

- 不同 RP9 构建号、不同界面语言（菜单名）未覆盖：GUI 助手按 `文件/File`、`保存/Save`、`关闭/Close` 两套菜单名尝试。
- 本机已同时安装 RP 9 与 RP 11（2026-10-30）；本文件的证据仍只来自 RP 9 样本，RP 11 侧沿用上游 0.2.1 的记录。
- `axvg paste` 在 RP 9 上的「粘贴后无内容」结论来自 2026-10-20 单次实测；上游 0.2.1 改为按 `--version 9` 正常放行，两方结论冲突，未复测。默认保守拒绝，`AXURE_ALLOW_RP9_PASTE=1` 可强试。
