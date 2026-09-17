# ReSwap 二手闲置物品交换平台

```bash
pnpm install
pnpm dev
```

访问地址：`http://localhost:18415`

## 项目介绍

ReSwap 是一个纯前端以物换物 Web 应用。用户可以本地模拟登录、发布闲置物品、浏览他人物品、发起交换请求，并在浏览器内管理交换记录。

## 主要功能

- 首页瀑布流浏览、分类筛选、关键词搜索。
- 物品详情、物主资料、选择自己的物品发起交换。
- 发布物品，支持本地 base64 图片上传、分类和成色选择。
- 交换管理，区分我发起的和我收到的请求，支持同意、拒绝、完成。
- **交接预约：已同意（accepted）的交换可预约线下交接。双方各自可提出时间地点，双方都确认后预约才生效；同一参与者与已有生效预约时间重叠的新预约不得生效；改约需双方重新确认；取消或过期立即释放原时段。预约记录、双方确认与时段占用打包为同一份数据，通过乐观锁事务一次落盘，任一步失败全部回滚。**
- 个人中心，编辑资料、上传头像、查看我发布的物品。
- 主题切换、全局错误处理和 Vant 提示。

## 启动与构建

```bash
pnpm install
pnpm dev
```

```bash
pnpm build
```

生产部署：执行 `pnpm build` 后，将 `dist/` 目录交给 Nginx 或任意静态文件服务器托管。

## 技术栈

| 类型 | 技术 |
| --- | --- |
| 框架 | Vue 3 + TypeScript |
| 构建 | Vite |
| 状态管理 | Pinia |
| 路由 | Vue Router 4 |
| UI | Vant + Tailwind CSS |
| 持久化 | localStorage + IndexedDB（idb-keyval） |
| 工具库 | dayjs、lodash-es |

## 项目目录结构

```text
src/
├── api/              # userApi.ts, itemApi.ts, exchangeApi.ts, appointmentApi.ts：本地数据 API 层
├── stores/           # authStore.ts, itemStore.ts, exchangeStore.ts, appointmentStore.ts, themeStore.ts
├── models/           # user.ts, item.ts, exchange.ts, appointment.ts：独立数据模型
├── types/            # 共享类型补充
├── components/common/# 共享业务组件（含 AppointmentPanel）和 GlobalErrorBoundary
├── hooks/            # useAuth.ts, useLocalStorage.ts, useExchangeStats.ts
├── pages/            # Home, ItemDetail, Publish, Exchanges, Profile
├── router/           # index.ts + guards.ts
├── utils/            # storage.ts（含单 key 乐观锁事务）, appointmentRules.ts, formatters.ts, validators.ts, message.ts, themeUtils.ts
├── constants/        # item.ts, exchange.ts, appointment.ts, themes.ts, messages.ts
├── App.vue
├── main.ts
└── styles.css

scripts/
├── test-appointments.mjs # 交接预约核心不变量测试（20 个场景 / 68 条断言，纯内存运行）
└── test-transaction.mjs  # storage.transaction 事务语义测试（串行互斥 / 乐观锁回滚 / 异常不落盘）
```

运行测试（无需浏览器，esbuild 打包 TS 后在 Node 中执行）：

```bash
pnpm test
```

## 数据持久化说明

- `utils/storage.ts` 统一封装 localStorage 和 IndexedDB。
- 所有 `api/*Api.ts` 通过 `storage.ts` 读写数据，不在组件里直接写业务数据。
- 存储层包含序列化、版本号、过期清理、存储 key 管理。
- 首次启动会写入演示用户、物品和交换请求。

### 交接预约的一致性保证

- 预约记录与时段占用（`appointments` + `occupied_slots` + 乐观锁 `revision`）打包在同一个存储 key 的同一份数据里，配合 `storage.transaction()` 实现：
  - **一次落盘**：双方确认完成的同一刻，预约状态变为 ACTIVE 并写入双方两个时段占用，二者在同一次 `set` 中提交；任一步抛错则不写盘，全部回滚。
  - **串行互斥**：同标签页内对同一 key 的事务按 Promise 队列串行执行，避免刷新重试/双击产生交错写入。
  - **乐观锁**：提交前重新读取 revision，被其他标签页推进则整体失败重试，杜绝两个时段同时生效。
