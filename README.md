# 羊毛星图 · Perk Atlas

静态的免费资源目录，中文在 `/`，英文在 `/en/`。构建只需要 Node 20+，没有 npm 依赖。

线上地址：https://m1012-w0917.github.io/everything/

```
data/categories.json   分类（6 个，对应星体图的 6 格）
data/perks.jsonl       羊毛数据，一行一条
lib/validate.mjs       校验规则（构建、导入、迁移共用）
lib/leak-check.mjs     构建后检查内部字段有没有泄露到 dist/
scripts/import.mjs     批量导入
scripts/migrate-v3.mjs v2 → v3 数据迁移
build.mjs              生成 dist/
docs/                  每日重建的 GitHub Actions 示例（默认不启用）
src/                   styles.css、app.js、favicon.svg，构建时原样复制
assets/                星体图 glass-atlas.webp（需自行放入，见下文）
samples/new-perks.json 导入示例
```

## 一、加一条羊毛

在 `data/perks.jsonl` 末尾加一行 JSON（一行一条，不要换行）。字段如下：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 唯一，只能用 `a-z`、`0-9`、`-`，也是详情页文件名 |
| `category` | 是 | `categories.json` 里已有的分类 id |
| `provider` | 是 | 提供方名称（不分语言） |
| `name` `tag` `summary` `benefit` `eligibility` `cost` `deadline` `verification` | 是 | `{"zh": "…", "en": "…"}` |
| `constraints` `steps` | 是 | `{"zh": ["…"], "en": ["…"]}`，至少一项 |
| `url` `source` | 是 | 官方入口和来源，必须是 `https://` |
| `sourceLabel` | 否 | `{"zh": "…", "en": "…"}`，来源链接显示的文字。某种语言没填时，该语言页显示「查看来源 / View source」 |
| `reviewed` | 是 | 核验日期 `YYYY-MM-DD` |
| `expires` | 否 | 到期时间，`null` 表示没有。写法见下文「到期时间」 |
| `requiresCard` | 否 | `true` / `false`：开通时是否要绑信用卡或其他付款方式 |
| `autoRenew` | 否 | `true` / `false`：免费期结束后是否会自动开始收费 |
| `audience` | 否 | 按官方条款**谁有资格**（不是目标用户）：`all` 有账号或任何人都行；`student` 要学生认证；`developer` 要加入或申请开发者计划；`new-user` 只限新账号或首次用户；`enterprise` 要以公司或机构身份申请 |
| `regions` | 否 | `["global"]` 表示全球可用；否则是 ISO 3166-1 两位大写地区代码，如 `["CN","HK"]`。`"global"` 只能单独出现。`EU`、`EZ`、`UN`、`QO`、`XA`、`XB`、`ZZ` 不是国家或地区，会被拒绝 |
| `keywords` | 否 | `{"zh": "…", "en": "…"}`，只参与搜索，不显示 |
| `verifyMethod` | 否 | **内部字段**。`official-page` / `announcement` / `redeemed` / `unverified`，只用于维护 |
| `discoveredVia` | 否 | **内部字段**。数组，每项 `{type, url?, date, note?}`：`type` 为 `x` / `web` / `newsletter` / `manual`；`type` 不是 `manual` 时 `url` 必填且为 https；`date` 是我们发现它的日期（不是帖子日期）；`note` 单行 |

**不知道就不写这个字段。** `requiresCard`、`autoRenew`、`audience`、`regions`、`verifyMethod`、`discoveredVia` 都是可选的：没核实过就整个字段不写，不要写 `null`，也不要猜。写了 `null` 或类型不对会报错。

标记会在页面上显示成文字徽章（如「需绑卡」「到期自动扣费」「限学生」），也会进入复制给 AI 的摘要、`resources.md`、`resources.json` 和搜索。目录页的「无需绑卡」筛选只显示 `requiresCard` 明确为 `false` 的条目，没写这个字段的不会显示。

