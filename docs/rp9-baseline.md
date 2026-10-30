# Axure RP 9 基线报告（阶段 0）

日期：2026-10-21  
Axure 构建：RP 9.0.0.3740（macOS，`/Applications/Axure RP 9.app`，bundle `com.axure.AxureRP9`）  
机器：macOS 14（darwin），Node 22.22.2

本报告只记录**结构与类名统计**，不含任何文档正文、图片或原生文件。样本是私有测试输入，不随代码包分发；文中用别名 + SHA-256 前缀标识，实际文件名保存在本机测试笔记里（见 `docs/validation.md` 的环境变量说明）。

## 1. 样本清单

| 别名 | 用途 | 字节 | SHA-256 前缀 | 规模 |
| --- | --- | --- | --- | --- |
| 样本 A（自制 5 页流程工程） | 首期读写回归；无面板、无母版，最小可控 | 58 510 | `9f8a0dd01b9aefd8` | 5 页 / 15 元件 / 0 面板状态 / 0 母版 |
| 样本 B（移动端原型） | 真实工程：面板状态密集、重名大量存在 | 5 024 771 | `0408f0ae8125eaef` | 26 页 / 713 元件 / 40 动态面板 / 613 面板状态 |
| 样本 C（MES 原型） | 大文件压力：85 MB、万级记录 | 85 383 412 | `96ccda01a124e019` | 77 页 / 4 761 元件 / 220 动态面板 / 11 595 面板状态 |
| 默认元件库 `Default.rplib` | 库读取 + 单控件克隆源 | 476 987 | `fb8c57c37cb6ad21` | 39 库页 / 74 元件 |
| 派生空白工程（样本 A 的空白页派生） | `create-blank-project` / `create-blank-page` 的 RP9 模板 | 39 350 | `aa98b9e8789fc0e7` | 1 页 / 0 元件 |

RP11 侧没有本机样本可用（本机只安装 RP 9），因此本报告**不对 RP11 做任何本地实测结论**；RP11 的行为仍以既有 11.0.0.4137 验收记录为准，见 `docs/historical-capabilities.md`。

## 2. 容器格式

| 项目 | RP9 实测 | RP11（既有记录） | 结论 |
| --- | --- | --- | --- |
| 魔数 | `AC EF` | `AC EF` | 相同 |
| 外层头 | 8 字节，`+4` 处 u32LE 为 manifest 编码块长度 | 同 | 相同 |
| manifest 编码 | `[01][varuint 原始长度][varuint 压缩长度][LZ4 block]`（未压缩块不支持） | 同 | 相同 |
| 记录流 | `[4B 长度][gzip 记录]`，另有缩略图等非 gzip 段穿插 | 同 | 相同；段流必须按 manifest parts 定位，不能假定记录连续 |
| 记录头 | 32 字节 + 字符串表（`u32` 数量 + `[u32 长度][utf8]`），`+20` 处为 `0xC351` | 同 | 相同；`parse-record` 无需改动 |
| `.rplib` | 同样是 `AC EF` 容器（带 manifest） | 同 | `readRecords` 的「裸流」分支在 RP9 库上未触发 |

**结论**：容器层没有版本差异，RP9 与 RP11 的区别全在 payload 里的类名、动作类型和默认样式。这也是为什么「结构检查通过」不能当作「RP9 能打开」——文件能被本工具解开，但不认识的类名会让 Axure 自己拒绝加载。

## 3. 版本标识（识别依据）

| 证据 | 位置 | RP9 实测值 | 可信度 |
| --- | --- | --- | --- |
| `xml:BreakingChanges` → `<Version>` | 独立 XML 记录，工程与 `.rplib` 都有 | `9.0.0.0`（样本 A/B/C + 默认库一致） | 高：Axure 自己写的「本文件由哪个大版本创建」 |
| `Axure:DesignDocument.SavedEdition` | DesignDocument 根对象 | 工程 = 2；`Default.rplib` = 2；`Icons.rplib` = 0 | 中：库与工程的取值不统一，只能作佐证 |
| `document-type` | DesignDocument 根对象 | 1 | 低：未确认 RP11 取值 |

识别规则（`scripts/rp-version.mjs`）：

