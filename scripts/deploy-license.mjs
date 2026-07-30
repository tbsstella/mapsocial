// Deploy LicenseStake to Ethereum mainnet (where SIMN lives).
//
// Usage:
//   DEPLOYER_KEY=0x... TREASURY=0x... [ETHEREUM_RPC=...] node scripts/deploy-license.mjs
//
// Constructor args (from product design):
//   token     = SIMN 0x2e3f8d10818807fa607be3e2AE53863d8d8F4235
//   treasury  = $TREASURY (defaults to deployer address)
//   organizer = 2000 SIMN
//   bot       = 1000 SIMN
//
// After deploying, set LICENSE_STAKE_CONTRACT=<address> in .env.local and
// transfer ownership to your multisig via transferOwnership/acceptOwnership.
import fs from "node:fs";
import { createWalletClient, createPublicClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

const MEME_TOKEN = "0x2e3f8d10818807fa607be3e2AE53863d8d8F4235"; // SIMN, 18 decimals
const ORGANIZER_PRICE = parseUnits("2000", 18);
const BOT_PRICE = parseUnits("1000", 18);

const key = process.env.DEPLOYER_KEY;
if (!key) {
  console.error("Set DEPLOYER_KEY (never commit it).");
  process.exit(1);
}

const { abi, bytecode } = JSON.parse(
  fs.readFileSync("contracts/build/LicenseStake.json", "utf8")
);

const account = privateKeyToAccount(key);
const treasury = process.env.TREASURY ?? account.address;
const rpc = process.env.ETHEREUM_RPC ?? "https://ethereum-rpc.publicnode.com";

const wallet = createWalletClient({ account, chain: mainnet, transport: http(rpc) });
const client = createPublicClient({ chain: mainnet, transport: http(rpc) });

console.log(`Deployer: ${account.address}`);
console.log(`Treasury: ${treasury}`);
console.log(`Prices  : organizer 2000 SIMN / bot 1000 SIMN`);

const hash = await wallet.deployContract({
  abi,
  bytecode,
  args: [MEME_TOKEN, treasury, ORGANIZER_PRICE, BOT_PRICE],
});
console.log(`Deploy tx: ${hash}`);
const receipt = await client.waitForTransactionReceipt({ hash });
console.log(`✓ LicenseStake deployed at: ${receipt.contractAddress}`);
console.log(`Add to .env.local: LICENSE_STAKE_CONTRACT=${receipt.contractAddress}`);
