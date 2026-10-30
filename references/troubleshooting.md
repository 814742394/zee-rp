# 故障排查

按症状定位。历史现象来自 macOS / Axure RP 11 的实验；其他版本以当前观察为准。

## MCP `generate_prototype` 报 `No module named 'PIL'`（本机 2026-10-30 实测）

**症状**：MCP 调用 `generate_prototype` 在 compile 阶段直接崩：

```
[ERR_COMPILE] proto.py compile ... failed (exit=1)
ModuleNotFoundError: No module named 'PIL'
```

**原因**：`proto.py` 第 26 行 `from PIL import Image, ...`。compile/generate/audit/截图重建全部依赖 Pillow
+ numpy + scipy。MCP 服务用**裸 `python3`** 起子进程（`scripts/*.mjs` 共 18 处 `spawnSync('python3', ...)`），
**没有独立的解释器环境变量**，只能靠 `PATH` 解析。客户端注入的 MCP `env` 若不含带 PIL 的 Python，必然踩坑。
`rp_read`/`verify` 这类只读工具不受影响（不走 Python），所以容易误判成"服务坏了"。

**修复（推荐，一次性）**。下面 `<repo>` 指 zee-rp 检出目录：

```bash
cd <repo>
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

然后让 MCP 服务用上它。两种做法：

1. **改 MCP 配置**（推荐）：在客户端的 MCP `env:` 段加一行 PATH，venv 置顶：

   ```json
   {
     "mcpServers": {
       "zee-rp": {
         "command": "node",
         "args": ["/absolute/path/zee-rp/bin/mcp.mjs"],
         "env": {
           "PATH": "/absolute/path/zee-rp/.venv/bin:/usr/local/bin:/usr/bin:/bin",
           "AXURE_BLANK_TEMPLATE_RP9": "/absolute/path/my-rp9-blank.rp"
         }
       }
     }
   }
   ```

   改完重连服务。`runtime_info` 的 `python.imageModules` 应显示 `PIL/numpy/scipy: true`。
   （DeepSeek Harness 的接入脚本 `dsh-setup/install.sh` 已内置这段检测与注入，重跑一次即可；
   其他客户端照上面的 JSON 手工加。）
2. **CLI 兜底**（不重连服务）：命令前加 PATH 前缀，并补上模板变量，否则会报缺 RP9 空白模板：

   ```bash
   cd <repo>
   PATH="$PWD/.venv/bin:$PATH" \
   AXURE_BLANK_TEMPLATE_RP9=/absolute/path/my-rp9-blank.rp \
   node scripts/proto.mjs generate --spec X.rp1 --out-dir D --out-rp O.rp --strict-audit --backend native
   ```

   MCP 侧同一份源码用 `generate_prototype`；CLI 侧用上面这条，产物等价。

**判别**：`python3 -c "import PIL, numpy"` 能过就没这个问题。`runtime_info` 的
`missingImageDependencies` 非空即是此坑。另注：homebrew Python 受 PEP 668 保护，
`pip install` 会拒绝，必须用 venv（或 `--break-system-packages`）。

## 缺 Axure RP 9 空白工程模板

**症状**：CLI `generate` / `build-rp` 报「缺少 Axure RP 9 的空白工程模板」，列出
`default: ~/Library/Application Support/zee-axure/templates/axure-rp9-blank.rp（不存在）`
及两个 tmp fallback。

**原因**：`AXURE_BLANK_TEMPLATE_RP9` 未设置（MCP 侧由客户端注入，通常没问题；
**CLI 手动跑时必须自己给**）。

**修复**：`export AXURE_BLANK_TEMPLATE_RP9=/absolute/path/my-rp9-blank.rp`。
缺模板时用 `create-blank-project --version 9` 从 Axure 保存一份单页空白工程。

## 手机原型布局与 RP/1

设备壳、屏幕坐标、`[WxH]`、字距测宽、段落居中、面板共享高度、字体与动画边界，
先查 [手机布局速查与故障表](mobile-layout.md)。

## `.rp1` 里写 `items=[{...}]` 报 `Unknown property 'children'`

**症状**：`kv-list` / `detail-card` 的条目写成一行内联 JSON：

```text
kv-list #info [fillxhug]
  items=[{"id":"r1","label":"内核","value":"RN 0.76"}]
