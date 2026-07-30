# MapSocial — Developer Document

> Status: v0.2 (EVM MVP implemented)
> Phase: 无限期免费，直到用户基础达标再讨论商业化（无 90 天倒计时）。

## 1. 产品概览

以极简可缩放地图为主界面的钱包社交网络：

- EVM 钱包 SIWE 签名登录（零 gas，只读公钥）
- 建立 Profile（头像 / 性别 / 用户名 / 简介 / 链接 / 权限开关 / 黑名单）
- 地图显示可见用户，点头像看 Profile、发私信
- 可信度分数由多链链上数据统一计算 → 决定每日搭讪（主动私信）名额
- Referral：邀请好友完成 Profile → 双方获得额外搭讪名额（免费期不发现金）
- i18n：9 种语言字典在 `src/lib/locales/`，`src/lib/i18n.tsx` 提供 Provider/useI18n；API 错误返回 `code` 字段由客户端本地化
- VPN 检测：`src/lib/ipcheck.ts` 通过 IP 情报（默认 ip-api.com，`IP_CHECK_URL` 可换）检测 proxy/hosting IP，每 24h 刷新，`users.vpn_detected` 对外在 Profile 卡片标注
- 未来：Open API 供钱包等产品套用；商业化后 referral 升级为净收入分成

## 2. 多链架构（EVM 统一身份）

同一助记词在所有 EVM 链上派生同一地址，因此**一次签名 = 全链身份**。

| 链 | Chain ID | trustWeight | 数据源 |
|---|---|---|---|
| Ethereum | 1 | 1.0 | 公共 RPC |
| Polygon | 137 | 0.8 | 公共 RPC |
| Arbitrum One | 42161 | 0.8 | 公共 RPC |
| Robinhood Chain | 4663 | 0.5 | rpc.mainnet.chain.robinhood.com |
| HyperEVM | 999 | 0.5 | rpc.hyperliquid.xyz/evm |

设计原则：

- 新链（Robinhood/HyperEVM）权重低，防止在零成本新链刷活跃度薅分
- 加新链 = 在 `src/lib/chains.ts` 的 `APP_CHAINS` 加一项
- 非 EVM 链（Solana 等）未来通过「多地址签名绑定」接入（一个 user 多个地址），当前未实现
- HyperEVM 只读 EVM 侧余额；HyperCore（交易层）资产未计入，后续可接 Hyperliquid API

## 3. 可信度打分（`src/lib/trust.ts`）

`score = activity(0-50) + assets(0-30) + diversity(0-20) − blockPenalty(≤20)`

- **activity**：各链 `eth_getTransactionCount` × trustWeight 加总后取对数刻度
- **assets**：五链原生币 + 主流稳定币（ETH/ARB/Polygon 的 USDC、USDT 白名单）折 USD 分档
- **diversity**：有真实活动（≥3 笔交易或 ≥$10）的链数 × 5
- **blockPenalty**：被拉黑人数 × 4，封顶 20；拉黑发生时另有即时 −4
- 每 24h 惰性刷新（`/api/me` 触发），结果缓存于 `users` 表
- 币价：CoinGecko（10 分钟缓存）→ 失败回退环境变量静态价
- **分数不可购买、不可修改**；未来付费只能提高名额上限，不能改分

已知局限（后续迭代）：未接入「地址年龄」（需 Etherscan V2 / Blockscout API），
当前以 nonce 活跃度近似。接入时新增 `EtherscanV2Adapter`（ETH/Polygon/Arb）与
`BlockscoutAdapter`（Robinhood/HyperEVM）。

## 4. 搭讪名额（`src/lib/quota.ts`）

- 基础日名额：可信度 0-29→1，30-59→3，60-79→8，80-100→15
- 名额定义：当日（UTC 自然日）**发起的新会话数**（不是单条消息数），每日 00:00 UTC 重置
- `实际名额 = 基础 + 未过期邀请奖励 − 今日已发起会话数`

## 5. 私信规则（`/api/threads`）

- 发起会话：human only（bot 403）、目标开放私信、双向无拉黑、有剩余名额
- **回复门槛**：发起人在对方回复前只能有 1 条消息（`replyGateBlocked`）
- 聊天框有 Block / Unblock；拉黑即时 −4 分并计入下次刷新扣分
- 通讯录 = 会话列表，跟随钱包（服务端按 user 存储）
- 免费期存储不设付费墙；schema 已预留按量限制的扩展空间

