# 知澳 · 澳门复习室

面向十个指定账号的澳门地理与社会复习系统。前端部署到 GitHub Pages；认证、时间校验、评分和共享排行榜由 Supabase Edge Functions + PostgreSQL 实现。

访客网站：https://ethanlai0312-create.github.io/macau-review/

源码仓库：https://github.com/ethanlai0312-create/macau-review

## 使用

打开已发布的 GitHub Pages 网站，用管理员分配的三位账号和对应密码登录。首次登录会开始一次练习；已有未提交记录则恢复原记录及开始时间。每次100题、每题1分，可跳题、修改答案、切换简繁体。交卷后查看成绩、解析和共享排行榜，再练习不会降低历史最佳成绩。

本仓库不保存账号密码、密码哈希、标准答案、私有题库或管理密钥。题库独立保存在受保护的数据库和管理员本地备份中，**不要把 `private/` 或 `supabase/seed.sql` 加入 Git**。

## 架构与安全

- Vite + HTML/CSS/JavaScript，响应式布局，原生触屏选择框、点击排序、SVG图示。
- OpenCC 提供界面转换，题目、选项和解析有独立的简体/繁体字段。
- 账号只允许 `001`～`010`，密码保持字符串，PBKDF2-SHA256 600,000轮，每个账号随机盐。
- 登录由 Edge Function 校验；256位随机会话令牌只存于当前浏览器会话，数据库只保存其SHA-256摘要。30天过期，退出立即撤销。关闭浏览器后可重新登录恢复练习。
- 数据库按账号和IP摘要限制登录尝试。每账号15分钟最多10次，来源IP摘要最多60次，包括成功尝试。
- 私有数据库模式不可由匿名或普通认证角色读取；公网唯一入口为 Edge Function，特权数据库函数仅 `service_role` 可调用。
- 答题内容以版本号防止多设备覆盖。冲突时可选择云端或本机版本，并保留另一份本机备份。
- 每个账号最多一份进行中练习。交卷在数据库事务中评分和存档；同一练习重复交卷返回原始成绩，已提交记录不能通过API修改。
- 排行榜每账号一份历史最佳：分数降序、用时升序、首次取得该最佳的提交时间升序、账号升序。未交卷账号不出现。
- 所有评分均在数据库执行。多选要求集合完全相同；配对和排序完全匹配；填空接受明确列出的简繁别名并规范化空白、全角字符；数值题只接受严格数值格式和指定容差。

## 计时边界

服务端记录开始时间和首次成功接收交卷的时间，不接受客户端上传的分数、开始时间或用时。前端以服务器时间加单调时钟显示，不用 `setInterval` 累加秒数；刷新与返回前台会重新校准。

点击确认交卷后立即冻结本机显示，并持久保存待提交答案。网络失败可安全重试。**完全离线时，服务端无法可信证明点击发生的时刻，因此最终成绩用时可能包含恢复网络前的等待时间。** 为防止改设备时间作弊，最终排名采用服务器用时，而不是客户端声称的点击时间。超过24小时不归零。

## 本地开发

需要 Node.js 24、pnpm 11：

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm dev
```

设置 `.env.development` 的 `VITE_API_URL=/api` 可使用 Vite 开发代理连接当前后端；或配置自己的真实 HTTPS 后端地址。`vite.config.js` 中代理目标和 Origin 应同时按部署调整。

```sh
VITE_API_URL=https://PROJECT.supabase.co/functions/v1/exam pnpm build
```

构建目录为 `dist/`；`base: './'` 支持 GitHub Pages 项目子路径。应用为单页原生状态界面，没有需要服务器重写的子页面路径。

## 部署

1. 在 Supabase 执行 `supabase/migrations/202610200001_exam.sql`。
2. 从管理员私有备份准备 `private/bank.json`，执行 `pnpm bank`，仅向数据库执行生成的私有 `supabase/seed.sql`。题库恰好100题。
3. 通过可信管理通道录入账号哈希。哈希函数在 `supabase/functions/exam/crypto.js`，切勿把明文密码写进仓库、日志、命令参数或前端配置。
4. 部署 `supabase/functions/exam/` 中的三个文件。此函数自行认证，配置 `verify_jwt=false`；这不是跳过应用认证。
5. `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` 由运行环境提供，不进入浏览器。可设置 `ALLOWED_ORIGINS`（逗号分隔的精确网站源）和 `IP_HASH_SECRET`。当前默认源仅为本项目用户的 GitHub Pages 域名，未匹配来源会被拒绝。
6. 仓库 Settings → Pages → Source 选择 GitHub Actions。推送 `main` 后，工作流测试、构建并部署。
7. 等待工作流成功，再访问网页验证登录、保存、交卷和排行榜，不以“构建成功”代替联网验收。

## 维护

- **修改题目**：在管理员本地私有题库维护 `cn`/`tw`、`type`、`answer`、`explanation`、`source`，重新运行测试；使用新的题库版本ID，旧版本不要删除或改写，以保留历史练习正确性。每个版本固定100题。`scripts/build-bank.mjs` 的版本ID应随版本一起更新。
- **查看成绩**：在 Supabase SQL 编辑器使用 `docs/maintenance.sql` 的只读查询。不要向学生开放管理密钥或SQL编辑器。
- **修改密码**：在可信环境调用哈希函数，将新哈希写入对应账号，并撤销该账号已有会话。不需要重建网站。
- **更新网站**：修改公开源码，提交到 `main`，等待 Actions 成功。
- **备份**：定期备份数据库及本地私有题库；确认 Supabase 当前方案的备份、配额和项目暂停政策。免费服务不能保证永久无中断。

## 验证

`pnpm test` 使用真正的 PostgreSQL WASM 引擎 PGlite 执行数据库迁移和评分函数，不用伪造API替代数据库评分。管理员本机有私有题库时检验实际100题；公开CI无答案库时检验100题的测试夹具，两者用途不同。

具体已执行与未执行的验证见 `docs/ACCEPTANCE.md`。桌面窄屏测试不等于 Android、iOS、HarmonyOS 实机通过。