```

报 `E_PROPERTY: Unknown property 'children'`，`candidatePatches` 还建议把 `items=[...]`
改名叫 `hidden`——那是误导，别照做。

**原因**：`.rp1` DSL 的节点头只认 `key=value`、`[WxH]`、`"text"`、`#id` 四种 token。
`items=[...]` 里的 `{`/`}`/`[`/`]` 让它无法解析成 KV，整行退化成"下一个子节点的声明"，
于是那行被当成 `children` 传进宏，触发 E_PROPERTY。

**修复**：改用缩进的 `:item` 行，每行一条，`label=`/`value=` 都是普通字符串：

```text
kv-list #info [fillxhug] labelWidth=88 fontSize=12 gap=0 padding=16 radius=16
  :item id=r1 label="内核版本" value="React Native 0.76"
  :item id=r2 label="发布渠道" value="App Store 正式版"
```

注意 `stat-row` 两种写法都合法（`items=[...]` 与 `:item` 均验过），只有
`kv-list` / `detail-card` 的 `:item` 是可靠的；不确定时一律用 `:item`。
`data-table` 用 `:col`、`form-card` 用 `:field`，同理。

## 内容超出手机屏幕：`no_container_overflow`

**症状**：`strictAudit` 报

```
{"gate": "no_container_overflow", "overflow": {"bottom": 279}, "detail": "子元件超出父容器边界 >2px"}
```

**原因**：`iphone-17` 屏幕 402×874，`phone-shell` 的 padding 是 `[14,16,20,16]`，
扣除状态栏/标题栏/Tab 栏后，**内容区可用高度约 642px**（实测 `body_wrap` 起点 `y=142`，
终点 `y=784`）。堆太多卡片必溢出。这是 RP/1 布局里最常见的失败，且**报错只告诉你溢出了多少，不告诉你哪一块该砍**。

**修复**：先按下面的高度预算估算，再动手；不要靠"编译→看溢出→改"循环（一次约 15 秒，
三次就 45 秒，还容易把字号缩到不合规）。

### 402×874 屏幕高度预算（2026-10-30 实测）

固定占用（有 `subtitle` + `tabBar` 时）：状态栏 28 + 标题栏（含副标题 72）+ Tab 栏 56 ≈ **156px**，
`phone-shell` 的 `gap` 另算。**内容区起点 `y≈142`，终点 `y≈784`，可用 ≈642px**。

各区块实测高度（`[fillxhug]`，`padding=14/16`，`gap=12` 时）：

| 区块 | 实测高 | 说明 |
|---|---|---|
| 应用标识卡（72 图标 + 名称 + 版本 + 口号） | 190 | `padding=14 gap=8`；口号一行 `[fillx20]` |
| `list-item` 带副标题 | 63 | 外框 71（含 padding 4） |
| `list-item` 无副标题 | 44 | 外框 52 |
| 4 项目录 + 3 条分割线 | 219 | `[fillx52]` 固定高时；`[fillxhug]` 时约 227 |
| 法律信息卡（标题 + 3 段） | 128 | `padding=14 gap=6`，段落 `lineHeight=18` |
| 版权两行 label | 32 | `lineHeight=16` |

**经验值**：一个典型「关于」页 ≈ 标识 190 + 目录 219 + 法律 128 + 版权 32 + 3×gap(12) = **605px**，
落在 642 内，留约 37px 余量。要再加区块，先减 `gap` 或砍目录项，别动字号。

**快捷判断**：写 `[fillx52]` 这类固定高时，按上表累加即可；写 `[fillxhug]` 时按
"内容行高 + 上下 padding"估。仍不确定就跑一次 `check`（实测 **0.34 秒**，比 `generate` 快 40 倍以上）：

```bash
python3 scripts/proto.py check your.rp1   # 布局审计在 check 阶段就报溢出
```

