/* End-to-end API smoke test using in-memory wallets (no browser needed).
 * Usage: node scripts/smoke.mjs [baseUrl]
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

const BASE = process.argv[2] ?? "http://localhost:3100";
let passed = 0;
let failed = 0;

function check(name, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

function makeClient() {
  let cookie = "";
  return {
    async req(path, opts = {}) {
      const res = await fetch(BASE + path, {
        ...opts,
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { cookie } : {}),
          ...(opts.headers ?? {}),
        },
      });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      let body = null;
      try {
        body = await res.json();
      } catch {}
      return { status: res.status, body };
    },
  };
}

async function login(client, accountType, refCode) {
  const account = privateKeyToAccount(generatePrivateKey());
  const { body: nonceBody } = await client.req("/api/auth/nonce", { method: "POST" });
  const message = createSiweMessage({
    address: account.address,
    chainId: 1,
    domain: "localhost:3100",
    nonce: nonceBody.nonce,
    uri: BASE,
    version: "1",
  });
  const signature = await account.signMessage({ message });
  const { status, body } = await client.req("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify({ message, signature, accountType, refCode }),
  });
  return { account, status, body };
}

async function setProfile(client, username, extra = {}) {
  return client.req("/api/profile", {
    method: "PUT",
    body: JSON.stringify({
      username,
      avatar: "a03",
      gender: "other",
      bio: "smoke test",
      link: "",
      profileVisibility: "visible",
      genderVisibility: "visible",
      assetsVisibility: "blurred",
      locationMode: "country",
      country: "SG",
      messagingAllowed: true,
      ...extra,
    }),
  });
}

const run = async () => {
  console.log(`Smoke test against ${BASE}\n`);
  const suffix = Date.now().toString(36).slice(-5);

  console.log("1. 用户 A：签名登录 + 建档");
  const alice = makeClient();
  const a = await login(alice, "human");
  check("SIWE 登录成功", a.status === 200 && a.body.ok, JSON.stringify(a.body));
  const aProfile = await setProfile(alice, `alice_${suffix}`);
  check("建立 Profile", aProfile.status === 200, JSON.stringify(aProfile.body));
  const aMe = (await alice.req("/api/me")).body;
  check("me 返回 profile + quota", !!aMe.profile && !!aMe.quota);
  check("拿到 referral code", typeof aMe.user.referralCode === "string");
  console.log(`     A 可信度=${aMe.user.trustScore} 基础名额=${aMe.quota.base}`);

  console.log("2. 用户 B：通过 A 的邀请码注册");
  const bob = makeClient();
  const b = await login(bob, "human", aMe.user.referralCode);
  check("B 登录成功", b.status === 200);
  const bProfile = await setProfile(bob, `bob_${suffix}`);
  check("B 建档", bProfile.status === 200, JSON.stringify(bProfile.body));
  const bMe = (await bob.req("/api/me")).body;
  const aMe2 = (await alice.req("/api/me")).body;
  check("邀请人 A 获得 +3 名额", aMe2.quota.bonus === 3, `实际 ${aMe2.quota.bonus}`);
  check("被邀请人 B 获得 +2 名额", bMe.quota.bonus === 2, `实际 ${bMe.quota.bonus}`);
  check("A 有效邀请数 = 1", aMe2.referral.invitedCount === 1);

  console.log("3. 私信：发起、回复门槛、回复解锁");
  const t1 = await bob.req("/api/threads", {
    method: "POST",
    body: JSON.stringify({ toAddress: aMe.user.address, body: "你好 Alice!" }),
  });
  check("B 发起会话", t1.status === 200 && t1.body.threadId, JSON.stringify(t1.body));
  const threadId = t1.body.threadId;
  const t2 = await bob.req(`/api/threads/${threadId}`, {
    method: "POST",
    body: JSON.stringify({ body: "再发一条" }),
  });
  check("回复前二次发送被拒 (429)", t2.status === 429, `实际 ${t2.status}`);
  const bMe2 = (await bob.req("/api/me")).body;
  check("B 名额被消耗 1", bMe2.quota.consumed === 1, `实际 ${bMe2.quota.consumed}`);
  const reply = await alice.req(`/api/threads/${threadId}`, {
    method: "POST",
    body: JSON.stringify({ body: "你好 Bob" }),
  });
  check("A 可以回复", reply.status === 200);
  const t3 = await bob.req(`/api/threads/${threadId}`, {
    method: "POST",
    body: JSON.stringify({ body: "收到回复后可以继续发了" }),
  });
  check("回复后 B 可继续发送", t3.status === 200, JSON.stringify(t3.body));
  const detail = (await bob.req(`/api/threads/${threadId}`)).body;
  check("消息共 3 条", detail.messages.length === 3, `实际 ${detail.messages.length}`);

  console.log("4. 拉黑 / 解除");
  const blk = await alice.req(`/api/users/${bMe.user.address}/block`, {
    method: "POST",
    body: JSON.stringify({ action: "block" }),
  });
  check("A 拉黑 B", blk.status === 200 && blk.body.blocked);
  const t4 = await bob.req(`/api/threads/${threadId}`, {
    method: "POST",
    body: JSON.stringify({ body: "还能发吗" }),
  });
  check("被拉黑后 B 无法发送 (403)", t4.status === 403, `实际 ${t4.status}`);
  const blist = (await alice.req("/api/blocklist")).body;
  check("黑名单里有 B", blist.blocked.length === 1);
  const unblk = await alice.req(`/api/users/${bMe.user.address}/block`, {
    method: "POST",
    body: JSON.stringify({ action: "unblock" }),
  });
  check("解除拉黑", unblk.status === 200 && unblk.body.blocked === false);

  console.log("5. 机器人限制");
  const botC = makeClient();
  await login(botC, "bot");
  await setProfile(botC, `bot_${suffix}`);
  const t5 = await botC.req("/api/threads", {
    method: "POST",
    body: JSON.stringify({ toAddress: aMe.user.address, body: "我是机器人" }),
  });
  check("Bot 主动私信被拒 (403)", t5.status === 403, `实际 ${t5.status}`);

  // Bot 接入配置（开放口：运营商自带对话模型）
  const cfgHuman = await alice.req("/api/bot/config", {
    method: "PUT",
    body: JSON.stringify({ apiUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", enabled: true }),
  });
  check("人类账号配置 Bot 被拒 (403)", cfgHuman.status === 403, `实际 ${cfgHuman.status}`);
  const cfgBad = await botC.req("/api/bot/config", {
    method: "PUT",
    body: JSON.stringify({ apiUrl: "ftp://evil", model: "x", enabled: true }),
  });
  check("非法 apiUrl 被拒 (400)", cfgBad.status === 400, `实际 ${cfgBad.status}`);
  const cfgPut = await botC.req("/api/bot/config", {
    method: "PUT",
    body: JSON.stringify({
      apiUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      systemPrompt: "你是接待员",
      enabled: true,
    }),
  });
  check("Bot 保存接入配置", cfgPut.status === 200, `实际 ${cfgPut.status}`);
  const cfgGet = await botC.req("/api/bot/config");
  check(
    "配置回读（key 只写不读）",
    cfgGet.status === 200 &&
      cfgGet.body.apiUrl === "https://api.openai.com/v1" &&
      cfgGet.body.hasApiKey === true &&
      cfgGet.body.apiKey === undefined,
    JSON.stringify(cfgGet.body)
  );

  console.log("6. 内容过滤");
  const badLink = await setProfile(alice, `alice_${suffix}`, { link: "http://bit.ly/x" });
  check("坏链接被拒", badLink.status === 400);
  const goodLink = await setProfile(alice, `alice_${suffix}`, {
    link: "https://example.com/me",
  });
  check("正常 https 链接通过", goodLink.status === 200);

  console.log("7. 地图");
  const mapUsers = (await alice.req("/api/map/users")).body;
  const found = mapUsers.users.filter((u) =>
    [`alice_${suffix}`, `bob_${suffix}`, `bot_${suffix}`].includes(u.username)
  );
  check("三个新用户都在地图上（国别质心）", found.length === 3, `实际 ${found.length}`);
  const aliceOnMap = found.find((u) => u.username === `alice_${suffix}`);
  check(
    "地图数据带性别与主办方标记（角标/方形头像用）",
    aliceOnMap?.gender === "other" && typeof aliceOnMap?.isOrganizer === "boolean",
    JSON.stringify({ gender: aliceOnMap?.gender, isOrganizer: aliceOnMap?.isOrganizer })
  );

  console.log("8. 活动（主办方牌照 + 地图点亮）");
  const lic = await alice.req("/api/license");
  check(
    "牌照状态接口正常（dev 牌照 + 价格 2000/1000 SIMN）",
    lic.status === 200 &&
      lic.body.organizer?.ok === true &&
      lic.body.organizer?.devMode === true &&
      lic.body.organizer?.price === (2000n * 10n ** 18n).toString() &&
      lic.body.bot?.price === (1000n * 10n ** 18n).toString(),
    JSON.stringify(lic.body)
  );
  const swapQuote = await alice.req("/api/swap/quote", {
    method: "POST",
    body: JSON.stringify({
      amountOut: (2000n * 10n ** 18n).toString(),
      tokenIn: "usdc",
      swapper: aMe.user.address,
    }),
  });
  check(
    "swap 报价代理正常（无 key → 链上回退 / 有 key → uniswap）",
    swapQuote.status === 200 &&
      (swapQuote.body.source === "onchain" || swapQuote.body.source === "uniswap"),
    JSON.stringify(swapQuote.body)
  );
  const nowS = Math.floor(Date.now() / 1000);
  const ev1 = await alice.req("/api/v1/events", {
    method: "POST",
    body: JSON.stringify({
      title: `Meetup ${suffix}`,
      description: "smoke event",
      lat: 1.3521,
      lng: 103.8198,
      startsAt: nowS - 60,
      endsAt: nowS + 3600,
      themeColor: "#22d3ee",
      venue: "10 Bayfront Ave, Singapore 018956",
    }),
  });
  check(
    "A 创建活动成功（未配置合约 → dev 牌照）",
    ev1.status === 200 && ev1.body.eventId && ev1.body.licenseDevMode === true,
    JSON.stringify(ev1.body)
  );
  const ev2 = await alice.req("/api/v1/events", {
    method: "POST",
    body: JSON.stringify({
      title: "Second concurrent",
      lat: 0,
      lng: 0,
      startsAt: nowS,
      endsAt: nowS + 3600,
      themeColor: "#f472b6",
    }),
  });
  check("并发第二个活动被拒 (429，1 仓位=1 活动)", ev2.status === 429, `实际 ${ev2.status}`);
  const evBot = await botC.req("/api/v1/events", {
    method: "POST",
    body: JSON.stringify({
      title: "Bot event",
      lat: 0,
      lng: 0,
      startsAt: nowS,
      endsAt: nowS + 3600,
    }),
  });
  check("Bot 创建活动被拒 (403)", evBot.status === 403, `实际 ${evBot.status}`);
  const evBad = await bob.req("/api/v1/events", {
    method: "POST",
    body: JSON.stringify({
      title: "Bad color",
      lat: 0,
      lng: 0,
      startsAt: nowS,
      endsAt: nowS + 3600,
      themeColor: "red",
    }),
  });
  check("非法主题色被拒 (400)", evBad.status === 400, `实际 ${evBad.status}`);
  const evList = (await alice.req("/api/v1/events")).body;
  const mine = evList.events.find((e) => e.id === ev1.body.eventId);
  check("活动列表包含新活动且 live", !!mine && mine.live === true);
  check("活动带精确位置地址 (venue)", mine?.venue === "10 Bayfront Ave, Singapore 018956");
  const mapEvents = (await alice.req("/api/map/events")).body;
  const mapEv = mapEvents.events.find((e) => e.id === ev1.body.eventId);
  check(
    "地图活动数据正常（无 NFT 门槛 → holders 空）",
    !!mapEv && mapEv.gated === false && Array.isArray(mapEv.holders)
  );
  check("地图活动数据带 venue", mapEv?.venue === "10 Bayfront Ave, Singapore 018956");

  console.log("8b. 关注活动");
  const fol1 = await bob.req(`/api/v1/events/${ev1.body.eventId}/follow`, {
    method: "POST",
    body: JSON.stringify({ action: "follow" }),
  });
  check(
    "B 关注活动成功",
    fol1.status === 200 && fol1.body.following === true && fol1.body.followers >= 1,
    JSON.stringify(fol1.body)
  );
  const mapEvB = (await bob.req("/api/map/events")).body.events.find(
    (e) => e.id === ev1.body.eventId
  );
  check(
    "B 视角活动 followedByMe=true 且带 followers 数",
    mapEvB?.followedByMe === true && mapEvB?.followers >= 1,
    JSON.stringify({ followedByMe: mapEvB?.followedByMe, followers: mapEvB?.followers })
  );
  const mapEvA = (await alice.req("/api/map/events")).body.events.find(
    (e) => e.id === ev1.body.eventId
  );
  check("A 视角未关注 followedByMe=false", mapEvA?.followedByMe === false);
  const fol2 = await bob.req(`/api/v1/events/${ev1.body.eventId}/follow`, {
    method: "POST",
    body: JSON.stringify({ action: "unfollow" }),
  });
  check("B 取消关注成功", fol2.status === 200 && fol2.body.following === false);

  console.log("8c. 性别一次性锁定");
  const bMe0 = (await bob.req("/api/me")).body;
  const gBefore = bMe0.profile.gender;
  await bob.req("/api/profile", {
    method: "PUT",
    body: JSON.stringify({
      username: bMe0.profile.username,
      avatar: bMe0.profile.avatar,
      gender: gBefore === "male" ? "female" : "male",
      bio: bMe0.profile.bio ?? "",
      link: "",
    }),
  });
  const bMe1 = (await bob.req("/api/me")).body;
  check(
    "改性别被忽略（保持原值）",
    bMe1.profile.gender === gBefore,
    `before=${gBefore} after=${bMe1.profile.gender}`
  );
  const aPub = (await bob.req(`/api/users/${aMe.user.address}`)).body;
  check(
    "有活动的用户标记为主办方（方形头像用）",
    aPub.isOrganizer === true && aPub.accountType === "human",
    JSON.stringify({ isOrganizer: aPub.isOrganizer })
  );

  console.log("9. 打赏（SIMN 链上验证）");
  const tipBadHash = await bob.req(`/api/threads/${threadId}/tip`, {
    method: "POST",
    body: JSON.stringify({ txHash: "not-a-hash" }),
  });
  check("非法交易哈希被拒 (400)", tipBadHash.status === 400, `实际 ${tipBadHash.status}`);
  const stranger = makeClient();
  await login(stranger, "human");
  const tipNoThread = await stranger.req(`/api/threads/${threadId}/tip`, {
    method: "POST",
    body: JSON.stringify({ txHash: "0x" + "ab".repeat(32) }),
  });
  check("非会话成员打赏被拒 (404)", tipNoThread.status === 404, `实际 ${tipNoThread.status}`);
  const detail2 = (await bob.req(`/api/threads/${threadId}`)).body;
  check(
    "消息带 kind 字段（打赏消息渲染用）",
    detail2.messages.every((m) => m.kind === "text"),
    JSON.stringify(detail2.messages[0])
  );

  console.log("10. 自定义头像（上传 + 合规钩子）");
  const png1x1 =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const up = await alice.req("/api/avatar", {
    method: "POST",
    body: JSON.stringify({ data: png1x1 }),
  });
  check("上传头像成功", up.status === 200 && up.body.url, JSON.stringify(up.body));
  const upBad = await alice.req("/api/avatar", {
    method: "POST",
    body: JSON.stringify({ data: "data:image/png;base64,aGVsbG8=" }),
  });
  check("伪造图片字节被拒 (400)", upBad.status === 400, `实际 ${upBad.status}`);
  const saveCustom = await setProfile(alice, `alice_${suffix}`, { avatar: "custom" });
  check("保存 custom 头像", saveCustom.status === 200, JSON.stringify(saveCustom.body));
  const aMe3 = (await alice.req("/api/me")).body;
  check(
    "me 返回 avatar_url",
    aMe3.profile.avatar === "custom" && !!aMe3.profile.avatar_url,
    JSON.stringify({ avatar: aMe3.profile.avatar, url: aMe3.profile.avatar_url })
  );
  const img = await fetch(BASE + aMe3.profile.avatar_url.split("?")[0]);
  check(
    "头像文件可访问且为图片",
    img.status === 200 && (img.headers.get("content-type") ?? "").startsWith("image/"),
    `实际 ${img.status} ${img.headers.get("content-type")}`
  );
  const noUpload = await stranger.req("/api/profile", {
    method: "PUT",
    body: JSON.stringify({
      username: `nobody_${suffix}`,
      avatar: "custom",
      gender: "other",
      bio: "",
      link: "",
    }),
  });
  check("未上传就用 custom 被拒 (400)", noUpload.status === 400, `实际 ${noUpload.status}`);

  // The SDK is not published yet (sdk/ is gitignored); skip when absent.
  const sdkPresent = (await import("node:fs")).existsSync(
    new URL("../sdk/mapsocial.mjs", import.meta.url)
  );
  if (!sdkPresent) {
    console.log("11. SDK（sdk/mapsocial.mjs 不存在，跳过）");
    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
  }
  console.log("11. SDK（sdk/mapsocial.mjs 全链路）");
  const { MapSocial, MapSocialError } = await import("../sdk/mapsocial.mjs");
  const { generatePrivateKey: genKey } = await import("viem/accounts");

  // 主办方路径：登录 → 建档 → 牌照 → 创建活动（dev 牌照放行）
  const org = new MapSocial({ baseUrl: BASE });
  await org.login(genKey());
  await org.setProfile({
    username: `sdk_org_${suffix}`,
    avatar: "a03",
    gender: "other",
    bio: "sdk",
    link: "",
  });
  const sdkLic = await org.license();
  check(
    "SDK 读取牌照状态",
    typeof sdkLic.organizer.ok === "boolean" && typeof sdkLic.organizer.price === "string",
    JSON.stringify(sdkLic.organizer)
  );
  const nowS2 = Math.floor(Date.now() / 1000);
  const sdkEv = await org.createEvent({
    title: `SDK Event ${suffix}`,
    lat: 1.3,
    lng: 103.8,
    startsAt: nowS2 + 60,
    endsAt: nowS2 + 3600,
    themeColor: "#38bdf8",
  });
  check("SDK 创建活动成功", sdkEv.ok === true && sdkEv.eventId > 0, JSON.stringify(sdkEv));
  // 数量规则同样约束 SDK：1 仓位 = 1 进行中活动
  const sdkOver = await org
    .createEvent({
      title: `SDK Event2 ${suffix}`,
      lat: 1.3,
      lng: 103.8,
      startsAt: nowS + 60,
      endsAt: nowS + 3600,
      themeColor: "#38bdf8",
    })
    .catch((e) => e);
  check(
    "SDK 超额创建同样被拒 (429 EVENT_LIMIT)",
    sdkOver instanceof MapSocialError && sdkOver.status === 429 && sdkOver.code === "EVENT_LIMIT",
    `实际 ${sdkOver.status} ${sdkOver.code}`
  );

  // Bot 路径：Bot 钱包登录 → 配置接入
  const sdkBot = new MapSocial({ baseUrl: BASE });
  await sdkBot.login(genKey(), { accountType: "bot" });
  await sdkBot.setProfile({
    username: `sdk_bot_${suffix}`,
    avatar: "a03",
    gender: "other",
    bio: "sdk bot",
    link: "",
  });
  await sdkBot.setBotConfig({
    apiUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    enabled: true,
  });
  const sdkCfg = await sdkBot.botConfig();
  check(
    "SDK 配置 Bot 接入并回读",
    sdkCfg.hasApiKey === true && sdkCfg.model === "gpt-4o-mini",
    JSON.stringify(sdkCfg)
  );

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
};

run().catch((e) => {
  console.error("SMOKE_FATAL", e);
  process.exit(1);
});
