# Axure RP 9 兼容性验收手册

更新：2026-10-21  
读者：要判断「这个 RP9 兼容开发到底正不正常」的人。按本文从上往下跑即可，四层逐层加码，前一层不过就别看后一层。

原则：**离线检查通过 ≠ RP9 能用**。`npm test` 全绿只证明代码自身一致；要证明「RP9 能打开我生成的文件」，唯一证据是第 3 层。

## 0. 一次性准备

| 需要什么 | 本机位置 | 缺失后果 |
| --- | --- | --- |
| Node ≥ 18 | 已装 | 全部无法运行 |
| 一个 RP9 工程（样本） | `rp9样本/*.rp` 或 `work/rp9-source.rp` | 第 1 层直接中止（`exit 1` + 「缺失前提」），一项都不跑 |
| RP9 的 `Default.rplib` | `/Applications/Axure RP 9.app/Contents/Resources/DefaultSettings/Libraries/Default.rplib` | 同上，直接中止 |
| RP9 单页空白工程 | `work/rp9-blank-template.rp` | 5 项失败（派生、建页、建工程、模板自洽、模板可续写） |
| Axure RP 9 本体 | `/Applications/Axure RP 9.app` | 第 3 层无法做 |

每次开新终端先设这三个变量（`AXURE_RP9_LIBRARY` 有默认值，通常不用设）：

```sh
cd /Users/zhengxl/dev/stone/rp/zee-rp
export AXURE_RP9_SAMPLE="/Users/zhengxl/dev/stone/rp/work/rp9-source.rp"
export AXURE_BLANK_TEMPLATE_RP9="/Users/zhengxl/dev/stone/rp/work/rp9-blank-template.rp"
export AXURE_WRITE_ROOT="/Users/zhengxl/dev/stone/rp/work"
```

没有空白模板时现场派生一个（从任意 RP9 工程里挑一个**没有控件**的页）：

```sh
node scripts/blank-template.mjs derive "$AXURE_RP9_SAMPLE" "<空白页名>" "$AXURE_BLANK_TEMPLATE_RP9"
```

## 第 0 层：离线回归（约 30 秒，必须全绿）

```sh
npm test
```

期望末行：

```json
{"total":16,"passed":16,"failed":0}
```

它验证的是**代码自洽**：语法、命令注册表、MCP schema、路径护栏、发布包内容、脚本基线指纹。这一层跟 RP9 无关，任何脚本改动后都要跑。

## 第 1 层：RP9 Core 功能（约 1 分钟，必须全绿）

```sh
npm run test:rp9
```

期望末行：

```json
{"total":12,"passed":12,"failed":0}
```

| 检查项 | 证明了什么 |
| --- | --- |
| 示例工程识别为 Axure RP 9（带证据） | 版本判定读的是文件内 `xml:BreakingChanges` + `SavedEdition`，不是文件名 |
| set-widget-text 在 RP9 上只改目标文本，页面/元件计数不变 | 文本改写不会破坏记录结构 |
| clone-library-widget 从 RP9 库克隆元件到 RP9 页（同版本） | 元件克隆只接受同版本 `.rplib` |
| create-blank-page 用 RP9 模板给 RP9 工程加页 | 加页后的文件仍是 RP9 |
| create-blank-project 生成 RP9 单页空白工程 | 从零建工程可用 |
| RP9 空白模板的 DesignDocument 自洽（无孤儿对象、PackageInfos 覆盖叶子包） | 模板本身能被 RP9 接受：DD 池无孤儿对象、manifest 每个叶子包都有 PackageInfo |
| 从 RP9 模板新建的工程可以继续加页（manifest 引用自洽） | 模板本身没坏：manifest 每个部件都落在文件内、每条记录恰有一个引用 |
| RP9 + apply-style 在写出前被拒绝（CLI 路径） | `InteractionApplyStyleInfo` 被拦死 |
| RP9 + axvg paste 被拒绝 | 画布指令写入也被拦 |
| RP9 工程 + 无法判定版本的元件库被拒绝 | 版本未知不当 RP11 猜 |
| 无法判定版本的项目文件拒绝版本敏感写入 | 同上（项目侧） |
| 全部步骤后源工程字节不变 | 写入只产生新文件，绝不改原件 |

### 常见误判