## 6. Referral（`src/lib/referral.ts`）

免费期奖励 = 搭讪名额，不发现金：

| 参数 | 值 |
|---|---|
| 邀请人奖励 | +3 名额 / 有效邀请 |
| 被邀请人奖励 | +2 名额 |
| 有效期 | 30 天 |
| 每周有效邀请上限 | 10 |
| 累计奖励上限 | +30 |
| Bot | 不获得搭讪名额 |

- 有效邀请 = 通过 `/r/[code]` 进入 → 连接钱包注册 → **完成 Profile**
- 邀请关系永久写入 `users.referred_by` + `referral_events`（为将来收入分成留账）
- 未来商业化：同一归因链路上叠加「净收入 20% 直推分成」（Polymarket 式）

## 7. 安全与合规

| 项 | 实现 |
|---|---|
| 头像 | 12 款 crypto 风格预设 + 自由上传。上传链路：客户端 canvas 裁剪为 256px 方图（顺带去除 EXIF）→ 服务端魔数嗅探真实格式（jpeg/png/webp）+ 512KB 上限 → 合规钩子 `src/lib/moderation.ts`（配置 `OPENAI_API_KEY` 时用 omni-moderation 审核，审核异常 fail-closed；未配置时放行，**生产必须配置或替换为其他供应商**）→ 存 `data/uploads/<userId>`，经 `/api/avatar/file/[id]` 提供（nosniff + 缓存头） |
| 性别 | 仅 男/女/其他，可见性可关 |
| 资产 | 链上只读；可见/模糊/不可见；数字不可改 |
| 链接 | 仅 https；拒绝 IP 直连、punycode、短链、危险 TLD（`linkfilter.ts`）；生产建议再接 Safe Browsing |
| 位置 | 分享 → 客户端先取整到 0.1°（约 11km）再上传，服务端再取整兜底；不分享 → 国别质心 + 确定性抖动 |
| 地图 | maxZoom 12，永不街道级精度 |
| Bot | 不能发起会话；被动回复不受限（Bot 端口/Webhook 未来开放） |
| 登录 | SIWE nonce 单次消费、10 分钟过期；session HttpOnly cookie 30 天 |

MVP 限制：验签仅支持 EOA（`recoverMessageAddress`）；Safe/AA 合约钱包需 EIP-1271，未实现。

## 7.5 牌照质押（SIMN，`contracts/LicenseStake.sol`）

商业角色（活动主办方 / Bot 运营方）通过质押平台 meme 币自助获得权限，
无人工审核、防刷靠成本：

| 项 | 值 |
|---|---|
| 质押代币 | **SilMina (SIMN)** `0x2e3f8d10818807fa607be3e2AE53863d8d8F4235`（Ethereum 主网，18 位） |
| 主办方牌照 (tier 1) | 质押 2000 SIMN，1 仓位 = 1 个进行中的活动 |
| Bot 牌照 (tier 2) | 质押 1000 SIMN，1 仓位 = 1 个 Bot key |
| 入场费 | 质押时一次性收 5%：3% 平台金库 + 1% referrer + 1% 返还质押人；无 referrer 时 5% 全归金库 |
| 退出 | 随时 `unstake`，退回 95% 本金，无二次收费；`unstake` 永不可暂停 |
| 定价 | 固定 SIMN 数量（模式 A，币价上涨=门槛上涨）；owner 可调价（分代 generation），已有仓位不受影响；总费率硬顶 5% 不可改 |
| 推广位 | `stakeFor`（仅 owner）：平台出币给合作方开权限，无费用，退款只回平台 |
| 防套利 | referral 返点 2% < 费用 5%，循环质押必然净亏损 |

链下配套（`src/lib/license.ts`）：
- `checkLicense(address, tier)` 读合约 `activeCount`，60s 缓存，RPC 失败 fail-closed
- `LICENSE_STAKE_CONTRACT` 未配置（未部署）时 dev 模式放行 1 个名额，便于开发
- 信任分底线 `EVENT_MIN_TRUST`（默认 0）是币价下跌时的安全阀
- 编译：`node scripts/compile-contract.mjs`（solc wasm，产物 `contracts/build/`）
- 部署：`DEPLOYER_KEY=0x... node scripts/deploy-license.mjs`（Ethereum 主网），部署后把地址写进 `LICENSE_STAKE_CONTRACT` 并把 owner 转给多签；**上主网前先独立安全审计 + 测试网演练**

