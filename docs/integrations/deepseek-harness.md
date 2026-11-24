# DeepSeek Harness 接入

在 DSH 的 `cordis.patch.yml` 中添加以下条目。已有 `mcp-zee-rp` 时更新原条目。按本机替换路径，只填写实际存在的模板。

```yaml
- insert:
    - id: mcp-zee-rp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: zee-rp
        transport: stdio
        command: /absolute/path/to/node
        args:
          - /absolute/path/zee-rp/bin/mcp.mjs
        cwd: /absolute/path/zee-rp
        toolCallTimeoutMs: 180000
        failOnStartupError: false
        env:
          ZEE_PYTHON: /absolute/path/zee-rp/.venv/bin/python
          AXURE_WRITE_ROOT: /absolute/path/output
          AXURE_BLANK_TEMPLATE_RP9: /absolute/path/rp9-blank.rp
          AXURE_BLANK_TEMPLATE_RP11: /absolute/path/rp11-blank.rp
```

将技能同步到项目的 `.dsh/skills/zee-rp`。重新打开工作区后，用 `mcp__zee-rp__runtime_info` 检查模板，再按[接入流程](README.md#第一次调用)生成或读回原型。

```sh
node tools/install-agent-skill.mjs /absolute/path/to/project/.dsh/skills/zee-rp --replace
```
