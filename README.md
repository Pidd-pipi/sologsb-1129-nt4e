# 活字字模与铅字档案（gbmovabletype）

面向活字印刷体验馆、铅字工坊与字体研究者的字模 / 字盘 / 试印档案工具：登记字模的字体、字号与材质，在行列网格上编辑字盘落位，记录缺笔磨损等损耗并据此停用或补刻；**每季可按字盘逐格盘存，差异逐格定责后才结束调账**。**纯前端单页应用**，数据全部保存在浏览器本地，不依赖任何后端服务、数据库或外部接口。

## Docker 一键启动（推荐）

```bash
cp .env.example .env
docker compose up -d --build
```

启动后访问：**http://localhost:21829**

其它常用命令：

```bash
docker compose ps          # 查看容器状态（healthy 即就绪）
docker compose logs -f     # 查看 nginx 日志
docker compose down        # 停止并移除容器（数据在浏览器本地，不受影响）
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 + TypeScript（严格模式） |
| 构建 | Vite 6，`npm run build` = `tsc -b && vite build`（含类型检查） |
| 样式 | Tailwind CSS v3 + PostCSS + Autoprefixer（无 UI 组件库，样式自写） |
| 状态 | Zustand（筛选偏好走 persist） |
| 路由 | React Router 6（`createBrowserRouter`） |
| 本地存储 | IndexedDB（Dexie，库名 `gbmovabletype-db`）+ localStorage（表单 / 布局草稿） |
| 部署 | 多阶段 Docker：`node:20-alpine` 构建 → `nginx:alpine` 托管静态产物 |

## 数据模型（`src/types/` 四个独立文件）

| 模型 | 文件 | 关键字段 |
| --- | --- | --- |
| TypeMatrix 字模 | `src/types/matrix.ts` | 字模编号、字符、字体（宋体/楷体/仿宋）、字号（初号 42pt … 八号 5pt 共 16 档）、材质（铜模/木活字/铅合金）、字面尺寸 mm、字身高度 mm、制作年代、刻工、可用性 |
| TypeCase 字盘 | `src/types/case.ts` | 字盘编号、类型（常用字盘/生僻字盘）、行数、列数、格位布局（行/列/字符/字模 id）、所在工位、容量 |
| DefectLog 缺损记录 | `src/types/defect.ts` | 字模 id、缺损类型（缺笔/磨损/变形/锈蚀/断裂）、程度（轻/中/重）、发现日期、处理方式、可用性（可用/停用/待补刻） |
| ProofRecord 试印记录 | `src/types/proof.ts` | 字符或字盘、压力 kg、用墨、印次、样张编号、清晰度评价（清晰/偏淡/糊版）、试印日期 |

### IndexedDB 版本与升级迁移（Dexie）

- **v1**：建 `matrices` 表（含 code / character / font / sizeName / material / availability 索引）
- **v2**：加 `cases` 表与 `matrixId` 多值索引；升级时按 `slots` 回填历史字盘的 `matrixId`
- **v3**：加 `defects`、`proofs` 表；升级时为「停用 / 待补刻」的历史字模回填缺损原因记录
- **v4**：加 `stocktakes` 盘点表（索引：caseId / status / createdAt / closedAt）；纯新增表，升级只建表，**不改动既有字模、字盘、缺损、试印档案**，旧库打开即可继续盘点

首次打开且库为空时会写入一批示例档案（16 枚字模、2 个字盘、5 条缺损、6 条试印），便于直接体验；已有数据则跳过。

## 页面与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | `Overview` | 字模总览：按字体 / 字号 / 材质 / 可用性筛选，卡片显示字符大样与缺损角标，可按部首笔画排序 |
| `/matrices/new` | `MatrixNew` | 字模登记：字符选择器按部首与笔画校验并给出候选，填写字体、字号、材质、尺寸与年代 |
| `/matrices/:id` | `MatrixDetail` | 字模详情：字面信息、所在字盘格位、缺损历史、试印记录，可就地新增缺损或试印、补刻恢复可用 |
| `/cases` | `CaseEditor` | 字盘布局编辑器：行列网格点击落位 / 取出 / 调换，实时提示空格与重复落位；字盘盘点期间布局锁定只读 |
| `/stocktakes` | `Inventory` | 逐格盘点：从当前布局冻结账面快照、生成逐格清单并录入实盘字符或空格；差异逐格选择保留账面 / 确认调账，未盘或差异未处理完不能结束 |
| `/defects` | `DefectBoard` | 缺损登记：提交后自动停用字模并进入待补刻清单，补刻完成一键恢复 |
| `/proofs` | `ProofList` | 试印记录：登记压力、用墨与清晰度，按样张编号回溯试印批次 |

## 目录结构

```
.
├── docker-compose.yml        # 无 version 字段；顶层 name: gbmovabletype
├── .env.example              # COMPOSE_PROJECT_NAME / FRONTEND_PORT
├── README.md
└── frontend/
    ├── Dockerfile            # 多阶段：node:20-alpine → nginx:alpine
    ├── nginx.conf            # try_files 前端路由兜底 + gzip
    ├── index.html
    ├── package.json          # build = tsc -b && vite build
    ├── tailwind.config.js / postcss.config.js / vite.config.ts
    ├── public/favicon.svg
    └── src/
        ├── types/{matrix,case,defect,proof,inventory}.ts
        ├── db/index.ts       # Dexie 库、版本迁移（v1–v4）、示例档案
        ├── stores/{matrixStore,caseStore,inventoryStore,uiStore}.ts
        ├── hooks/{useMatrixSearch,useLocalDraft,useCaseSlots}.ts
        ├── components/common/{MatrixCell,LayoutGrid,CharacterPicker,DefectBadge,EmptyState}.tsx
        ├── layouts/AppShell.tsx
        ├── pages/{Overview,MatrixNew,MatrixDetail,CaseEditor,Inventory,DefectBoard,ProofList}.tsx
        ├── router/index.tsx
        └── utils/{charIndex,layout,inventory,format}.ts
    └── scripts/             # 离线校验脚本（不进生产包，需 npx 临时安装 fake-indexeddb / jsdom）
        ├── check-inventory.ts         # 盘点纯函数：清单生成 / 差异 / 进度 / 调账计划
        ├── check-stocktake-store.ts   # v3→v4 迁移 + 端到端落库（migration | flow）
        └── check-inventory-dom.ts     # 盘点页 React/jsdom 渲染与交互冒烟