`verification`（双语文字）照旧显示在页面上；`verifyMethod` 不显示。

### 内部字段不会上线

`verifyMethod` 和 `discoveredVia` 只存在于 `data/perks.jsonl`。校验时它们被单独拿出来，构建拿到的公开数据里根本没有这两个字段，所以任何输出（包括 `resources.json`）都不会带上。构建结束时还会扫描 `dist/`：如果出现这两个字段名，或者出现某个 `discoveredVia.url`（它同时是某条公开 `url`/`source` 的除外），构建会列出命中的文件、删除 `dist/` 并以退出码 1 结束。最常见的原因是把内部来源链接抄进了 `summary` 等公开字段。

### 到期时间

`expires` 有两种写法：

- **日期** `YYYY-MM-DD`：表示**北京时间这一天结束**为止，即到第二天 `00:00 +08:00`。例如 `2026-11-30` 在北京时间 12 月 1 日 0 点下架。页面显示「2026-11-30（北京时间当天结束）」。
- **时刻**（有精确截止时间的活动，如 Epic、Fab 一律用这种）：`YYYY-MM-DDTHH:mm` 或 `YYYY-MM-DDTHH:mm:ss`，**必须**带 `Z` 或 `±HH:MM`，如 `2026-11-12T16:00:00Z`、`2026-11-17T09:59:00-05:00`。不带时区会报错。页面静态文字中文按北京时间、英文按 UTC 显示；有 JS 时换成读者本地时间（带时区缩写）。

过期条目的处理：

- 构建时就过期的，不生成页面（数据保留），构建日志打印数量和判断时刻。
- 构建之后才过期的，页面脚本在打开时、每次筛选时、切回标签页时检查：目录里自动隐藏，不计入条目数；独立详情页显示「已过期」提示。没有 JS 时只靠构建时的过滤，所以需要定期重建（见下文「每日重建」）。

中文必填。英文可以先空着：构建会打印警告，英文页暂时显示中文（带 `lang="zh-CN"` 标记），构建不会失败。

所有文字字段都是单行，不能包含换行符；列表字段请拆成多项。

改完运行 `node build.mjs`。数据有错时构建会停止，并指出文件、行号和字段，例如：

```
data/perks.jsonl:14 [my-perk] 字段 url：必须是 https:// 开头的有效链接，当前为 "http://…"
```

加分类：在 `categories.json` 里加一项，`sprite` 填 0–5，表示用星体图的第几格（从左上开始，先横后竖）。

## 二、批量导入

准备一个 `.json`（数组）或 `.jsonl` 文件，字段同上，然后：

```bash
node scripts/import.mjs samples/new-perks.json --dry-run   # 只校验，不写入
node scripts/import.mjs samples/new-perks.json             # 导入；id 已存在的跳过
node scripts/import.mjs samples/new-perks.json --update    # id 已存在的覆盖
```

每条单独校验，合格的写入，不合格的不写入。最后打印：

```
新增 2 / 更新 0 / 跳过 0 / 失败 0
```

失败的条目会列出位置和原因。只要有失败，退出码就是 1，方便在 CI 里拦截。新条目追加到文件末尾；被更新的条目在原来那一行替换，所以 diff 只包含改动的行。

`samples/new-perks.json` 有 2 条示例：一条完整双语（带 4 个标记、时刻型到期时间和内部字段 `discoveredVia`），一条只有中文、不带任何标记（用来演示英文回退警告，`expires` 为日期型 2026-12-31）。演示完记得把它们从 `data/perks.jsonl` 里删掉。

### v2 → v3 迁移

```bash
node scripts/migrate-v3.mjs v3-patch.json --dry-run   # 只校验，不写入
node scripts/migrate-v3.mjs v3-patch.json
```

`v3-patch.json` 的格式是 `{ "<id>": { 字段: 值, … } }`，浅合并进 `data/perks.jsonl` 里同 id 的行。每行合并后都会校验，再按 v3 字段顺序写回，行的先后顺序不变。报告：

