// Compile contracts/LicenseStake.sol with solc (wasm) and write ABI+bytecode
// to contracts/build/LicenseStake.json. Usage: node scripts/compile-contract.mjs
import fs from "node:fs";
import path from "node:path";
import solc from "solc";

const root = process.cwd();
const srcPath = path.join(root, "contracts", "LicenseStake.sol");
const source = fs.readFileSync(srcPath, "utf8");

const input = {
  language: "Solidity",
  sources: { "LicenseStake.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

const errors = (output.errors ?? []).filter((e) => e.severity === "error");
for (const e of output.errors ?? []) console.error(e.formattedMessage);
if (errors.length > 0) {
  console.error(`\n✗ ${errors.length} compile error(s)`);
  process.exit(1);
}

const contract = output.contracts["LicenseStake.sol"]["LicenseStake"];
const outDir = path.join(root, "contracts", "build");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "LicenseStake.json"),
  JSON.stringify(
    { abi: contract.abi, bytecode: "0x" + contract.evm.bytecode.object },
    null,
    2
  )
);
console.log("✓ compiled → contracts/build/LicenseStake.json");
console.log(`  bytecode size: ${contract.evm.bytecode.object.length / 2} bytes`);