1. `BreakingChanges` 主版本为 9 → `rp9`；为 11 → `rp11`；
2. 没有 BreakingChanges 时，`SavedEdition = 2` → `rp9`；
3. 两条证据冲突，或都没有 → `unknown`，并**拒绝版本敏感写入**。

不是从文件名、扩展名或安装路径推断。样本 C（85 MB）识别耗时约 1.2 s；`version-guard` 按「路径 + 大小 + mtime」缓存，一次调用只解压一次。

## 4. 记录与对象类型（RP9）

样本 A 的 7 种记录：

```
Axure:DesignDocument / Axure:Page ×5 / xml:BreakingChanges
Axure:HtmlPrototypeGeneratorConfiguration / Axure:Word2007SpecificationGeneratorConfiguration
Axure:CsvAnnotationReportGeneratorConfiguration / Axure:PrintConfig
```

样本 B/C 在此基础上多出 `Axure:PanelState` 与 `Axure:DocumentSettings`。要点：

- **`Axure:DesignDocument` 与 `xml:BreakingChanges` 不在 manifest 里**——manifest 只登记包（页面/面板状态/生成器配置）。所以任何「按 manifest 裁剪」的写法都必须单独保留这两条记录。
- `Axure:DocumentSettings` 是**可选**的：样本 A 没有这条记录，仍能被 RP9 打开并按 MOM/C 样本正常重存。派生空白工程时把它丢掉是安全的。
- 对象类名（样本 A，33 种）与 RP11 完全同名：`Axure:DiagramObject:VectorShape / Connector`、`Axure:Style`、`Axure:PackageInfo`、`Axure:Node`、`Axure:InteractionTreeMap` 等。类名相同不代表动作类型相同——`apply-style` 的反例就在动作层。
- 面板状态密集的真实工程（样本 B：613 个状态）会自带大量**重名告警**（105 条）：`rp-read` 的 `problems` 在真实工程里天然非零，验收判据必须是「不比源文件多」，不是「归零」。

## 5. 已确认的 RP9 差异与红线

| 项目 | 现象 | 处理 |
| --- | --- | --- |
| `apply-style` 动作 | RP9 报 `Unrecognized Type: Axure:InteractionApplyStyleInfo` 并拒绝打开整个文件（2026-10-21 用户实测） | 命令级 + 记录级双重拦截：`version-guard` 查 `--action`，`rp-records` 写原语再扫一次记录字节，绕过 CLI/MCP 也拦得住 |
| `axvg paste` | 剪贴板是 RP11 格式，RP9 画布不识别 | RP9 前置拒绝；目标版本由运行中进程/已安装应用判定，可用 `AXURE_TARGET_EDITION` 显式声明 |
| 空白模板 | 安装包只有教学工程（`RP9 Tour.rp`、`GettingStarted.rp`），没有独立空白 `.rp` | 按版本解析模板；缺失时可用 `blank-template.mjs derive` 从同版本工程派生（样本 A 的空白页 → `aa98b9e8789fc0e7`） |
| 缩略图段 | 每个页面包在 manifest 里除 `package` 还有 `thumbnail`，是独立段 | 派生/裁剪时必须连同缩略图一起搬移并重算偏移，否则页面在 GUI 里显示异常 |

## 6. 复现

```bash
# 结构指纹（不输出正文，可安全贴进报告）
node scripts/rp-fingerprint.mjs <file.rp|file.rplib> ...

# 版本识别
node scripts/rp-read.mjs <file.rp> | head -2

# RP9 Core 离线验收（需要两个外部输入）
AXURE_RP9_SAMPLE=<rp9 工程> AXURE_RP9_BLANK_PAGE=<空白页名> node test/rp9-core-check.mjs

# 派生 RP9 空白模板
node scripts/blank-template.mjs derive <rp9 工程> <空白页名> "$HOME/Library/Application Support/zee-rp/templates/axure-rp9-blank.rp"
```

## 7. 本阶段未覆盖

- RP11 样本的本地对比（本机未安装 RP 11）；`rp11` 分支只由既有记录支撑，未经本机复测。
- RP9 原生「打开 / 保存 / 关闭 / 重开」（需要辅助功能权限，见 `docs/validation.md` 的 `test:rp9-native`）。
- RP10、Windows 环境。