- **不设 `AXURE_BLANK_TEMPLATE_RP9` 会看到 5 项 FAIL**（派生、建页、建工程、模板自洽、模板可续写），此时总数变成 13——因为「模板派生」那一条只在没有现成模板时才跑。这不是兼容性坏了，是缺前提——报错文案里已经写了怎么补。
- 想**连带验证模板派生**这条路径，就反过来：`unset AXURE_BLANK_TEMPLATE_RP9`，再给 `AXURE_RP9_BLANK_PAGE=<样本里的空白页名>`。派生那条检查只在没有现成模板时才跑。
- 想换样本压测：把 `AXURE_RP9_SAMPLE` 指向 `rp9样本/MOM移动端原型参考-v1.0.rp`（26 页）或 `rp9样本/德重MES_页面原型_V1.0_01 - 盛强.rp`（77 页）再跑一遍。大样本本身带历史重复引用，所以检查用的是「相对源文件基线不退化」，不是「零告警」。

## 第 2 层：拦截路径（手工 10 秒，看报错不看退出码）

兼容性的一半是「不该做的事要拦住」。这两条必须报 `[版本拦截]`，且**不产生输出文件**：

```sh
# 1) RP9 文件上写 RP11 专有动作
node scripts/add-interaction.mjs "$AXURE_RP9_SAMPLE" "$AXURE_WRITE_ROOT/should-not-exist.rp" \
  anyWidget --event OnClick --action apply-style
# 期望：Error: [版本拦截] Axure RP 9 项目不支持交互动作「apply-style」：RP9 不认识 Axure:InteractionApplyStyleInfo ...

# 2) RP9 文件上粘贴画布指令
node scripts/axvg.mjs paste "$AXURE_RP9_SAMPLE" "$AXURE_WRITE_ROOT/should-not-exist-2.rp" <axvg 文件>
# 期望：同类版本拦截

ls "$AXURE_WRITE_ROOT"/should-not-exist*.rp   # 期望：No such file or directory
```

MCP 入口同样拦（在会话里让模型调用 `add_interaction` 且 `action=apply-style`，返回 `{"status":"error","message":"[版本拦截] …"}`）。

## 第 3 层：原生往返（必须人工参与，2 分钟起）

**这一层才是「RP9 真的能用」的证据。** 前两层全绿也只能说「结构没坏」。

### 3A 手工验收（最直接，推荐先用这个）

`work/rp9-acceptance-demo.rp` 是本次开发产出的验收样本（已被 RP 9 保存过一次，41 908 B / 8 条记录 / 1 页 1 元件，`x=80 y=120 w=180 h=48`，文字 `RP9 兼容验收 OK`）。它由三段链式写入生成：`create-blank-project --edition rp9` → `clone-library-widget`（RP9 Default.rplib 的 Primary Button）→ `set-widget-text`。

1. 双击用 **Axure RP 9** 打开（不要用 RP 11 打开，那会把版本升上去，等于自证无效）；
2. 看三件事：
   - 标题栏/关于窗口显示 9.x；**没有** `Unrecognized Type: Axure:InteractionApplyStyleInfo` 之类报错；
   - 左侧只有 1 页「基础支撑功能」，画布上有一个 180×48 的按钮，文字是 `RP9 兼容验收 OK`；
   - 元件没有被降级成白底黑框（若出现，说明样式 MatchInfo 没写对）。
3. `文件 → 保存`，关闭，再双击重开（2026-10-21 已由用户实测通过：保存后记录从 7 条变 8 条，是 RP 9 自动补的 `Axure:DocumentSettings`，不是损坏）；
4. 重开后内容仍在 → 第 3 层通过。想更硬一点，再在 RP9 里手动改一个文字、保存、重开确认。

### 3B 脚本化往返（可重复，需要系统权限）

前置：

1. 系统设置 → 隐私与安全性 → **辅助功能** 与 **自动化**，给运行命令的终端（或 WorkBuddy）勾选 `Axure RP 9` 和 `System Events`；
2. **先关掉 RP9 里所有已打开的文档窗口**——脚本靠菜单「文件 → 保存 / 关闭」驱动当前窗口，开着旧文档有误保存风险；
3. 确认 RP9 没有被 RP 11 抢走文件关联（脚本按 bundleId 选应用，但保存后仍会校验版本）。