`check` 的溢出报错容器是 `grp-shell-*`（`containerBox` 即整屏 402×874），
`generate`/`strictAudit` 的容器是 `grp-shell_body_wrap-*`（只到内容区），
两者的 `overflow.bottom` 数值不同，但都指向同一个根因：内容总高超了。

### 反向陷阱：内容太少也会被拦

`strictAudit` 同时检查**留白率**，手机页要求 `whitespace_ratio_pct ∈ [12, 88]`。
只放一个 label 的空页实测 **94.06%** → `whitespace_ok: fail`。
所以"先做个最小页试试"这条路在 strictAudit 下走不通，**至少要有 2-3 个内容区块**。

## 粘贴后 Axure 无变化（无报错、大纲无新元件）

最常见原因：**Axure 缓存了剪贴板评估，粘贴菜单处于禁用态**。脚本会写剪贴板并最多刷新焦点两次；仍不可用时明确报错。仍失败时按顺序：

1. `osascript -e 'tell application "System Events" to tell (first process whose name contains "Axure") to get enabled of menu item "粘贴" of menu "编辑" of menu bar 1'` —— false 即为缓存问题。
2. 先检查大纲是否已有新元件，确认没有落画后再刷新焦点或重试，避免重复追加。
3. 确认 Axure 停留在文档页（欢迎页/无文档时粘贴无处可去）。
4. macOS：Axure 偶尔把粘贴命令排队延迟执行——等几秒再看画布，预览不刷新时点一次 ▶。
5. **Axure 弹了等待选择的模态框**——此时脚本已成功发出菜单命令、不会报错，但粘贴根本没执行。见下一节。

## 弹出「Warning — The pasted widgets include large images and may cause the application to run slower」模态框（粘贴被阻塞）

**症状**：`axvg paste` 返回 `ok:true, pasteCommandSent:true`，但大纲显示 `No widgets added yet.`、画布无内容。屏幕上有 Axure 模态框在等「否 / 是」，**框不点掉粘贴就不会发生**；脚本无感知，不报错也不超时。

2026-10-08 实测触发条件（macOS / Axure RP 11.0.0.4137）：

| 该次载荷 | 图片内嵌方式 | 结果 |
|---|---|---|
| 16 张图，axvg 476 KB（base64 约 234K 字符） | 截图原始 2x 像素（`add_image` 的 `scale=1`） | 触发模态框，粘贴阻塞 |
| 同样 16 张图，axvg 330 KB（base64 约 88K 字符） | 按落画逻辑尺寸出图（`scale=2`） | 不触发，一次粘贴成功 |

处理与边界：

- 选**「否」**保留原图质量，粘贴随即完成；选「是」由 Axure 自行压缩图片（压缩后的实际质量未评估）。
- 模态框是原生弹窗，`axvg paste` 的 `pasteCommandSent:true` 只表示菜单命令返回成功，**不能当作已落画**——这与 [验证流程](verification.md) 的口径一致，落画状态仍须看大纲/画布。
- 触发阈值只测到「这片载荷触发 / 那片不触发」，**没有测出字节或像素边界**，不要写成精确阈值。图片分辨率取舍：保留 2x 像素可改善 Retina 下的清晰度，代价是可能弹框；要一次无人工粘贴就用落画尺寸出图。
- 这是「粘贴无变化」的第三种独立原因，与剪贴板缓存（粘贴菜单禁用）和文档页缺失都不同：**先看屏幕有没有模态框，再看大纲**。

## 弹出「报告错误：Exception has been thrown by the target of an invocation」

**载荷被 Axure 拒绝**，不是环境问题。已知的拒绝原因（按实测频率）：

1. widget 缺 `id` 字段（脚本不会漏，手写 spec 时注意）。
2. `type` 用了 1/2/3/5 却没有配套 `paths`（type:1/2/3/5 一旦出现就走矢量解析，缺 paths 即崩）；type 只用 0 和 2。
3. 不存在的字段名不会崩（被忽略），所以崩溃几乎总来自 type/value 组合。

修 spec 重粘；粘贴会整体失败，不会落下一半。

