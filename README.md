# 经济学词典（econ-lexicon）

一个经济学名词解释网站：访客可以浏览全部词条、按关键词搜索、按分类筛选；管理员可在线新增、修改、删除词条，数据保存在云端数据库。

- 在线访问（GitHub Pages 镜像，只读）：<https://fiona0103.github.io/econ-lexicon/>
- 官方主站（可登录管理词条）：<https://econ-lexicon.app.workbuddy.host/?sharecode=43WY344TKQ>

## 功能

### 浏览端（所有人可用）
- 词条卡片列表，展示名词、分类、简短定义；点开卡片查看详细解释和生活例子
- 关键词实时搜索（匹配名词、定义、解释、例子，按 `/` 快速聚焦搜索框）
- 分类筛选（微观经济学、宏观经济学、金融学、行为经济学、国际经济学，可自定义新分类）
- 内置 38 条以上词条，移动端自适应

### 管理端（登录后可用）
- WorkBuddy 账号一键登录，或邮箱验证码登录（首次登录自动注册）
- 词条的新增、编辑、删除（删除有二次确认）
- 分类支持预设五类，也可现场新增

## 技术栈与实现

- 纯静态前端：HTML + CSS + 原生 JavaScript，无框架、无构建步骤
- 云端数据：WorkBuddy 云服务（云数据库 `terms` 表，REST 接口），前端通过 `vendor/workbuddy-cloud-sdk.js` 读写
- 数据权限：所有人可匿名读取；写入要求登录（由数据库行级安全策略 RLS 强制）
- 镜像兜底：云端读取失败时（如 GitHub Pages 域名被数据网关拦截），自动回退读取本地 `terms.json` 快照，保证镜像站可正常浏览
- 词条快照由 `export-terms.mjs` 从云端一键导出

## 文件结构

```
├── index.html            页面结构（浏览页 + 管理后台）
├── styles.css            全部样式
├── app.js                全部逻辑（数据加载、搜索、筛选、登录、增删改）
├── terms.json            词条快照（镜像站数据源，云端导出）
├── export-terms.mjs      快照导出脚本（node export-terms.mjs）
├── vendor/
│   └── workbuddy-cloud-sdk.js   云服务 SDK（自托管，避免 CDN 不稳定）
└── .nojekyll             告知 GitHub Pages 跳过 Jekyll 处理
```

## 部署方式

1. 代码推送到 GitHub 仓库 `fiona0103/econ-lexicon` 的 `main` 分支
2. 仓库 Settings → Pages → Source 选 `Deploy from a branch`，Branch 选 `main` + `/ (root)`，保存
3. GitHub 自动构建发布，访问地址：<https://fiona0103.github.io/econ-lexicon/>
4. 以后每次 `git push` 后 1~2 分钟内自动更新

## 词条维护流程

1. 在官方主站后台增删改词条（数据实时存入云端）
2. 本地运行 `node export-terms.mjs` 重新导出 `terms.json`
3. 提交并推送：`git add terms.json && git commit -m "同步词条" && git push`
4. GitHub Pages 镜像站自动同步

## 说明

- 官方主站为完整版（浏览 + 管理）；GitHub Pages 版为只读镜像（浏览 + 搜索 + 筛选）
- 词条数据以云端数据库为准，`terms.json` 为其定时同步的快照