```sh
export AXURE_RP9_NATIVE_SOURCE="/Users/zhengxl/dev/stone/rp/work/rp9-acceptance-demo.rp"
npm run test:rp9-native
```

期望：先出现 `AXURE_GUI_PHASE edition rp9 com.axure.AxureRP9`，随后 `structure / editionVerified / editionPreserved / guiSaved / closed / reopened` 全部通过。

**没权限时的表现**（本机当前状态）：

```
缺失前提（不计为通过）：
 - 缺少 System Events 辅助功能权限（菜单保存/关闭需要）：... 发生权限违例。 (-10004)
```

这**不是通过**，也不是代码 bug，是前置条件缺失；补权限后重跑即可。

### 判定红线

- **RP11 保存过的 RP9 文件不算 RP9 验收。** 提交前用第 1 层再跑一次，看 `savedEdition` 仍是 2、`BreakingChanges` 仍是 9.0.0.0。
- 只看到「窗口打开了」不算通过。打开 → 保存 → 关闭 → 重开四步齐了才算。

## 判定总表

| 层 | 命令 | 通过标准 | 不过时说明什么 |
| --- | --- | --- | --- |
| 0 离线回归 | `npm test` | `16/16` | 代码/注册表/基线不自洽，跟 RP9 无关 |
| 1 Core 功能 | `npm run test:rp9` | `12/12` | 缺前提（看报错补 env）或写入逻辑回归 |
| 2 拦截 | 上面两条手工命令 | 报 `[版本拦截]` 且无输出文件 | 护栏漏了，必须修，否则会产出 RP9 打不开的文件 |
| 3 原生往返 | 手工 或 `npm run test:rp9-native` | 能开、能存、能重开、版本没变 | 文件在 RP9 里不可用，前两层全绿也没意义 |

## 换成自己的文件怎么测

```sh
export AXURE_RP9_SAMPLE="/绝对/路径/你的.rp"
npm run test:rp9          # 12 项全跑在你自己文件上
node scripts/rp-read.mjs "$AXURE_RP9_SAMPLE" | head -5   # 先确认版本判定对不对
```

单点手测一条写入（最直观）：

```sh
node scripts/set-widget-text.mjs "$AXURE_RP9_SAMPLE" "$AXURE_WRITE_ROOT/my-test.rp" "<页名>" "<元件名>" "测试文本"
```

输出里 `page/widget/text` 三项对上，再用 RP9 打开 `my-test.rp` 看画布。

## 出错速查

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| `缺少 Axure RP 9 空白模板` | 没设 `AXURE_BLANK_TEMPLATE_RP9`，本机缓存也没有 | 用 `blank-template.mjs derive` 派生后设上 |
| `跨版本克隆被拒绝：素材是 rp11，目标是 rp9` | 拿 RP11 的 `.rplib` 往 RP9 工程里克隆 | 换 RP9 的 `Default.rplib` |
| `[版本拦截] … InteractionApplyStyleInfo` | 对 RP9 用了 RP11 专有动作 | 别用；RP9 无上色通道 |
| `无法判定版本` / `edition: unknown` | 文件缺 `BreakingChanges` 或 `SavedEdition` 矛盾 | 用 RP9/RP11 各打开保存一次确认；确知版本时用 `AXURE_TARGET_EDITION` 显式声明（会被记录为「声明」而非证据） |
| `-10004 权限违例` | 缺辅助功能/自动化授权 | 授权后重跑，别当通过 |
| `Expected one manifest reference, found 0` | 空白模板的 manifest 引用失效（部件指向了不存在的段） | 0.1.2 已修根因；旧模板用 `blank-template.mjs derive` 重新派生即可 |
| RP9 报「载入文件出错 / This file may be corrupted」 | 两种可能：DD 池里有孤儿对象（删了列表项没删对象），或 PackageInfos 没覆盖 manifest 的全部叶子包（漏了生成器配置） | 重新 `derive`（0.1.2 已内置两条自检）；自检不过会直接报错，不会写出坏文件 |

相关文档：[rp9-compatibility-plan.md](rp9-compatibility-plan.md)（分阶段计划与实施状态）、[rp9-capabilities.md](rp9-capabilities.md)（逐命令能力矩阵）、[validation.md](validation.md)（证据等级与全部测试命令）。