## 粘贴落进了错误的容器/位置

- 粘贴会**嵌进当前选中的容器**并以其为锚。粘贴前点击画布空白处取消选中（脚本已内置 Escape，但 Escape 对 Axue 不总是生效——必要时用鼠标点空白）。
- **粘贴位置规则（实测确认）**：Axvg 的 frame 坐标是**装配内部相对布局**，不是页面绝对坐标。粘贴时整个装配落在 Axure 的粘贴锚点（当前视图位置/上次选择位置），装配**内部**的相对布局完整保真：
  - 空白新文档 + 视图在原点时，锚点恰好是 (0,0)，看起来像绝对坐标生效；
  - 已有内容/视图移动后粘贴，装配整体锚在当前视图处（frame 坐标被忽略）。
  - **实践准则**：一个原型 = 一次粘贴（内部布局保真）；落点不理想时整体拖到目标位置即可，不要试图用 frame 坐标控制落点。
- 若内容叠在已有内容上：删掉该次粘贴的元件（大纲里按 name 定位），取消选中后重粘。

## 粘贴是追加，不是替换

同一位置重复粘贴会**叠加**两层元件。迭代修改时：小改重粘该区块并手动删旧块；大改新开空白文档（文件 → 新建）。

## 预览不更新

通过 Axure 的预览入口重新生成（工具栏 ▶ 或“发布 → 预览”菜单）；直接刷新浏览器可能仍是旧版本。2026-09-22 的自绘工具栏合成点击有失效记录，菜单栏操作可作为替代，仍要核对新生成的路径和内容。

## 切页 404 或跳到旧预览

先检查预览选项的页面生成范围。2026-09-24 用户在跨页变量验收中确认：勾选“当前页面”会只生成当前 page_1，不能据此判断 `.rp` 的 Page 2 丢失。用 `rp-read` 和 Axure 页面树确认源文件有两页，再将生成范围设为包含两页，从 Axure 重新生成，核对本次 Sitemap 和两页的 HTML/data.js。GUI 保存重开不能替代这个检查。此条来自用户现场反馈，后续复现应记录实际选项和生成结果。

本机 RP 11.0.0.4137 在 2026-09-21/22 的实验里，第二页曾被 302 到旧版本路径后 404；第一页和一次第三页跳转正常。这是会话内现象，不是“第一页永远可用/第二页永远损坏”的产品约束。

先核对当前 Axure 进程、此次生成路径与请求重定向目标；端口和路径都可能变化。必要时把最小行为测试放到新副本的已确认可预览页，继续验证目标能力。不要为绕过预览缓存问题修改用户原件、删除整个 working 目录或反复重写文件格式。

## 自适应视图已生成，但当前预览没有断点选择器

2026-09-23 的 Quick Win 测试副本在 Axure 保存关闭重开后，视图集仍显示“基本/V768/V1024”；从 Axure 打开的本机预览有设备/宽度选择器，三个视图的覆盖均可见。此前“本地预览没有多视图切换器”的说法不适用于该测试件。其他文件或发布配置仍应现场检查；若预览无选择器，先确认打开的是本次 Axure 生成的预览及正确页面，再检查视图集是否绑定该页面。边界见 [自适应视图](adaptive-views.md)。

## 自适应后添加交互报 Missing null GUID

旧自适应工具把 Page 的公共空 GUID 槽改成了视图集身份。当前工具改为追加集合身份槽并保留旧 GUID 表；本轮当前实现生成件已在 Axure 保存关闭重开，并在生成视图后追加和运行交互。对于旧工具生成、已出现 `Missing null GUID` 的文件，不要随意补一个空 GUID 就认为所有引用都已修复；从未损坏的原始基座重建，并按 复验结果 (internal research reference) 检查。

## 中继器预览整页白屏

若日志为 `MbwO.ebwJ.mH4K()` NRE，且 document.js 存在、页面 data.js 缺失，先核对新增 DataSet.Element 的 `column-id/type/value`。round7 已确认只写 value 是失败原因，补全后七行预览通过；值的列归属还须按 column-id 映射。详见 [中继器操作](repeaters.md)。