```
迁移 N / 未变 N / 跳过 N / 失败 N
```

补丁里有、数据里没有的 id 算「跳过」并逐条列出，不算失败。只要有失败就不写文件，退出码 1。同一个补丁重复跑，第二次应该全部是「未变」。v2 格式的旧数据（不带新字段）不迁移也能直接导入和构建。

## 三、构建和部署

```bash
node build.mjs
```

会清空并重新生成 `dist/`：

```
dist/index.html, directory.html, resources/<id>.html     中文
dist/en/index.html, directory.html, resources/<id>.html  英文
dist/resources.md, dist/en/resources.md                  给 AI 读的文本索引
dist/resources.json                                       双语结构化数据
dist/llms.txt, styles.css, app.js, favicon.svg, assets/
```

**部署到子路径**：站内所有链接都是相对路径，把 `dist/` 里的内容原样上传到任意目录即可，例如 `https://example.com/perk-atlas/`，不需要改配置。GitHub Pages、Cloudflare Pages、Nginx 静态目录都可以。

可选环境变量：

- `SITE_URL=https://example.com/perk-atlas/`：给 `canonical` 和 `hreflang` 用绝对地址（搜索引擎更推荐绝对地址）。不设置时用相对地址，页面功能不受影响。
- `BUILD_DATE`：用指定的「现在」判断是否过期，用于预览。可以写日期 `2026-12-01`（表示北京时间当天 00:00）或带时区的时刻 `2026-11-12T16:00:00Z`。格式不对时构建报一行错误并退出。

**本地预览**：可以直接双击打开 `dist/index.html`（file://），站内链接都指向具体的 `.html` 文件，筛选和搜索也能用。也可以在 `dist/` 里运行 `python3 -m http.server`，然后打开 `http://localhost:8000/`。

### 每日重建

日期型到期按北京时间 0 点计算，没有 JS 的访客只能看到构建时的结果，所以建议每天重建一次。`docs/daily-rebuild.example.yml` 是 GitHub Pages 的示例：每天 UTC 16:05（北京时间 00:05）运行 `node build.mjs` 并发布 `dist/`。它**默认不启用**；要启用，把它移到 `.github/workflows/daily-rebuild.yml`，并在仓库 Settings → Pages 把 Source 设为 GitHub Actions。

### 星体图

页面引用 `assets/glass-atlas.webp`（3×2 精灵图）。原图 `glass-atlas.png` 不在仓库里，由维护者提供。拿到后放在项目根目录，转成 WebP：

```bash
mkdir -p assets
# 方式一：有 cwebp（libwebp）时
cwebp -q 85 glass-atlas.png -o assets/glass-atlas.webp
# 方式二：没有 cwebp 时，用 Python Pillow（pip install Pillow）
python3 -c "from PIL import Image; Image.open('glass-atlas.png').save('assets/glass-atlas.webp', quality=85)"
```

没有这个文件时，构建会警告，星体显示为 CSS 渐变球，布局不受影响。

## 其他说明

- **安全**：插入 HTML 的数据全部转义（`& < > " '`）；外链只允许 https，构建时再检查一次；写进 `<script>` 的 JSON 转义了 `<`、`>`、`&`。页面带 CSP（`default-src 'self'`），不会发出任何外部请求。
- **对比度**：文字只用三种颜色：`#1d3e4f`、`#42606e`、`#1d615b`。对页面上最深的背景 `#cfe3e8`，对比度最低为 5.05:1。主按钮是白字配 `#24606e`，对比度 7.06:1。
- **无 JS**：目录条目是普通链接，点击进入独立详情页；搜索、筛选、复制按钮在无 JS 时隐藏。
- **减少动态效果**：系统开启「减少动态效果」时，关闭所有过渡和悬浮位移。

## 以后可能做

本轮没做：结构化金额 `amount {value, currency, unit}`、固定的 tag 词表、一条羊毛属于多个分类、轮换活动（如每周限免）的建模。
