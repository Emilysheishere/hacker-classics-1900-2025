# Hacker Classics 1900-2025

本项目抓取 Hacker News 上标题末尾带年份标记的提交，例如 `Some Essay (1990)` 或 `Some Paper (1990) [pdf]`。

默认规则：

- 年份范围：`1900-2025`
- 最低分数：`points >= 4`
- 数据源：Algolia HN Search API
- 输出：`chunks/manifest.json` 和 `chunks/01.json`、`chunks/02.json` 等分页数据
- 中文标题：可用 `scripts/merge_owen_translations.py` 从 Owen Young 的公开 HN Vault 分块中合并 `title_zh`

打开本地网页：

```bash
python3 -m http.server 8787
```

然后访问：

```text
http://127.0.0.1:8787/
```

运行完整抓取：

```bash
python3 scripts/fetch_hn_classics.py
```

小范围测试：

```bash
python3 scripts/fetch_hn_classics.py --start-year 1990 --end-year 1991 --max-pages-per-year 1 --dry-run
```

如果以后要扩展到 2026：

```bash
python3 scripts/fetch_hn_classics.py --end-year 2026
```