## 7.6 活动（events）与地图点亮

- 主办方（持有效 tier-1 仓位 + 信任分达标 + human + 有 Profile）通过
  `POST /api/v1/events` 创建活动：标题/描述/坐标/起止时间（≤30 天）/主题色/可选链接
- 前端「创建中心」（Dock ➕）：显示 SIMN 余额 + Uniswap 兑换按钮；未持牌时一键
  approve + stake（tier 价格实时读合约，邀请人地址自动作为链上 referrer 传入）；
  持牌后内置创建活动表单，活动坐标取当前地图中心（先把地图移到活动位置）
- NFT 是**纯接入口**（可选）：平台不做发行模块。任何地方发行的 ERC-721 / ERC-1155
  （1155 需 tokenId）填合约地址即可接入；门票设计、售卖、规则、成交全部由主办方
  自己搞定。活动进行中，地图可见用户里持有该 NFT 的人会以活动主题色**发光脉冲**点亮
  （`src/lib/nftgate.ts`，balanceOf 只读、5 分钟缓存、单次最多查 200 地址、失败视为未持有）
- 活动本身在地图上是主题色 📅 标记（进行中脉冲发光，未开始半透明），顶栏「📅 活动」
  面板列出进行中/即将开始的活动，点击飞到活动地点
- 程序化接入：创建活动面板底部有「开放 API / SDK」卡片，内置一份面向开发者和
  AI Agent 的接口速查（`POST /api/v1/events` 全参数），一键「复制给 AI」即可让
  主办方的 Agent 自动接入
- 到期后 NFT 无需销毁——点亮只在活动时间窗内生效，NFT 本身可留作纪念徽章

## 7.7 打赏（SIMN，聊天内）

- 纯链上直转：前端用 wagmi 发起 SIMN `transfer(对方地址, 数量)`（Ethereum 主网），
  平台不经手资金、不抽成、数量不限（余额够即可），任何人（包括 Bot）都可接收
- 交易确认后前端把 txHash 提交 `POST /api/threads/[id]/tip`，服务端读链验证：
  收据 success + SIMN 合约上 `Transfer(我 → 对方, >0)`，通过才插入 `kind='tip'`
  消息（存原始 wei 数量 + txHash，`tip_tx` 唯一索引防同一笔交易重复入账）
- 规则：打赏不占搭讪名额、不参与回复门槛（既不解锁也不消耗）；尊重拉黑
  （被拉黑时不能在会话里记录打赏，链上转账本身无法阻止）
- 聊天气泡为金色样式，附 Etherscan 交易链接

## 7.75 开放接入的分层（API 为底座，SDK 为薄封装，CLI 暂缓）

- **API（必须，规则唯一来源）**：押币换权限的数量规则只在服务端强制一次——
  主办方 1 个 tier-1 仓位 = 1 个进行中活动（超额 429 `EVENT_LIMIT`），Bot 回复
  需有效 tier-2 仓位（403）。UI、API、SDK、AI Agent 走的是同一套检查，无法绕过
- **SDK（推荐接入方式，`sdk/mapsocial.mjs`）**：零依赖（仅 viem）的 Node 单文件
  客户端，封装了接入的最大门槛——SIWE 私钥登录，另有 `license()`、
  `createEvent()`、`threads()/reply()`、`setBotConfig()` 等。JSDoc 里写明了
  licensing 规则，AI Agent 读文件即可自动使用（冒烟测试第 11 节全链路验证）
- **CLI（暂不做）**：目标用户是把功能集成进自己系统的运营商和 AI Agent，
  都不需要 CLI；将来若有手动运维需求，基于 SDK 十几行就能包出来
- **面板的双路径定位**：主办方 UI 优先——创建活动面板覆盖全流程（换币 → 质押 →
  填表 → 发布，时长一键快捷选择），API/SDK 文档卡默认折叠在「开发者 / AI 接入」里；
  运营商 SDK 优先——创建 Bot 面板把接口契约放最前，零代码接入（OpenAI 兼容
  endpoint）折叠为次选项，已启用过的运营商自动展开

## 7.8 Bot 接入（开放口，运营商自带模型）

