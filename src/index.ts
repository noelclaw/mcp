#!/usr/bin/env node
import { startServer } from "./server.js";
import { getOrCreateWallet } from "./wallet.js";

async function main() {
  await startServer();
  try {
    const wallet = await getOrCreateWallet();
    console.error(`[noelclaw] wallet: ${wallet.address}`);
  } catch (err) {
    console.error(`[noelclaw] wallet init failed: ${err}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