```

## 逐格盘点规则

1. **发起即冻结**：在「逐格盘点」选字盘、填保管员后发起一轮（批次号 `PD-YYYYMMDD-NN`）。发起时从当前布局生成 `行×列` 逐格清单，并冻结一份账面快照（`snapshotSlots`）；盘点期间该字盘在布局页**锁定只读**，落库层同样拒绝保存，保证盘点基准不被改动。
2. **逐格录实盘**：每格录入实盘字符（字符选择器）或直接「记为空格」，可「标为未盘」、可上下格切换、可按全部 / 未盘 / 相符 / 差异筛选清单。实盘与账面字符一致判为**相符**，不一致（含账面有字实盘空、账面空实盘有字）判为**差异**；改录会自动作废旧的处理结论。
3. **差异逐格定责**：每处差异由保管员二选一——
   - **保留账面原值**：认定实物盘点误差，结束后该格布局不动；
   - **确认调账**：按实盘落位，需指定对应字模（实盘空格则取出该格字模）；档案中没有该实盘字符的字模时允许先按字符调账，结束时记入遗留提醒，事后补登字模。
4. **未处理完不能结束**：只要还有未盘格位或未处理差异，「结束盘点」按钮禁用并提示剩余数量；结束前有二次确认。
5. **结束只应用确认调账**：在一个 IndexedDB 事务内，仅把「确认调账」的格位写到**被盘字盘的当前布局**（基于实时 slots 落位 / 取出，并刷新 `matrixId` 索引）；保留账面、相符格以及**其它字盘、字模、缺损、试印档案一律不动**。调账字模若仍落在别的字盘，或实盘字符无对应字模，会生成遗留提醒随历史留存。
6. **差异历史留存**：结束后的批次保留每格账面 / 实盘 / 核对结果 / 处理结论、调账格数、结束时间与遗留提醒，可展开回看；删除历史记录只删盘点批次，不影响已经应用到字盘的调账。

## 数据存储说明

- **业务数据**：IndexedDB（Dexie，库名 `gbmovabletype-db`，共 5 张表 `matrices` / `cases` / `defects` / `proofs` / `stocktakes`）。写入前统一 `toPlain()` 深拷贝，避免响应式对象写库抛 `DataCloneError`。
- **草稿数据**：localStorage，前缀 `gbmovabletype-draft:`，覆盖字模登记、字盘布局、缺损登记、试印登记四处表单，刷新后可恢复。
- **界面偏好**：localStorage，键 `gbmovabletype-ui`（Zustand persist，保存筛选条件与当前选中字盘）。
- 容器完全无状态：不挂载命名卷、不连接数据库服务，删除重建容器不影响浏览器里的档案。

## 本地开发（可选）

```bash
cd frontend
npm install
npm run dev      # http://localhost:21829
npm run build    # 类型检查 + 生产构建
```

## 说明

- `frontend/public` 下静态资源已 `chmod 644`，Dockerfile 运行阶段额外 `chmod -R a+rX`，避免 nginx worker 读不到导致 favicon 403。
- 所有表单的数值输入均带 `min` / `max` 约束，枚举字段提供固定选项，不在前端做自由文本写入。
