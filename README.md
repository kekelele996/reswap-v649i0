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
- 交接预约：仅对双方已同意的交换开放。双方均可提出时间地点，双方都确认后预约才生效；
  改约需双方重新确认，取消或过期自动释放原时段；同一参与者时间重叠的预约不得同时生效。
  预约、双方确认与时段占用在单键事务中一次落盘，任一步失败全部回滚；刷新重试与重启回读均保持一致。
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

预约事务不变量的本地校验脚本（无需浏览器，Node 直接运行）：

```bash
pnpm verify:appointments
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
├── components/common/# 共享业务组件和 GlobalErrorBoundary（含 AppointmentPanel.vue）
├── hooks/            # useAuth.ts, useLocalStorage.ts, useExchangeStats.ts, useAppointmentConflict.ts
├── pages/            # Home, ItemDetail, Publish, Exchanges, Profile
├── router/           # index.ts + guards.ts
├── utils/            # storage.ts, formatters.ts, validators.ts, appointmentValidators.ts,
│                     # appointmentTx.ts（预约事务引擎）, appointmentTime.ts, message.ts, themeUtils.ts
├── constants/        # item.ts, exchange.ts, appointment.ts, themes.ts, messages.ts
├── App.vue
├── main.ts
└── styles.css
scripts/              # verify-appointments.mjs / verify-concurrency.mjs：预约不变量与并发校验
```

## 交接预约的一致性设计

- 所有预约数据（预约、双方确认标记、双方时段占用、审计日志）存放在同一个存储键
  `reswap:appointments` 下的整库文档中，带单调递增 `revision`。
- `utils/appointmentTx.ts` 提供串行事务队列：读基线 → 业务变更 → 不变量对账（reconcile）→
  `storage.commitChecked` 原子提交。提交前重读 revision 做乐观并发校验，跨标签页冲突自动重试。
- `utils/storage.ts` 的 `commitChecked` 在同一同步段内完成"写入 + 回读比对"，不一致立即回滚，
  IndexedDB 同步失败同样回滚 localStorage；因此"预约、双方确认、时段占用"要么全部可见，要么全部不可见。
- 每次回读都会对账：过期释放（待确认超时 / 生效超过宽限期）、每段交换至多一条进行中预约、
  occupancy 只由 CONFIRMED 预约推导（漂移自愈）、同一参与者重叠的生效预约只保留确认更早的一条。
- 重复确认在待对方阶段幂等；已生效后的重复确认被拒绝；取消幂等；终结后同段交换可重新预约。

## 数据持久化说明

- `utils/storage.ts` 统一封装 localStorage 和 IndexedDB。
- 所有 `api/*Api.ts` 通过 `storage.ts` 读写数据，不在组件里直接写业务数据。
- 存储层包含序列化、版本号、过期清理、存储 key 管理。
- 交接预约额外使用整库文档 + `revision` 的原子提交（`storage.commitChecked`），保证事务回滚与重启回读一致。
- 首次启动会写入演示用户、物品、交换请求（含两条已同意交换及其演示预约）。

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

定义位置：`src/constants/appointment.ts`（值：proposed / confirmed / cancelled / expired）

出现位置：

- `src/models/appointment.ts`
- `src/constants/messages.ts`
- `src/api/appointmentApi.ts`
- `src/stores/appointmentStore.ts`
- `src/utils/appointmentTx.ts`
- `src/utils/appointmentTime.ts`
- `src/utils/formatters.ts`
- `src/utils/appointmentValidators.ts`
- `src/hooks/useAppointmentConflict.ts`
- `src/router/guards.ts`
- `src/components/common/AppointmentPanel.vue`
- `src/components/common/ExchangeCard.vue`
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