- 待确认（PENDING）预约**不占用**时段；只有双方都确认进入 ACTIVE 才占用，确认时做两次重叠校验，冲突则回滚。
- 改约回到 PENDING、`proposal_version + 1`、双方重新确认，旧时段立即释放；取消（CANCELLED）或过期（EXPIRED，含 30 分钟宽限期）同样释放时段。历史记录保留，每段交换任意时刻至多一条非终态预约。
- 刷新/重试幂等：方案内容指纹 `proposal_hash` 识别重复提案；重复确认、相同内容改约均为幂等操作。

## 横切关注点

- 主题切换：`stores/themeStore.ts`、`constants/themes.ts`、`utils/themeUtils.ts`、`App.vue`、`components/common/CategoryFilter.vue`、`components/common/UserBrief.vue`、`components/common/ItemCard.vue`。
- 全局错误处理/提示：`utils/message.ts`、`components/common/GlobalErrorBoundary.tsx`、`stores/authStore.ts`、`stores/itemStore.ts`、`stores/exchangeStore.ts`、`components/common/ImageUploader.vue`。

## 枚举出现位置清单

### ItemStatus

定义位置：`src/constants/item.ts`

出现位置：

- `src/models/item.ts`
- `src/constants/messages.ts`
- `src/api/itemApi.ts`
- `src/api/exchangeApi.ts`
- `src/stores/itemStore.ts`
- `src/router/guards.ts`
- `src/utils/formatters.ts`
- `src/components/common/ItemCard.vue`
- `src/pages/ItemDetail.vue`
- `src/pages/Publish.vue`
- `src/pages/Profile.vue`

### ExchangeStatus

定义位置：`src/constants/exchange.ts`

出现位置：

- `src/models/exchange.ts`
- `src/constants/messages.ts`
- `src/api/exchangeApi.ts`
- `src/stores/exchangeStore.ts`
- `src/router/guards.ts`
- `src/utils/formatters.ts`
- `src/hooks/useExchangeStats.ts`
- `src/components/common/ExchangeCard.vue`
- `src/pages/ItemDetail.vue`
- `src/pages/Exchanges.vue`

### AppointmentStatus

定义位置：`src/constants/appointment.ts`

值：PENDING = 'pending'（待双方确认）、ACTIVE = 'active'（已生效）、CANCELLED = 'cancelled'（已取消）、EXPIRED = 'expired'（已过期）

出现位置：

- `src/models/appointment.ts`
- `src/constants/messages.ts`（独立的 `APPOINTMENT_STATUS_MESSAGE_MAP`，因与 ExchangeStatus 枚举字符串值相同）
- `src/api/appointmentApi.ts`
- `src/stores/appointmentStore.ts`
- `src/router/guards.ts`
- `src/utils/formatters.ts`
- `src/utils/appointmentRules.ts`
- `src/components/common/AppointmentPanel.vue`
- `src/pages/Exchanges.vue`

## 分层与高耦合约束

本项目保留提示词要求的“严禁合并职责到单一文件”：模型、常量、API、store、页面、组件、hooks、utils 均独立拆分。

同时保留“屎山代码设计要求”的低内聚高耦合特征：

- `utils/formatters.ts` 同时负责日期、物品状态、交换状态、成色、信用等级文本。
- `constants/messages.ts` 同时包含页面提示、表单校验、日志式文案和状态文案。
- `ItemStatus` 与 `ExchangeStatus` 被模型、API、store、组件、页面、router guards、formatters 多处引用。
- `utils/storage.ts` 是存储入口，但全应用 API 和 store 都依赖它的 key 与数据结构。

例如新增 `ItemStatus.BOOKED` 时，应至少修改：`src/constants/item.ts`、`src/models/item.ts`、`src/api/itemApi.ts`、`src/api/exchangeApi.ts`、`src/stores/itemStore.ts`、`src/router/guards.ts`、`src/utils/formatters.ts`、`src/constants/messages.ts`、`src/components/common/ItemCard.vue`、`src/pages/ItemDetail.vue`、`src/pages/Publish.vue` 等文件。

## 环境变量

当前项目无必需环境变量。

## License

MIT