- 平台只提供聊天窗口，**不做收费逻辑**——计费、业务规则全部由运营商自己决定
- 路径 A（零代码）：Bot 钱包登录后 `PUT /api/bot/config` 配任意 OpenAI 兼容
  endpoint（apiUrl/apiKey/model/systemPrompt/enabled），来私信自动交给运营商的
  模型应答（`src/lib/botreply.ts`，异步、10s 超时、失败静默；apiKey 只写不读）
- 路径 B（完全自主）：Bot 钱包 SIWE 登录后走开放 API 轮询会话并回复
  （`GET /api/threads`、`GET/POST /api/threads/[id]`）
- 硬规则：Bot 永不主动私信；回复需有效 tier-2 质押（未配合约时 dev 模式放行）
- 创建 Bot 面板同样内置「开放 API / SDK」速查卡 + 一键「复制给 AI」

## 8. 数据模型（SQLite，`src/lib/db.ts`）

`users`（地址、类型、referral、信任分缓存、资产缓存）→ `profiles`（资料+权限+位置）
`threads`（有序对唯一 + initiator）→ `messages`
`blocks`（黑名单）、`credit_grants`（名额台账）、`referral_events`（防刷计数）
`auth_nonces` / `sessions`（登录）、`events`（活动 + NFT 门槛配置）、
`bot_configs`（Bot 运营商接入配置，apiKey 只写不读）

所有数值上限（名额表、referral 参数、刷新间隔）集中在 lib 层常量，商业化时改配置即可。

## 9. API 一览

| 路由 | 方法 | 用途 |
|---|---|---|
| `/api/auth/nonce` | POST | 取 SIWE nonce |
| `/api/auth/verify` | POST | 验签 → 建号（accountType/refCode）→ session |
| `/api/auth/logout` | POST | 退出 |
| `/api/me` | GET | 自己：user+profile+quota+referral（惰性刷新信任分） |
| `/api/profile` | PUT | 建立/更新 Profile（首次完成触发 referral 奖励） |
| `/api/avatar` | POST | 上传自定义头像（格式嗅探 + 大小上限 + 合规审核） |
| `/api/avatar/file/[id]` | GET | 头像图片文件（公开，与 Profile 一致） |
| `/api/users/[address]` | GET | 公开 Profile（按权限过滤） |
| `/api/users/[address]/block` | POST | 拉黑 / 取消（`{action}`） |
| `/api/blocklist` | GET | 我的黑名单 |
| `/api/map/users` | GET | 地图点（可见用户，approx 或国别质心+抖动） |
| `/api/threads` | GET/POST | 会话列表 / 发起会话（吃名额） |
| `/api/threads/[id]` | GET/POST | 消息列表 / 发消息（回复门槛；Bot 发消息需链上运营牌照） |
| `/api/threads/[id]/tip` | POST | 提交打赏交易哈希（服务端链上验证后入账） |
| `/api/license` | GET | 当前钱包两档牌照状态 + 当前代际价格 + 邀请人地址（客户端质押时作为链上 referrer） |
| `/api/bot/config` | GET/PUT | Bot 接入配置（OpenAI 兼容 endpoint；仅 Bot 账号；apiKey 只写不读） |
| `/api/v1/events` | GET/POST | 活动列表（公开）/ 创建活动（需主办方牌照） |
| `/api/map/events` | GET | 地图活动标记 + 各活动 NFT 持有者点亮名单 |

## 10. 商业化路线（已在前期讨论定稿，代码留钩子）

免费期（现在）：全部免费 + 限额；referral 只发名额；邀请关系记账。
达标信号：留存稳定、地图密度、名额经常触顶、外部 API 需求出现。
收费后：Social Pro（更高名额+更大存储）、Boost、API/Bot 套餐、发币工具抽成；
referral 升级为净收入 ~20% 直推分成（稳定币结算），名额奖励保留。
不卖：可信度分数、资产数字修改、免审链接、精确位置、回复门槛豁免。

## 11. 已知 TODO

- 地址年龄信号（Etherscan V2 + Blockscout adapter）
- EIP-1271 合约钱包验签
- 非 EVM 地址绑定（CAIP-10 多地址）
- NFT 展示（≤5，主流链自动枚举 + 新链手动填）
- 消息实时推送（当前 5s 轮询）
- Open API Key + 限速