## 页面载入交互无响应 / 清空排序无效

页面载入用 `--page --event OnLoad`（288）；工具会将页面上下文的 `OnPageLoad` 映射到原生 288。清空排序用 `remove-sort removeAll=true`，当前生成器可能重写原 label。按当前预览的事件、数据顺序判断结果，不能只看编码字段或最终显示行数。

## macOS 专属

- 剪贴板写入报错：`xcode-select --install`（Swift 解释器）。
- 自动粘贴/菜单操作无效：宿主进程（Terminal/iTerm/宿主 App）加入「辅助功能」权限。
- 剪贴板写入成功但 Axure 不识别：确认粘贴的是纯文本且以 `// axvg` 开头（脚本自动加）。自定义类型 "Axvg"/com.axure.axvg 在 mac 上粘贴均无效——这是与 Windows 的关键差异。
- `osascript` 报 `-10004 权限违例`（连 `tell application "System Events" to get name of first process` 都失败）时，
  脚本里的菜单/窗口自动化分支全部不可用，但 **Swift 的 AX API 仍可用**（`AXIsProcessTrusted()` 为 true、
  `AXUIElementCopyAttributeValue` 正常）。此时用 `AXUIElement` 按名点击菜单项、按 `AXWindowNumber` 提窗，
  并用 `CGEvent` 发鼠标/键盘事件替代 `System Events`。2026-10-16 在 RP 9 上按此路线跑通完整粘贴+保存。
  注意 RP 9 文档窗口的 AX 树几乎是空的（只暴露窗口与标题），面板输入框读写不可行。

## 线段（零高 + rotation 矩形）在宿主预览里渲染错误（2026-10-16，RP 9 实测）

**症状**：`kind:"line"` 生成的线段在本地薄页校验里完全正常（薄页是按 `x1,y1→x2,y2` 直接画的，
看不出编码问题），但在 Axure **原生 Preview** 里全部渲染成同方向的过长斜线，折线图整体毁坏。

**范围**：本机 Axure RP 9.0.0.3754 / macOS 的 HTML 预览。未分解到角度符号、长度或 stroke 哪一项，
未在其他 build/平台复现。

**规避**：折线等线段改用 `kind:"shape"`（闭合细四边形，`type:2` 原生矢量路径）。
饼图楔形本来就走 `type:2` 路径，一直是正常的，说明问题出在「零高 + rotation」这一编码本身。

**纪律**：`trace.mjs verify` / 本地薄页是**布局收敛工具，不是宿主验收**。任何依赖 rotation、渐变、
阴影、嵌套或字体回退的元素，都必须以宿主原生 Preview 或 GUI 打开后的观察为准。

## Windows 分支（未实测）

- 保留 PowerShell 剪贴板路径；返回只表示剪贴板已准备，工具不会执行 macOS 菜单命令。
- Axure 是否识别、落点和内容均未在 Windows 验证，需实际粘贴检查。

## 解析异常对照表（已知载荷问题）

| 症状 | 原因 |
|---|---|
| widget 缺 id | 手写 spec 漏字段——用脚本的组件展开，不要手写原始 JSON |
| type:1/2/3/5 无 paths | 形状类 type 必须带 paths；普通矩形一律 type:0 |
| corners/border 数组长度不足 | 必须 4 个值 |
| 未知字段 | 被静默忽略（不崩），但也不生效——不要指望 Axvg 收非文档字段 |

## 返回结果与离线边界

- `pasteCommandSent:false, pasted:false`：只准备剪贴板。
- `pasteCommandSent:true, pasted:null`：菜单命令返回成功，落画状态未知；兼容字段 `pasted` 不再用 true 表示已发送命令。
- 剪贴板或菜单命令失败会抛错，CLI 非零退出；不能把工具失败描述为粘贴完成。
- `build` 输出文件已存在会拒绝覆盖，改用新文件名。
- `.rp` 可解析但应用拒读、切页异常或编辑态错误，按 [能力表](capabilities.md) 和 [验证流程](verification.md) 区分，不在不明原因下反复改底层格式。
