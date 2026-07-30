# MapSocial — 钱包社交地图 DApp（EVM）

以极简地图为主界面的钱包社交网络：连接钱包签名登录（SIWE，零 gas），建立
Profile 后出现在地图上，点击头像查看资料并发私信。可信度分数由五条 EVM 链
的链上数据统一计算，决定每日可主动私信（搭讪）的人数；邀请好友可获得额外
搭讪名额。当前阶段完全免费。

## 支持的链（统一打分 / 统一资产汇总）

同一地址在所有 EVM 链上通用，因此一次签名登录即覆盖全部链：

| 链 | Chain ID | 打分权重 |
|---|---|---|
| Ethereum | 1 | 1.0 |
| Polygon | 137 | 0.8 |
| Arbitrum One | 42161 | 0.8 |
| Robinhood Chain | 4663 | 0.5 |
| HyperEVM | 999 | 0.5 |

## 快速开始

```bash
npm install
npm run dev
# 打开 http://localhost:3000，浏览器需安装任意 EVM 钱包插件
```

数据保存在本地 SQLite（`data/app.db`），无需额外服务。

## 环境变量（全部可选）

| 变量 | 说明 |
|---|---|
| `ALCHEMY_API_KEY` | Alchemy key，一个 key 统一五条链的服务端 RPC（评分/资产/牌照/打赏验证）；未配置时用公共节点 |
| `NEXT_PUBLIC_ALCHEMY_API_KEY` | 浏览器端 RPC（余额/兑换报价）用的 Alchemy key，会暴露给前端，建议按域名加白；可与上面同一个 key |
| `ETHEREUM_RPC` / `POLYGON_RPC` / `ARBITRUM_RPC` / `ROBINHOOD_RPC` / `HYPEREVM_RPC` | 单独覆盖某条链的 RPC（优先级高于 Alchemy） |
| `PRICE_ETH` / `PRICE_POL` / `PRICE_HYPE` | CoinGecko 不可用时的兜底价格 |
| `IP_CHECK_URL` | IP 情报服务地址（默认 ip-api.com 免费接口，生产建议换商业服务） |
| `LICENSE_STAKE_CONTRACT` | LicenseStake 合约地址（未配置时活动创建走 dev 放行） |
| `EVENT_MIN_TRUST` | 创建活动的最低可信度分数（默认 0） |
| `OPENAI_API_KEY` | 头像图片合规审核（omni-moderation）；**生产必须配置**，未配置时上传不做内容审核 |
| `UNISWAP_API_KEY` | Uniswap Trading API key（内置 SIMN 兑换的报价与组交易，覆盖 v2/v3/v4 全部池子）；未配置时回退到链上 Uniswap V2 报价 |

## 核心规则

- 登录：SIWE 签名验证地址所有权，不发起交易、不收 gas
- 可信度（0-100）：链上活跃度(50) + 资产(30) + 多链覆盖(20) − 被拉黑扣分，每 24h 刷新，不可购买或修改
- 搭讪名额（日额度，每日 00:00 UTC 重置）：可信度 0-29→1、30-59→3、60-79→8、80+→15，加邀请奖励
- 首条私信后对方回复前不能再发；机器人账号不能主动私信
- 资产展示：链上只读，可见/模糊/不可见三档，数字不可修改
- 位置：分享时仅存约 11 公里网格坐标（客户端先取整），否则只显示国别
- 链接：仅 https，过滤 IP 直连 / punycode / 短链等
- 邀请：好友完成 Profile 后，邀请人 +3 / 被邀请人 +2 搭讪名额，30 天有效，有每周与累计上限
- VPN：登录/每日按 IP 情报检测代理与机房 IP，检测到时在对外 Profile 上标注「使用 VPN 中」
- 多语言：内置 9 种语言（中/英/西/法/德/葡/俄/日/韩），默认跟随浏览器语言；登录后在 Profile → 权限中切换
- 距离单位：按用户所在国家自动使用公里或英里（US/GB 用英里）
- 国家：由服务端按登录 IP 自动识别（每日刷新），用户不可修改；用户只选择是否分享模糊位置
- 钱包资产模糊显示：只透出金额位数（如 `$$$$$` 表示五位数美元），不暴露具体数字
- 牌照质押：主办方 / Bot 运营方质押平台 meme 币 **SilMina (SIMN)**（Ethereum：`0x2e3f…4235`）自助开权限——2000 SIMN=主办方、1000 SIMN=Bot；质押时一次性收 5%（3% 平台 + 1% 邀请人 + 1% 返还），随时退回 95% 本金（`contracts/LicenseStake.sol`）
- 创建中心：底部 Dock「创建」入口内置 Create Event / Create Bot 按钮——显示 SIMN 余额与 Uniswap 兑换入口，一键授权 + 质押（邀请人地址自动作为链上 referrer），持牌后直接在地图中心位置发布活动；Bot 账号发消息时链上校验运营牌照（`GET /api/license`）
- 活动：持牌主办方在地图上发布活动（1 仓位 = 1 个进行中活动），可设 NFT 门槛——活动期间持有该 NFT 的用户在地图上以活动主题色发光点亮，方便同场的人互相找到
- 打赏：聊天中可用 SIMN 打赏对方，钱包直转（平台不经手、不抽成、数量不限，只要余额足够）；服务端验证链上交易后在聊天里记录打赏消息，打赏不占搭讪名额、不受回复门槛限制

详细设计见 [docs/DEV.md](docs/DEV.md)。

## 技术栈

Next.js (App Router) · TypeScript · Tailwind CSS · wagmi + viem（SIWE）·
better-sqlite3 · MapLibre GL（CARTO 极简底图）
