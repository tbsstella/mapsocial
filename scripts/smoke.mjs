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

  console.log("1. User A: SIWE login + create profile");
  const alice = makeClient();
  const a = await login(alice, "human");
  check("SIWE login succeeds", a.status === 200 && a.body.ok, JSON.stringify(a.body));
  const aProfile = await setProfile(alice, `alice_${suffix}`);
  check("Create profile", aProfile.status === 200, JSON.stringify(aProfile.body));
  const aMe = (await alice.req("/api/me")).body;
  check("me returns profile + quota", !!aMe.profile && !!aMe.quota);
  check("Gets a referral code", typeof aMe.user.referralCode === "string");
  console.log(`     A trustScore=${aMe.user.trustScore} baseQuota=${aMe.quota.base}`);

  console.log("2. User B: signs up with A's referral code");
  const bob = makeClient();
  const b = await login(bob, "human", aMe.user.referralCode);
  check("B login succeeds", b.status === 200);
  const bProfile = await setProfile(bob, `bob_${suffix}`);
  check("B creates profile", bProfile.status === 200, JSON.stringify(bProfile.body));
  const bMe = (await bob.req("/api/me")).body;
  const aMe2 = (await alice.req("/api/me")).body;
  check("Inviter A gets +3 quota", aMe2.quota.bonus === 3, `got ${aMe2.quota.bonus}`);
  check("Invitee B gets +2 quota", bMe.quota.bonus === 2, `got ${bMe.quota.bonus}`);
  check("A's valid invite count = 1", aMe2.referral.invitedCount === 1);

  console.log("3. DMs: initiate, reply gate, unlock after reply");
  const t1 = await bob.req("/api/threads", {
    method: "POST",
    body: JSON.stringify({ toAddress: aMe.user.address, body: "Hi Alice!" }),
  });
  check("B starts a thread", t1.status === 200 && t1.body.threadId, JSON.stringify(t1.body));
  const threadId = t1.body.threadId;
  const t2 = await bob.req(`/api/threads/${threadId}`, {
    method: "POST",
    body: JSON.stringify({ body: "One more message" }),
  });
  check("Second send before reply rejected (429)", t2.status === 429, `got ${t2.status}`);
  const bMe2 = (await bob.req("/api/me")).body;
  check("B's quota consumed by 1", bMe2.quota.consumed === 1, `got ${bMe2.quota.consumed}`);
  const reply = await alice.req(`/api/threads/${threadId}`, {
    method: "POST",
    body: JSON.stringify({ body: "Hi Bob" }),
  });
  check("A can reply", reply.status === 200);
  const t3 = await bob.req(`/api/threads/${threadId}`, {
    method: "POST",
    body: JSON.stringify({ body: "Can send again after your reply" }),
  });
  check("B can send again after reply", t3.status === 200, JSON.stringify(t3.body));
  const detail = (await bob.req(`/api/threads/${threadId}`)).body;
  check("3 messages in total", detail.messages.length === 3, `got ${detail.messages.length}`);

  console.log("4. Block / unblock");
  const blk = await alice.req(`/api/users/${bMe.user.address}/block`, {
    method: "POST",
    body: JSON.stringify({ action: "block" }),
  });
  check("A blocks B", blk.status === 200 && blk.body.blocked);
  const t4 = await bob.req(`/api/threads/${threadId}`, {
    method: "POST",
    body: JSON.stringify({ body: "Can I still send?" }),
  });
  check("B cannot send after being blocked (403)", t4.status === 403, `got ${t4.status}`);
  const blist = (await alice.req("/api/blocklist")).body;
  check("Blocklist contains B", blist.blocked.length === 1);
  const unblk = await alice.req(`/api/users/${bMe.user.address}/block`, {
    method: "POST",
    body: JSON.stringify({ action: "unblock" }),
  });
  check("Unblock succeeds", unblk.status === 200 && unblk.body.blocked === false);

  console.log("5. Bot restrictions");
  const botC = makeClient();
  await login(botC, "bot");
  await setProfile(botC, `bot_${suffix}`);
  const t5 = await botC.req("/api/threads", {
    method: "POST",
    body: JSON.stringify({ toAddress: aMe.user.address, body: "I am a bot" }),
  });
  check("Bot-initiated DM rejected (403)", t5.status === 403, `got ${t5.status}`);

  // Bot integration config (open endpoint: operators bring their own chat model)
  const cfgHuman = await alice.req("/api/bot/config", {
    method: "PUT",
    body: JSON.stringify({ apiUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", enabled: true }),
  });
  check("Human account configuring bot rejected (403)", cfgHuman.status === 403, `got ${cfgHuman.status}`);
  const cfgBad = await botC.req("/api/bot/config", {
    method: "PUT",
    body: JSON.stringify({ apiUrl: "ftp://evil", model: "x", enabled: true }),
  });
  check("Invalid apiUrl rejected (400)", cfgBad.status === 400, `got ${cfgBad.status}`);
  const cfgPut = await botC.req("/api/bot/config", {
    method: "PUT",
    body: JSON.stringify({
      apiUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      systemPrompt: "You are a receptionist",
      enabled: true,
    }),
  });
  check("Bot saves integration config", cfgPut.status === 200, `got ${cfgPut.status}`);
  const cfgGet = await botC.req("/api/bot/config");
  check(
    "Config readback (key is write-only)",
    cfgGet.status === 200 &&
      cfgGet.body.apiUrl === "https://api.openai.com/v1" &&
      cfgGet.body.hasApiKey === true &&
      cfgGet.body.apiKey === undefined,
    JSON.stringify(cfgGet.body)
  );

  console.log("6. Content filtering");
  const badLink = await setProfile(alice, `alice_${suffix}`, { link: "http://bit.ly/x" });
  check("Bad link rejected", badLink.status === 400);
  const goodLink = await setProfile(alice, `alice_${suffix}`, {
    link: "https://example.com/me",
  });
  check("Valid https link accepted", goodLink.status === 200);

  console.log("7. Map");
  const mapUsers = (await alice.req("/api/map/users")).body;
  const found = mapUsers.users.filter((u) =>
    [`alice_${suffix}`, `bob_${suffix}`, `bot_${suffix}`].includes(u.username)
  );
  check("All three new users on the map (country centroid)", found.length === 3, `got ${found.length}`);
  const aliceOnMap = found.find((u) => u.username === `alice_${suffix}`);
  check(
    "Map data includes gender and organizer flag (for badge/square avatar)",
    aliceOnMap?.gender === "other" && typeof aliceOnMap?.isOrganizer === "boolean",
    JSON.stringify({ gender: aliceOnMap?.gender, isOrganizer: aliceOnMap?.isOrganizer })
  );

  console.log("8. Events (organizer license + map highlight)");
  const lic = await alice.req("/api/license");
  check(
    "License status endpoint OK (dev license + prices 2000/1000 SIMN)",
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
    "Swap quote proxy OK (no key -> onchain fallback / key -> uniswap)",
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
    "A creates event successfully (no contract configured -> dev license)",
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
  check("Concurrent second event rejected (429, 1 slot = 1 event)", ev2.status === 429, `got ${ev2.status}`);
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
  check("Bot event creation rejected (403)", evBot.status === 403, `got ${evBot.status}`);
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
  check("Invalid theme color rejected (400)", evBad.status === 400, `got ${evBad.status}`);
  const evList = (await alice.req("/api/v1/events")).body;
  const mine = evList.events.find((e) => e.id === ev1.body.eventId);
  check("Event list contains new event and it is live", !!mine && mine.live === true);
  check("Event includes exact venue address", mine?.venue === "10 Bayfront Ave, Singapore 018956");
  const mapEvents = (await alice.req("/api/map/events")).body;
  const mapEv = mapEvents.events.find((e) => e.id === ev1.body.eventId);
  check(
    "Map event data OK (no NFT gate -> empty holders)",
    !!mapEv && mapEv.gated === false && Array.isArray(mapEv.holders)
  );
  check("Map event data includes venue", mapEv?.venue === "10 Bayfront Ave, Singapore 018956");

  console.log("8b. Follow events");
  const fol1 = await bob.req(`/api/v1/events/${ev1.body.eventId}/follow`, {
    method: "POST",
    body: JSON.stringify({ action: "follow" }),
  });
  check(
    "B follows event successfully",
    fol1.status === 200 && fol1.body.following === true && fol1.body.followers >= 1,
    JSON.stringify(fol1.body)
  );
  const mapEvB = (await bob.req("/api/map/events")).body.events.find(
    (e) => e.id === ev1.body.eventId
  );
  check(
    "From B's view followedByMe=true with followers count",
    mapEvB?.followedByMe === true && mapEvB?.followers >= 1,
    JSON.stringify({ followedByMe: mapEvB?.followedByMe, followers: mapEvB?.followers })
  );
  const mapEvA = (await alice.req("/api/map/events")).body.events.find(
    (e) => e.id === ev1.body.eventId
  );
  check("From A's view (not following) followedByMe=false", mapEvA?.followedByMe === false);
  const fol2 = await bob.req(`/api/v1/events/${ev1.body.eventId}/follow`, {
    method: "POST",
    body: JSON.stringify({ action: "unfollow" }),
  });
  check("B unfollows successfully", fol2.status === 200 && fol2.body.following === false);

  console.log("8c. Gender locked after first set");
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
    "Gender change ignored (original value kept)",
    bMe1.profile.gender === gBefore,
    `before=${gBefore} after=${bMe1.profile.gender}`
  );
  const aPub = (await bob.req(`/api/users/${aMe.user.address}`)).body;
  check(
    "User with events flagged as organizer (for square avatar)",
    aPub.isOrganizer === true && aPub.accountType === "human",
    JSON.stringify({ isOrganizer: aPub.isOrganizer })
  );

  console.log("9. Tipping (SIMN onchain verification)");
  const tipBadHash = await bob.req(`/api/threads/${threadId}/tip`, {
    method: "POST",
    body: JSON.stringify({ txHash: "not-a-hash" }),
  });
  check("Invalid tx hash rejected (400)", tipBadHash.status === 400, `got ${tipBadHash.status}`);
  const stranger = makeClient();
  await login(stranger, "human");
  const tipNoThread = await stranger.req(`/api/threads/${threadId}/tip`, {
    method: "POST",
    body: JSON.stringify({ txHash: "0x" + "ab".repeat(32) }),
  });
  check("Tipping by non-member of thread rejected (404)", tipNoThread.status === 404, `got ${tipNoThread.status}`);
  const detail2 = (await bob.req(`/api/threads/${threadId}`)).body;
  check(
    "Messages include kind field (for rendering tip messages)",
    detail2.messages.every((m) => m.kind === "text"),
    JSON.stringify(detail2.messages[0])
  );

  console.log("10. Custom avatar (upload + compliance hook)");
  const png1x1 =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const up = await alice.req("/api/avatar", {
    method: "POST",
    body: JSON.stringify({ data: png1x1 }),
  });
  check("Avatar upload succeeds", up.status === 200 && up.body.url, JSON.stringify(up.body));
  const upBad = await alice.req("/api/avatar", {
    method: "POST",
    body: JSON.stringify({ data: "data:image/png;base64,aGVsbG8=" }),
  });
  check("Fake image bytes rejected (400)", upBad.status === 400, `got ${upBad.status}`);
  const saveCustom = await setProfile(alice, `alice_${suffix}`, { avatar: "custom" });
  check("Save custom avatar", saveCustom.status === 200, JSON.stringify(saveCustom.body));
  const aMe3 = (await alice.req("/api/me")).body;
  check(
    "me returns avatar_url",
    aMe3.profile.avatar === "custom" && !!aMe3.profile.avatar_url,
    JSON.stringify({ avatar: aMe3.profile.avatar, url: aMe3.profile.avatar_url })
  );
  const img = await fetch(BASE + aMe3.profile.avatar_url.split("?")[0]);
  check(
    "Avatar file accessible and is an image",
    img.status === 200 && (img.headers.get("content-type") ?? "").startsWith("image/"),
    `got ${img.status} ${img.headers.get("content-type")}`
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
  check("Using custom without upload rejected (400)", noUpload.status === 400, `got ${noUpload.status}`);

  // The SDK is not published yet (sdk/ is gitignored); skip when absent.
  const sdkPresent = (await import("node:fs")).existsSync(
    new URL("../sdk/mapsocial.mjs", import.meta.url)
  );
  if (!sdkPresent) {
    console.log("11. SDK (sdk/mapsocial.mjs missing, skipping)");
    console.log(`\nResult: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  }
  console.log("11. SDK (sdk/mapsocial.mjs end-to-end)");
  const { MapSocial, MapSocialError } = await import("../sdk/mapsocial.mjs");
  const { generatePrivateKey: genKey } = await import("viem/accounts");

  // Organizer path: login -> create profile -> license -> create event (allowed by dev license)
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
    "SDK reads license status",
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
  check("SDK creates event successfully", sdkEv.ok === true && sdkEv.eventId > 0, JSON.stringify(sdkEv));
  // The quantity rule also applies to the SDK: 1 slot = 1 live event
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
    "SDK over-limit creation also rejected (429 EVENT_LIMIT)",
    sdkOver instanceof MapSocialError && sdkOver.status === 429 && sdkOver.code === "EVENT_LIMIT",
    `got ${sdkOver.status} ${sdkOver.code}`
  );

  // Bot path: bot wallet login -> configure integration
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
    "SDK configures bot integration and reads it back",
    sdkCfg.hasApiKey === true && sdkCfg.model === "gpt-4o-mini",
    JSON.stringify(sdkCfg)
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
};

run().catch((e) => {
  console.error("SMOKE_FATAL", e);
  process.exit(1);
});
